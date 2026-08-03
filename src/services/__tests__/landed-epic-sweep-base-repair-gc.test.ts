// Regression tests for base-repair epic GC: terminal base-repair epics with newCount>0
// are deleted and their worktrees removed despite the fail-closed ahead>0 rule
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, completeTodo, getTodo, _closeProject,
} from '../todo-store';
import {
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { epicBranchName, type GitProbe } from '../epic-branch-status';
import { gcEpicBranches, type BranchGcRunner } from '../landed-epic-sweep';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'landed-epic-sweep-base-repair-gc-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('gcEpicBranches with baseRepair epics', () => {
  test('done baseRepair epic with newCount>0 is deleted, its worktree is removed, and the tip is recovery-logged', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] repair base',
      kind: 'epic',
      status: 'planned',
      baseRepair: 1,
    });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = async (b) =>
      b === branch
        ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 2 }
        : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null };

    const removeWorktreeCalls: string[] = [];
    const deleteCalls: string[] = [];
    const pruneCalls: string[] = [];

    const runner: BranchGcRunner = {
      revParse: async () => 'repair123',
      deleteBranch: async (b) => {
        deleteCalls.push(b);
        return true;
      },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
      newCount: async () => 2,
      pruneWorktreeFor: async (b) => {
        pruneCalls.push(b);
      },
    };

    const result = await gcEpicBranches(project, {
      probe,
      runner,
      removeEpicWorktree: async (epicId: string) => {
        removeWorktreeCalls.push(epicId);
      },
    });

    // Branch is deleted despite newCount>0
    expect(result.deleted).toContain(branch);
    // Epic is NOT flagged (since it's a baseRepair epic)
    expect(result.flagged).not.toContain(epic.id);
    // removeEpicWorktree was called with the epic id
    expect(removeWorktreeCalls).toContain(epic.id);
    // deleteBranch was called
    expect(deleteCalls).toEqual([branch]);
    // pruneWorktreeFor was also called as normal
    expect(pruneCalls).toEqual([branch]);
    // Tip SHA is recorded in the recovery log
    const log = readFileSync(join(project, '.collab', 'pruned-branches-recovery.md'), 'utf8');
    expect(log).toContain(branch);
    expect(log).toContain('repair123');
  });

  test('identical non-baseRepair done epic with newCount>0 is still flagged, not deleted', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] normal work',
      kind: 'epic',
      status: 'planned',
      // baseRepair: undefined (normal epic)
    });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = async (b) =>
      b === branch
        ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 2 }
        : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null };

    const removeWorktreeCalls: string[] = [];
    const deleteCalls: string[] = [];

    const runner: BranchGcRunner = {
      revParse: async () => 'normal456',
      deleteBranch: async (b) => {
        deleteCalls.push(b);
        return true;
      },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
      newCount: async () => 2,
    };

    const result = await gcEpicBranches(project, {
      probe,
      runner,
      removeEpicWorktree: async (epicId: string) => {
        removeWorktreeCalls.push(epicId);
      },
    });

    // Non-baseRepair epic is flagged
    expect(result.flagged).toContain(epic.id);
    // Branch is NOT deleted
    expect(result.deleted).not.toContain(branch);
    // deleteBranch was never called
    expect(deleteCalls).toEqual([]);
    // removeEpicWorktree was never called
    expect(removeWorktreeCalls).toEqual([]);
  });

  test('open (non-terminal) baseRepair epic is skipped, never deleted', async () => {
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] base repair in progress',
      kind: 'epic',
      status: 'planned', // not completed
      baseRepair: 1,
    });
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = async (b) =>
      b === branch
        ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 1 }
        : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null };

    const removeWorktreeCalls: string[] = [];
    const deleteCalls: string[] = [];

    const runner: BranchGcRunner = {
      revParse: async () => 'open789',
      deleteBranch: async (b) => {
        deleteCalls.push(b);
        return true;
      },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
      newCount: async () => 1,
    };

    const result = await gcEpicBranches(project, {
      probe,
      runner,
      removeEpicWorktree: async (epicId: string) => {
        removeWorktreeCalls.push(epicId);
      },
    });

    // Open epic is skipped (LIVE-EPIC GUARD)
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    // Branch is not deleted (live epic)
    expect(result.deleted).not.toContain(branch);
    // Epic is not flagged (live epic)
    expect(result.flagged).not.toContain(epic.id);
    // deleteBranch was never called
    expect(deleteCalls).toEqual([]);
    // removeEpicWorktree was never called
    expect(removeWorktreeCalls).toEqual([]);
  });
});
