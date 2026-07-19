// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// B5 REPLAY test — capped poison-loop leaf re-serve. Drives isPoisonLooped through the
// REAL worker-ledger (recordNode writes actual blueprint + outcome rows) so the poison
// detector is exercised against the ground-truth ledger shape, not a mock. reserveLeaf's
// escalation seam is dependency-injected to a spy so the cap→escalate path is asserted
// deterministically without a live supervisor.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo, listTodos, _closeProject } from '../todo-store';
import { recordNode, _closeLedgerDb } from '../worker-ledger';
import { isPoisonLooped, reserveLeaf, RESERVE_CAP } from '../reserve-leaf';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'reserve-leaf-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Create an approved leaf under an epic and return its id. */
async function makeLeaf(): Promise<string> {
  const epic = await createTodo(project, {
    ownerSession: 's1', title: '[EPIC] host', kind: 'epic', missionId: null,
  });
  const leaf = await createTodo(project, {
    ownerSession: 's1', title: 'do the thing', parentId: epic.id, kind: 'leaf', status: 'ready',
  });
  return leaf.id;
}

/** Append one REAL rejected run to the ledger for `leafId`: a blueprint node carrying
 *  `blueprint` text, then a terminal outcome marker with leafOutcome='rejected'. `baseTs`
 *  spaces runs > RUN_GAP_MS (120s) apart so the splitter sees distinct runs. */
function recordRejectedRun(leafId: string, blueprint: string, runIndex: number): void {
  const base = 1_000_000 + runIndex * 10_000_000; // >> 120_000ms apart
  recordNode({ project, todoId: leafId, session: 'w', leafId, nodeKind: 'blueprint', outputText: blueprint }, base);
  recordNode({ project, todoId: leafId, session: 'w', leafId, nodeKind: 'implement', outputText: 'edit' }, base + 1000);
  recordNode({ project, todoId: leafId, session: 'w', leafId, nodeKind: 'review', verdict: 'fail' }, base + 2000);
  recordNode({ project, todoId: leafId, session: 'w', leafId, nodeKind: 'outcome', nodesSpent: 0, leafOutcome: 'rejected' }, base + 3000);
}

describe('isPoisonLooped', () => {
  test('two same-blueprint rejections → poisoned', async () => {
    const leaf = await makeLeaf();
    recordRejectedRun(leaf, 'PLAN-A', 0);
    recordRejectedRun(leaf, 'PLAN-A', 1);
    expect(isPoisonLooped(project, leaf)).toBe(true);
  });

  test('a single rejection is not poisoned (needs ≥2)', async () => {
    const leaf = await makeLeaf();
    recordRejectedRun(leaf, 'PLAN-A', 0);
    expect(isPoisonLooped(project, leaf)).toBe(false);
  });

  test('a CHANGED blueprint across rejections is normal iteration, NOT poisoned', async () => {
    const leaf = await makeLeaf();
    recordRejectedRun(leaf, 'PLAN-A', 0);
    recordRejectedRun(leaf, 'PLAN-B', 1); // plan revised → not poisoned
    expect(isPoisonLooped(project, leaf)).toBe(false);
  });

  test('changed-then-same: the two latest rejections share a blueprint → poisoned', async () => {
    const leaf = await makeLeaf();
    recordRejectedRun(leaf, 'PLAN-A', 0);
    recordRejectedRun(leaf, 'PLAN-B', 1);
    recordRejectedRun(leaf, 'PLAN-B', 2); // latest two identical
    expect(isPoisonLooped(project, leaf)).toBe(true);
  });

  test('a leaf with no ledger rows is not poisoned', async () => {
    const leaf = await makeLeaf();
    expect(isPoisonLooped(project, leaf)).toBe(false);
  });

  test('fail-safe: a throwing loadRuns is treated as NOT poisoned', async () => {
    const leaf = await makeLeaf();
    const bad = isPoisonLooped(project, leaf, {
      loadRuns: () => { throw new Error('ledger read blew up'); },
    });
    expect(bad).toBe(false);
  });
});

describe('reserveLeaf', () => {
  test('same-blueprint poison → exactly ONE fresh todo (old dropped + supersedes set)', async () => {
    const leaf = await makeLeaf();
    recordRejectedRun(leaf, 'PLAN-A', 0);
    recordRejectedRun(leaf, 'PLAN-A', 1);

    const res = await reserveLeaf(project, leaf, { actor: 'conductor:test', reason: 'poison-loop' });
    expect(res.reason).toBe('reserved');
    expect(res.reserved).toBeTruthy();
    expect(res.reserved).not.toBe(leaf);

    // Old leaf abandoned.
    const oldT = getTodo(project, leaf)!;
    expect(oldT.status).toBe('dropped');

    // Exactly one fresh clone, carrying the lineage + observability stamps.
    const fresh = getTodo(project, res.reserved!)!;
    expect(fresh.supersedes).toBe(leaf);
    expect(fresh.reserveCount).toBe(1);
    expect(fresh.reservedByActor).toBe('conductor:test');
    expect(fresh.reservedReason).toBe('poison-loop');
    expect(fresh.title).toBe(oldT.title);
    expect(fresh.parentId).toBe(oldT.parentId);
    expect(fresh.approvedAt).not.toBeNull(); // re-served ready (old was approved)

    // No THIRD id was minted — only the old + the one clone exist as leaves.
    const leaves = listTodos(project, { includeCompleted: true }).filter((t) => t.kind === 'leaf');
    expect(leaves.length).toBe(2);
  });

  test('CHANGED blueprint → no-op (not-poisoned)', async () => {
    const leaf = await makeLeaf();
    recordRejectedRun(leaf, 'PLAN-A', 0);
    recordRejectedRun(leaf, 'PLAN-B', 1);

    const before = listTodos(project, { includeCompleted: true }).length;
    const res = await reserveLeaf(project, leaf, { actor: 'conductor:test', reason: 'poison-loop' });
    expect(res.reason).toBe('not-poisoned');
    expect(res.reserved).toBeUndefined();
    // No new todo, old untouched.
    expect(listTodos(project, { includeCompleted: true }).length).toBe(before);
    expect(getTodo(project, leaf)!.status).not.toBe('dropped');
  });

  test('after RESERVE_CAP reserves, a further poison → escalate (NOT a 3rd id)', async () => {
    // Re-serve #1: original leaf, poisoned.
    let currentId = await makeLeaf();
    recordRejectedRun(currentId, 'PLAN-A', 0);
    recordRejectedRun(currentId, 'PLAN-A', 1);
    const r1 = await reserveLeaf(project, currentId, { actor: 'c', reason: 'r' });
    expect(r1.reason).toBe('reserved');
    currentId = r1.reserved!;
    expect(getTodo(project, currentId)!.reserveCount).toBe(1);

    // Re-serve #2: the clone gets poisoned too.
    recordRejectedRun(currentId, 'PLAN-A2', 0);
    recordRejectedRun(currentId, 'PLAN-A2', 1);
    const r2 = await reserveLeaf(project, currentId, { actor: 'c', reason: 'r' });
    expect(r2.reason).toBe('reserved');
    currentId = r2.reserved!;
    expect(getTodo(project, currentId)!.reserveCount).toBe(RESERVE_CAP); // == 2

    // Third poison on the twice-reserved lineage → escalate, NO 3rd id.
    recordRejectedRun(currentId, 'PLAN-A3', 0);
    recordRejectedRun(currentId, 'PLAN-A3', 1);
    let escalations = 0;
    let capturedQuestion = '';
    const r3 = await reserveLeaf(
      project, currentId, { actor: 'c', reason: 'r' },
      {
        createEscalation: (input) => {
          escalations++;
          capturedQuestion = input.questionText;
          return {
            escalation: { id: 'esc-1', ...input } as never,
            isNew: true,
          };
        },
      },
    );
    expect(r3.reason).toBe('cap-exhausted');
    expect(r3.escalated).toBe(true);
    expect(r3.reserved).toBeUndefined();
    expect(escalations).toBe(1);
    expect(capturedQuestion).toContain('poison-looped');
    // The twice-reserved leaf is NOT dropped (still the live work; a human decides).
    expect(getTodo(project, currentId)!.status).not.toBe('dropped');
    // Total leaves = original + 2 clones = 3; never a 4th.
    const leaves = listTodos(project, { includeCompleted: true }).filter((t) => t.kind === 'leaf');
    expect(leaves.length).toBe(3);
  });

  test('escalation via the REAL supervisor-store default (no injected dep)', async () => {
    let currentId = await makeLeaf();
    recordRejectedRun(currentId, 'B0', 0);
    recordRejectedRun(currentId, 'B0', 1);
    currentId = (await reserveLeaf(project, currentId, { actor: 'c', reason: 'r' })).reserved!;
    recordRejectedRun(currentId, 'B1', 0);
    recordRejectedRun(currentId, 'B1', 1);
    currentId = (await reserveLeaf(project, currentId, { actor: 'c', reason: 'r' })).reserved!;
    recordRejectedRun(currentId, 'B2', 0);
    recordRejectedRun(currentId, 'B2', 1);

    const res = await reserveLeaf(project, currentId, { actor: 'c', reason: 'r' });
    expect(res.reason).toBe('cap-exhausted');
    expect(res.escalationId).toBeTruthy();
  });
});
