import { describe, test, it, beforeEach, afterEach, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import {
  createTodo,
  claimTodo,
  completeTodo,
  updateTodo,
  resetTodo,
  removeTodo,
  overrideAcceptTodo,
  releaseClaim,
  getTodo,
  ZERO_ROW_CONTENTION_VERBS,
  _closeProject,
} from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

// Functions that MUST affect exactly one row on success; if res.changes === 0, throw
interface MustAffectRowEntry {
  name: string;
  success: (project: string, id: string) => Promise<void>;
  successEffect: 'advances-updatedAt' | 'deletes-row';
  failure: (project: string, id: string) => Promise<void>;
  failureMatch: RegExp[];
}

export const MUST_AFFECT_A_ROW_VERBS: MustAffectRowEntry[] = [
  {
    name: 'updateTodo',
    success: async (project: string, id: string) => {
      await updateTodo(project, id, { title: 'updated' });
    },
    successEffect: 'advances-updatedAt',
    failure: async (project: string, id: string) => {
      await updateTodo(project, 'nonexistent-id-12345', { title: 'update' });
    },
    failureMatch: [/not found/i],
  },
  {
    name: 'completeTodo',
    success: async (project: string, id: string) => {
      const claimed = await claimTodo(project, id, 'agent-A', 60000);
      await completeTodo(project, id, 'accepted');
    },
    successEffect: 'advances-updatedAt',
    failure: async (project: string, id: string) => {
      const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'test', status: 'ready' });
      const a = await claimTodo(project, t.id, 'agent-A', 60000);
      const tokenA = a!.claimToken!;
      await releaseClaim(project, t.id);
      await claimTodo(project, t.id, 'agent-B', 60000);
      // Try to complete with stale token (triggers claim-scoped CAS path)
      await completeTodo(project, t.id, 'accepted', undefined, { claimToken: tokenA });
    },
    failureMatch: [/precondition failed/i, /claim/i, /reset_todo/i],
  },
  {
    name: 'resetTodo',
    success: async (project: string, id: string) => {
      await resetTodo(project, id);
    },
    successEffect: 'advances-updatedAt',
    failure: async (project: string, id: string) => {
      await resetTodo(project, 'nonexistent-id-12345');
    },
    failureMatch: [/not found/i],
  },
  {
    name: 'removeTodo',
    success: async (project: string, id: string) => {
      await removeTodo(project, id);
    },
    successEffect: 'deletes-row',
    failure: async (project: string, id: string) => {
      await removeTodo(project, 'nonexistent-id-12345');
    },
    failureMatch: [/not found/i],
  },
  {
    name: 'overrideAcceptTodo',
    success: async (project: string, id: string) => {
      await claimTodo(project, id, 'agent-A', 60000);
      await overrideAcceptTodo(project, id, 'steward');
    },
    successEffect: 'advances-updatedAt',
    failure: async (project: string, id: string) => {
      await overrideAcceptTodo(project, 'nonexistent-id-12345', 'steward');
    },
    failureMatch: [/not found/i],
  },
];

// Re-export for visibility and mutation probe testing
export { ZERO_ROW_CONTENTION_VERBS };

// Functions that do NOT have a single-row WHERE id = ? contract
// (bulk operations, backfills, sweeps, or internal helpers)
// Enumerated from todo-store.ts by scanning for single-row WHERE id = ? patterns
export const NON_SINGLE_ROW_CONTRACT_VERBS: Record<string, string> = {
  backfillBucketTypeV5: 'bulk backfill: updates all buckets by id set',
  backfillTriageTagV6: 'bulk backfill: updates multiple todos',
  backfillClaimAndKindV7: 'bulk backfill: updates all rows with backfill migrations',
  backfillLandedAtAndGateV8: 'bulk backfill: updates multiple epics',
  backfillTitlePrefixV9: 'bulk backfill: updates multiple todos by title pattern',
  backfillNicknameV10: 'bulk backfill: updates todos with nicknames',
  backfillDeconflateV1: 'bulk backfill: updates all legacy claim rows',
  backfillParentReleaseV2: 'bulk backfill: updates held todos',
  backfillEpicsUnderMission: 'bulk backfill: updates/creates epic structure',
  writeClaim: 'internal: bulk write of claim to single or batch rows',
  restoreTodoStoredState: 'bulk restore: updates multiple todos from durable state',
  snapshotDroppedDescendants: 'internal: reads snapshot only, no writes',
  restoreDroppedDescendants: 'bulk restore: updates multiple dropped descendants',
  closeEpicIfChildrenSettled: 'conditional update: may close 0..N epics on recursion',
  sweepEpicRollups: 'bulk sweep: updates multiple epic statuses',
  sweepTerminalBucketChildren: 'bulk sweep: updates/archives multiple children',
  reviveTerminalBuckets: 'bulk revival: updates multiple bucket rows',
  archiveTodosByIds: 'bulk archive: updates multiple todos',
  clearCompleted: 'bulk delete: removes multiple todos bottom-up',
  reorder: 'bulk reorder: updates all passed ids',
  restoreTodo: 'special: SELECT checks existence; single UPDATE; guards UPDATE with read',
  holdLeafIfOwned: 'owned-gated: returns false if row not in_progress; UPDATE only if owned',
  markRejectingIfOwned: 'owned-gated: returns false if not in_progress; UPDATE only if owned',
  bumpRetryCountIfOwned: 'owned-gated: returns false if not in_progress; UPDATE only if owned',
  decrementRetryCountIfOwned: 'owned-gated: returns false if not in_progress; UPDATE only if owned',
  refundBaseMovedRetryIfUnderCap: 'owned-gated: bulk refund logic with cap check',
  splitLeafInto: 'multi-create: creates multiple new leaves from one parent',
  collapseSplit: 'multi-update: updates multiple split children + parent',
  promoteBucketItemToEpic: 'multi-create: creates epic and updates item',
  createTodo: 'create: INSERT new row',
  migrateProjectKinds: 'bulk migrate: updates all todos by kind',
  migrateAllRegisteredProjects: 'bulk migrate: updates all projects',
};

// Scan todo-store.ts at test time to verify exhaustiveness
function scanTodoStoreForSingleRowMutations(): Set<string> {
  const todoStoreCode = readFileSync(join(import.meta.dir, '../todo-store.ts'), 'utf-8');

  // Find all export functions
  const exportPattern = /^export (?:async )?function ([A-Za-z0-9_]+)/gm;
  const candidates = new Set<string>();
  let match;
  while ((match = exportPattern.exec(todoStoreCode)) !== null) {
    const funcName = match[1];
    candidates.add(funcName);
  }

  // Filter to only those with single-row WHERE id = ? writes
  const singleRowPattern = /(?:UPDATE todos[\s\S]{0,4000}?WHERE id\s*=\s*\?)|(?:DELETE FROM todos\s+WHERE id\s*=\s*\?)/;
  const singleRowFuncs = new Set<string>();

  for (const func of candidates) {
    // Extract function body: from "export ... function NAME(" to next "^export"
    const bodyMatch = todoStoreCode.match(
      new RegExp(`^export (?:async )?function ${func}\\([^)]*\\)[^{]*\\{[\\s\\S]*?(?=^export |$)`, 'm')
    );
    if (bodyMatch && singleRowPattern.test(bodyMatch[0])) {
      singleRowFuncs.add(func);
    }
  }

  return singleRowFuncs;
}

describe('zero-row write guards', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'zero-row-write-'));
    process.env.MERMAID_SUPERVISOR_DIR = project;
    _closeSupervisorDb();
  });

  afterEach(() => {
    _closeProject(project);
    _closeSupervisorDb();
    delete process.env.MERMAID_SUPERVISOR_DIR;
    rmSync(project, { recursive: true, force: true });
  });

  it('complete_todo on an unclaimed todo throws naming the claim precondition', async () => {
    // Part 1: Stale-token half
    const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'x', status: 'ready' });
    const a = await claimTodo(project, t.id, 'agent-A', 60000);
    const tokenA = a!.claimToken!;
    await releaseClaim(project, t.id);
    const b = await claimTodo(project, t.id, 'agent-B', 60000);
    const tokenB = b!.claimToken!;

    // Verify the throw contains precondition and remedy
    await expect(completeTodo(project, t.id, 'accepted', undefined, { claimToken: tokenA })).rejects.toThrow();
    try {
      await completeTodo(project, t.id, 'accepted', undefined, { claimToken: tokenA });
      throw new Error('Expected completeTodo to throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('precondition failed');
      expect(msg.toLowerCase()).toContain('claim');
      expect(msg).toContain('reset_todo');
    }

    // Verify no mutation: row still in_progress under agent-B
    const after = getTodo(project, t.id)!;
    expect(after.status).toBe('in_progress');
    expect(after.claimToken).toBe(tokenB);

    // Part 2: Complete with the LIVE token
    await Bun.sleep(2); // timing risk — updatedAt is ms-resolution
    const before = getTodo(project, t.id)!;
    const result = await completeTodo(project, t.id, 'accepted', undefined, { claimToken: tokenB });
    const completed = result.completed;

    // Verify the result is the persisted row
    expect(completed.id).toBe(t.id);
    expect(completed.status).toBe('done');
    const live = getTodo(project, t.id)!;
    expect(completed.updatedAt).toBe(live.updatedAt);
    // Verify updatedAt advanced
    expect(Date.parse(live.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
  });

  it('every mutating verb advances updatedAt or throws', async () => {
    for (const verb of MUST_AFFECT_A_ROW_VERBS) {
      if (verb.successEffect === 'advances-updatedAt') {
        // Verify the mutation advances updatedAt
        const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: verb.name, status: 'ready' });
        const before = getTodo(project, t.id)!;
        await Bun.sleep(2); // timing risk: updatedAt is ms-resolution ISO
        await verb.success(project, t.id);
        const after = getTodo(project, t.id)!;
        // Verify updatedAt advanced (only if the todo still exists, e.g., not removed)
        if (after) {
          expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
        }
      } else if (verb.successEffect === 'deletes-row') {
        // For removeTodo, verify the row is gone
        const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'to-remove', status: 'ready' });
        await verb.success(project, t.id);
        const after = getTodo(project, t.id);
        expect(after).toBe(null);
      }

      // Failure path: verify the precondition is named
      try {
        await verb.failure(project, '');
        throw new Error(`Expected ${verb.name} failure to throw`);
      } catch (e) {
        const msg = (e as Error).message;
        for (const pattern of verb.failureMatch) {
          expect(msg).toMatch(pattern);
        }
      }
    }
  });

});

// Verify exhaustiveness at module level: every single-row mutation is classified
const singleRowFuncs = scanTodoStoreForSingleRowMutations();
const mustAffectNames = new Set(MUST_AFFECT_A_ROW_VERBS.map((v) => v.name));
const contention = new Set([...ZERO_ROW_CONTENTION_VERBS] as readonly string[]);
const nonSingleRow = new Set(Object.keys(NON_SINGLE_ROW_CONTRACT_VERBS));

const unclassified: string[] = [];
for (const func of singleRowFuncs) {
  const inMust = mustAffectNames.has(func);
  const inContention = contention.has(func);
  const inNonSingle = nonSingleRow.has(func);

  const count = (inMust ? 1 : 0) + (inContention ? 1 : 0) + (inNonSingle ? 1 : 0);
  if (count !== 1) {
    unclassified.push(`${func} (in ${count} sets: must=${inMust}, contention=${inContention}, nonSingle=${inNonSingle})`);
  }
}

if (unclassified.length > 0) {
  throw new Error(`Unclassified or multiply-classified single-row mutations:\n${unclassified.join('\n')}`);
}
