// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// FIX: repair-forge pre-validates each batch item's criterion before forging.
//
// runRepairForgePass now partitions the selected batch into citable and uncitable items
// (using classifyCriterion with empty declaredFiles). Each uncitable item gets its own
// escalation card (kind: 'repair-request-uncitable', audience: 'human', operatorGated: true)
// and stays open for re-selection in the next pass.
//
// Only citable items are forged. If the citable batch is empty, the pass returns early
// with reason 'no-citable-batch'.
//
// Hermetic: every test runs against a fresh mkdtemp project; no real .collab/*.db and no
// ~/.mermaid-collab access.
import { describe, test, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _closeProject,
  createTodo,
  getTodo,
  listTodos,
} from '../todo-store';
import {
  listMissions,
  _resetMissionDbCache,
} from '../mission-store';
import { ensureBucket } from '../bucket-registry';
import {
  buildRepairMissionSpec,
  type RepairBatchItem,
} from '../repair-mission-forge';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { runRepairForgePass, _resetRepairForgeThrottle, REPAIR_UNCITABLE_KIND } from '../repair-mission-pass';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'repair-forge-uncitable-prevalidation-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('repair-forge uncitable prevalidation', () => {
  it('forges the 4 citable items, leaves the uncitable one open, and cards it', async () => {
    _resetRepairForgeThrottle(project);
    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 5 bugfix leaves where index 1 is uncitable (command-result).
    const leafIds: string[] = [];
    let uncitableLeafId: string | null = null;
    for (let i = 0; i < 5; i++) {
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans:
            i === 1 ? 'all tests pass and the build is green' // UNCITABLE: command result
              : `Fixed means criterion ${i + 1}`,
        },
      });
      leafIds.push(leaf.id);
      if (i === 1) uncitableLeafId = leaf.id;
    }

    // Capture escalations created during the pass.
    const capturedEscalations: any[] = [];
    const captureFn = (input: any) => {
      capturedEscalations.push(input);
      return { escalation: {} as any, isNew: true };
    };

    // Run the pass.
    const result = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: captureFn,
    });

    // Verify the pass forged with reason 'forged'.
    expect(result.reason).toBe('forged');
    expect(result.forged).not.toBe(null);

    // Verify 4 citable items were forged.
    expect(result.forged!.criteriaCount).toBe(4);
    expect(result.forged!.consumed.length).toBe(4);

    // Verify the uncitable item is not in consumed.
    expect(result.forged!.consumed).not.toContain(uncitableLeafId);

    // Verify the uncitable item's todo status is not done/dropped.
    const uncitableTodo = getTodo(project, uncitableLeafId!)!;
    expect(uncitableTodo.status).not.toBe('done');
    expect(uncitableTodo.status).not.toBe('dropped');
    expect(uncitableTodo.promotedTo).toBe(null);

    // Verify exactly one escalation was created for the uncitable item.
    const uncitableEscalations = capturedEscalations.filter(
      (esc) => esc.kind === REPAIR_UNCITABLE_KIND && esc.todoId === uncitableLeafId
    );
    expect(uncitableEscalations.length).toBe(1);

    // Verify the escalation has the correct attributes.
    const uncitableEsc = uncitableEscalations[0];
    expect(uncitableEsc.audience).toBe('human');
    expect(uncitableEsc.operatorGated).toBe(true);
    expect(uncitableEsc.conditionKey).toBe(`repair-forge-uncitable:${uncitableLeafId}`);
    expect(uncitableEsc.questionText).toContain('Bugfix 2'); // title
    expect(uncitableEsc.questionText).toContain('command-result'); // kind
  });

  it('logs every selected item id when the forge throws and rethrows', async () => {
    _resetRepairForgeThrottle(project);
    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 5 bugfix leaves (all citable).
    const leafIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
      leafIds.push(leaf.id);
    }

    // Capture log calls.
    const capturedLogs: string[] = [];
    const logFn = (msg: string) => capturedLogs.push(msg);

    // Run the pass with a forge function that throws.
    let caughtError: unknown;
    try {
      await runRepairForgePass(project, {
        threshold: 5,
        forge: async () => {
          throw new Error('Forge failed: boom');
        },
        createEscalation: () => ({
          escalation: {} as any,
          isNew: true,
        }),
        log: logFn,
      });
    } catch (err) {
      caughtError = err;
    }

    // Verify the error was rethrown.
    expect(caughtError).not.toBe(undefined);
    expect(String(caughtError)).toContain('Forge failed: boom');

    // Verify a log line was emitted naming all selected batch item ids.
    const relevantLogs = capturedLogs.filter((log) => log.includes('[repair-forge] forge threw for items'));
    expect(relevantLogs.length).toBeGreaterThan(0);

    // Verify all 5 item ids appear in the log.
    const logLine = relevantLogs[0];
    for (const leafId of leafIds) {
      expect(logLine).toContain(leafId);
    }
  });
});
