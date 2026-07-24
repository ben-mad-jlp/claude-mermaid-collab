// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Unit tests for the 3j DEP-STRAND SETTLE + DECISION sweep in src/services/reconcile-pass.ts:
// the wiring of dep-settlement.ts's primitives into the periodic pass. Harness mirrors
// reconcile-pass.test.ts (MERMAID_SUPERVISOR_DIR temp dir + one temp dir per project so each
// test gets its own todos.db).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolation: point the global supervisor.db at a temp dir BEFORE the store opens it.
const supDir = mkdtempSync(join(tmpdir(), 'dss-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import { runReconcilePass, DEP_STRAND_DECISION_KIND, _resetReconcileThrottle } from '../reconcile-pass';
import { listOpenEscalations, listEscalations, resolveEscalation, _closeDb } from '../supervisor-store';
import { createTodo, updateTodo, getTodo, listTodos, openDb } from '../todo-store';
import { isClaimable, claimReason } from '../claimability';
import { DUP_OF_LANDED, repointDependents } from '../dep-settlement';

const todoBase = mkdtempSync(join(tmpdir(), 'dss-todos-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { _closeDb(); });
beforeEach(() => {
  // Re-assert OUR supervisor dir + reopen the singleton (last loader wins the env when
  // several store-touching files share a process), and clear the per-project throttle
  // clock so a same-test second pass is never suppressed.
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb();
  _resetReconcileThrottle();
});
afterAll(() => {
  _closeDb();
  rmSync(supDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

/** No public verb sets a custom heldReason, so pin the held state with raw SQL. */
function hold(project: string, id: string, reason: string): void {
  openDb(project)
    .prepare('UPDATE todos SET heldAt = ?, heldReason = ? WHERE id = ?')
    .run(new Date().toISOString(), reason, id);
}

function strandCards(project: string) {
  return listOpenEscalations().filter((e) => e.project === project && e.kind === DEP_STRAND_DECISION_KIND);
}

function byIdNow(project: string) {
  return new Map(listTodos(project, { includeCompleted: true }).map((t) => [t.id, t]));
}

async function leaf(project: string, title: string, dependsOn?: string[], parentId?: string) {
  return createTodo(project, { allowOrphan: true, ownerSession: 'w', title, status: 'ready', dependsOn, parentId });
}

async function epic(project: string, title: string) {
  return createTodo(project, { allowOrphan: true, ownerSession: 'w', title, kind: 'epic', status: 'ready' });
}

/** Raw SQL, deliberately: `updateTodo`'s drop cascades to children, which would erase
 *  the "live children under a terminal ancestor" shape these tests exercise. */
function dropEpic(project: string, id: string): void {
  openDb(project).prepare("UPDATE todos SET status = 'dropped' WHERE id = ?").run(id);
}

describe('runReconcilePass — 3j held dup-of-landed self-settle', () => {
  it('settles a held dup-of-landed leaf and makes its dependent claimable in ONE pass', async () => {
    const project = freshProject();
    const dep = await leaf(project, 'dup of landed work');
    const dependent = await leaf(project, 'depends on the dup', [dep.id]);
    hold(project, dep.id, `${DUP_OF_LANDED}:abc12345`);

    // Before: the held dep satisfies nothing, so the dependent parks deps-pending.
    const before = byIdNow(project);
    expect(claimReason(before.get(dependent.id)!, before)).toBe('deps-pending');

    await runReconcilePass(project);

    const settled = getTodo(project, dep.id)!;
    expect(settled.status).toBe('done');
    expect(settled.acceptanceStatus).toBe('accepted');
    expect(settled.completedBy?.startsWith(`${DUP_OF_LANDED}:`)).toBe(true);

    const after = byIdNow(project);
    expect(isClaimable(after.get(dependent.id)!, after)).toBe(true);

    // A self-settled dep is NOT also carded — the settle phase runs before the card phase.
    expect(strandCards(project)).toHaveLength(0);
  });

  it('is idempotent — a second pass neither re-settles the dep nor raises a card', async () => {
    const project = freshProject();
    const dep = await leaf(project, 'dup of landed work');
    await leaf(project, 'depends on the dup', [dep.id]);
    hold(project, dep.id, `${DUP_OF_LANDED}:abc12345`);

    await runReconcilePass(project);
    const afterFirst = getTodo(project, dep.id)!.updatedAt;

    _resetReconcileThrottle();
    await runReconcilePass(project);

    expect(getTodo(project, dep.id)!.updatedAt).toBe(afterFirst);
    expect(strandCards(project)).toHaveLength(0);
  });
});

describe('runReconcilePass — 3j strand decision cards', () => {
  it('raises exactly ONE card for a dropped leaf with live dependents, naming both short-ids, and does not duplicate it', async () => {
    const project = freshProject();
    const dropped = await leaf(project, 'abandoned dep');
    const dependent = await leaf(project, 'stranded on the drop', [dropped.id]);
    await updateTodo(project, dropped.id, { status: 'dropped' });

    const before = byIdNow(project);
    expect(claimReason(before.get(dependent.id)!, before)).toBe('dep-dropped');

    await runReconcilePass(project);

    const cards = strandCards(project);
    expect(cards).toHaveLength(1);
    expect(cards[0].todoId).toBe(dropped.id);
    expect(cards[0].questionText).toContain(dropped.id.slice(0, 8));
    expect(cards[0].questionText).toContain(dependent.id.slice(0, 8));
    expect(cards[0].questionText).toContain('dropped');

    // Second pass: the strand persists, so the card must be re-found and NOT re-created
    // (stable questionText dedup — a per-run token here would flood a card every tick).
    _resetReconcileThrottle();
    await runReconcilePass(project);

    expect(strandCards(project)).toHaveLength(1);
    expect(
      listEscalations().filter((e) => e.project === project && e.kind === DEP_STRAND_DECISION_KIND),
    ).toHaveLength(1);
  });

  it("raises a card for a leaf held 'manual' whose dependents park deps-pending", async () => {
    const project = freshProject();
    const held = await leaf(project, 'held by a human');
    const dependent = await leaf(project, 'stranded on the hold', [held.id]);
    hold(project, held.id, 'manual');

    const before = byIdNow(project);
    expect(claimReason(before.get(dependent.id)!, before)).toBe('deps-pending');

    await runReconcilePass(project);

    const cards = strandCards(project);
    expect(cards).toHaveLength(1);
    expect(cards[0].todoId).toBe(held.id);
    expect(cards[0].questionText).toContain('held: manual');
    expect(cards[0].questionText).toContain(dependent.id.slice(0, 8));
  });

  it('raises no card for a dropped leaf nothing depends on', async () => {
    const project = freshProject();
    const dropped = await leaf(project, 'abandoned, unreferenced');
    await updateTodo(project, dropped.id, { status: 'dropped' });

    await runReconcilePass(project);

    expect(strandCards(project)).toHaveLength(0);
  });

  it('auto-closes the card once the stranded dependents are re-pointed away', async () => {
    const project = freshProject();
    const dropped = await leaf(project, 'abandoned dep');
    const replacement = await leaf(project, 'replacement dep');
    await leaf(project, 'stranded on the drop', [dropped.id]);
    await updateTodo(project, dropped.id, { status: 'dropped' });

    await runReconcilePass(project);
    expect(strandCards(project)).toHaveLength(1);

    // The human remediation the card offers: re-point the edge at the replacement.
    const { affected } = repointDependents(project, dropped.id, replacement.id, {
      actor: 'test',
      reason: 'strand remediation',
    });
    expect(affected).toHaveLength(1);

    _resetReconcileThrottle();
    await runReconcilePass(project);

    expect(strandCards(project)).toHaveLength(0);
  });
});

describe('runReconcilePass — 3j dead-subtree skip + condition-key identity', () => {
  it('dropped leaf with dependents under a DROPPED epic raises no card', async () => {
    const project = freshProject();
    const dead = await epic(project, 'dead epic');
    const dropped = await leaf(project, 'abandoned dep', undefined, dead.id);
    await leaf(project, 'stranded on the drop', [dropped.id], dead.id);
    await updateTodo(project, dropped.id, { status: 'dropped' });
    dropEpic(project, dead.id);

    await runReconcilePass(project);

    expect(strandCards(project)).toHaveLength(0);
  });

  it('same shape under a live epic raises exactly one card', async () => {
    const project = freshProject();
    const live = await epic(project, 'live epic');
    const dropped = await leaf(project, 'abandoned dep', undefined, live.id);
    const dependent = await leaf(project, 'stranded on the drop', [dropped.id], live.id);
    await updateTodo(project, dropped.id, { status: 'dropped' });

    await runReconcilePass(project);

    const cards = strandCards(project);
    expect(cards).toHaveLength(1);
    expect(cards[0].questionText).toContain(dropped.id.slice(0, 8));
    expect(cards[0].questionText).toContain(dependent.id.slice(0, 8));
  });

  it('resolving a dep-strand card then re-running the sweep with an unchanged graph creates zero new cards', async () => {
    const project = freshProject();
    const dropped = await leaf(project, 'abandoned dep');
    await leaf(project, 'stranded on the drop', [dropped.id]);
    await updateTodo(project, dropped.id, { status: 'dropped' });

    await runReconcilePass(project);
    const cards = strandCards(project);
    expect(cards).toHaveLength(1);

    resolveEscalation(cards[0].id, 'resolved', 'human');
    _resetReconcileThrottle();
    await runReconcilePass(project);

    const rows = listEscalations().filter((e) => e.project === project && e.kind === DEP_STRAND_DECISION_KIND);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('resolved');
    expect(strandCards(project)).toHaveLength(0);
  });

  it('changing the dependent set creates exactly one new card', async () => {
    const project = freshProject();
    const dropped = await leaf(project, 'abandoned dep');
    await leaf(project, 'stranded on the drop', [dropped.id]);
    await updateTodo(project, dropped.id, { status: 'dropped' });

    await runReconcilePass(project);
    const firstCards = strandCards(project);
    expect(firstCards).toHaveLength(1);
    resolveEscalation(firstCards[0].id, 'resolved', 'human');

    const dependent2 = await leaf(project, 'second stranded dependent', [dropped.id]);
    _resetReconcileThrottle();
    await runReconcilePass(project);

    const openCards = strandCards(project);
    expect(openCards).toHaveLength(1);
    expect(openCards[0].questionText).toContain(dependent2.id.slice(0, 8));

    const rows = listEscalations().filter((e) => e.project === project && e.kind === DEP_STRAND_DECISION_KIND);
    expect(rows).toHaveLength(2);
  });

  it('a persisting strand across N sweeps yields ONE open card with recurrenceCount incremented', async () => {
    const project = freshProject();
    const dropped = await leaf(project, 'abandoned dep');
    await leaf(project, 'stranded on the drop', [dropped.id]);
    await updateTodo(project, dropped.id, { status: 'dropped' });

    for (let i = 0; i < 3; i++) {
      _resetReconcileThrottle();
      await runReconcilePass(project);
    }

    const cards = strandCards(project);
    expect(cards).toHaveLength(1);
    expect(cards[0].recurrenceCount).toBe(2);
  });
});
