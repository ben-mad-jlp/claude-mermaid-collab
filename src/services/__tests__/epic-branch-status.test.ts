// Pure assembly tests for src/services/epic-branch-status.ts — the git probe is
// injected, so these are hermetic (no real repo, no git spawn). They exercise the
// branch-name derivation, ahead/behind/mergeable mapping, land-leaf join, and the
// BP0 `stranded` flag (done-on-graph, unlanded-on-master).
import { describe, test, expect } from 'bun:test';
import type { Todo, TodoStatus } from '../todo-store';
import {
  buildEpicBranchStatus,
  epicBranchName,
  epicId8,
  type BranchProbe,
  type GitProbe,
} from '../epic-branch-status';

let seq = 0;
function todo(partial: Partial<Todo> & { id?: string; title: string; status?: TodoStatus }): Todo {
  const status = partial.status ?? 'ready';
  return {
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    description: null,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    approvedAt: null,
    approvedBy: null,
    heldAt: null,
    heldReason: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    ...partial,
    id: partial.id ?? `t${++seq}`,
    status,
    completed: status === 'done',
  };
}

/** A probe driven by a branch→facts table; unknown branches read as nonexistent. */
function probeFrom(table: Record<string, BranchProbe>): GitProbe {
  return (branch: string) =>
    table[branch] ?? { exists: false, ahead: null, behind: null, mergeable: null };
}

describe('branch-name derivation', () => {
  test('epicId8 takes the 8-char prefix of a UUID and preserves the inbox sentinel', () => {
    expect(epicId8('c51efd9a-2f1c-422e-ae58-d169ebd897cb')).toBe('c51efd9a');
    expect(epicId8('inbox')).toBe('inbox');
    expect(epicBranchName('c51efd9a-2f1c-422e')).toBe('collab/epic/c51efd9a');
  });
});

describe('buildEpicBranchStatus', () => {
  test('only [EPIC] todos appear; non-epics are ignored', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] feature', status: 'todo' });
    const work = todo({ id: 'w1', title: 'do thing', parentId: 'e1' });
    const report = buildEpicBranchStatus([epic, work], probeFrom({}));
    expect(report.epics).toHaveLength(1);
    expect(report.epics[0].epicId).toBe('e1');
  });

  test('stranded: branch ahead>0 with land leaf not done is flagged', () => {
    const epic = todo({ id: 'abcd1234-0000', title: '[EPIC] strand me', status: 'done' });
    const land = todo({
      id: 'l1',
      title: '[LAND] strand me → master',
      parentId: 'abcd1234-0000',
      status: 'ready',
    });
    const branch = epicBranchName('abcd1234-0000');
    const report = buildEpicBranchStatus(
      [epic, land],
      probeFrom({ [branch]: { exists: true, ahead: 3, behind: 0, mergeable: true } }),
    );
    const e = report.epics[0];
    expect(e.ahead).toBe(3);
    expect(e.landLeafDone).toBe(false);
    expect(e.stranded).toBe(true);
    expect(report.strandedCount).toBe(1);
  });

  test('landed epic: ahead/behind 0 and land leaf done is NOT stranded', () => {
    const epic = todo({ id: 'beef0001-0000', title: '[EPIC] landed', status: 'done' });
    const land = todo({
      id: 'l2',
      title: '[LAND] landed → master',
      parentId: 'beef0001-0000',
      status: 'done',
    });
    const branch = epicBranchName('beef0001-0000');
    const report = buildEpicBranchStatus(
      [epic, land],
      probeFrom({ [branch]: { exists: true, ahead: 0, behind: 0, mergeable: true } }),
    );
    const e = report.epics[0];
    expect(e.ahead).toBe(0);
    expect(e.landLeafDone).toBe(true);
    expect(e.stranded).toBe(false);
    expect(report.strandedCount).toBe(0);
  });

  test('no branch yet: exists false, counts null, not stranded', () => {
    const epic = todo({ id: 'e3', title: '[EPIC] fresh', status: 'planned' });
    const report = buildEpicBranchStatus([epic], probeFrom({}));
    const e = report.epics[0];
    expect(e.exists).toBe(false);
    expect(e.ahead).toBeNull();
    expect(e.landLeafDone).toBeNull(); // no land leaf
    expect(e.stranded).toBe(false);
  });

  test('finds a [LAND] leaf nested below an intermediate child (transitive descendant)', () => {
    const epic = todo({ id: 'e4', title: '[EPIC] deep', status: 'todo' });
    const mid = todo({ id: 'm1', title: 'sub-area', parentId: 'e4' });
    const land = todo({ id: 'l4', title: '[LAND] deep → master', parentId: 'm1', status: 'done' });
    const branch = epicBranchName('e4');
    const report = buildEpicBranchStatus(
      [epic, mid, land],
      probeFrom({ [branch]: { exists: true, ahead: 1, behind: 2, mergeable: false } }),
    );
    const e = report.epics[0];
    expect(e.landLeafDone).toBe(true);
    expect(e.behind).toBe(2);
    expect(e.mergeable).toBe(false);
    expect(e.stranded).toBe(false); // land leaf done ⇒ not stranded even with ahead>0
  });
});
