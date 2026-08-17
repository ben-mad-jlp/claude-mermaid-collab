// Stranded acceptance + branch reachability: epic-branch and neither-ref arms of
// oi1UnionReachable must handle the cases where a leaf's trailer commit is reachable
// only from the epic branch (not master) or from neither integration nor epic branch.
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Point the orchestrator-config store at a throwaway supervisor.db BEFORE importing
// the modules that open it.
const dir = mkdtempSync(join(tmpdir(), 'stranded-accept-branch-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

const { setOrchestratorLevel, _closeDb } = await import('../orchestrator-config');
const { oi1UnionReachable, acceptTimeAncestorGate, countStrandedReversals } = await import('../coordinator-live');

afterAll(() => {
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('oi1UnionReachable — epic-branch and neither-ref arms', () => {
  it('an accepted leaf whose trailer commit is on the epic branch is never reversed', async () => {
    const project = '/tmp/stranded-accept-branch-epic-arm';
    const epicId = 'abc12345';
    const todoId = 'epic-branch-todo';
    const title = 'test epic';

    setOrchestratorLevel(project, 'on');

    // Stub worktree manager: ARM A (trunk/master) returns false, ARM B (epic branch) returns true.
    const stubWm = {
      isGitRepoPublic: async () => true,
      resolveIntegrationRef: async () => 'master',
      commitOnIntegration: async (_epicId: string, _todoId: string, ref: string) => {
        // ARM A: trunk probe (master) returns false.
        if (ref === 'master') return false;
        // ARM B: epic branch probe returns true.
        if (ref === `collab/epic/${epicId}`) return true;
        return null;
      },
      epicBranchName: (_epicId: string) => `collab/epic/${epicId}`,
      // Minimal Oi1LandWorktree stubs (unused in this path, but needed for interface).
      ensureEpic: async () => null,
      landEpicToMaster: async () => ({ landed: false }),
      epicHeadSha: async () => null,
    };

    const deps = {
      authority: (_project: string, _epicId: string, _todos: any[]) => true,
      wm: stubWm,
    };

    // Test oi1UnionReachable and verify field-by-field.
    const result = await oi1UnionReachable(stubWm, epicId, todoId, 'master');
    expect(result.verdict).toBe('reachable');
    expect(result.reachableTrunk).toBe(false);
    expect(result.reachableEpic).toBe(true);

    // Test acceptTimeAncestorGate: must accept (not reverse) when epic arm is reachable.
    const ok = await acceptTimeAncestorGate(project, todoId, epicId, [], title, 'sess', deps);
    expect(ok).toBe(true);

    // Verify no reversal was recorded.
    const reversals = countStrandedReversals(project, todoId);
    expect(reversals).toBe(0);
  });

  it('a leaf whose trailer is on neither ref is reversed', async () => {
    const project = '/tmp/stranded-accept-branch-neither';
    const epicId = 'def67890';
    const todoId = 'neither-ref-todo';
    const title = 'test epic 2';

    setOrchestratorLevel(project, 'on');

    // Stub worktree manager: both ARM A and ARM B return false (unreachable from both refs).
    const stubWm = {
      isGitRepoPublic: async () => true,
      resolveIntegrationRef: async () => 'master',
      commitOnIntegration: async (_epicId: string, _todoId: string, _ref: string) => false,
      epicBranchName: (_epicId: string) => `collab/epic/${epicId}`,
      // Minimal Oi1LandWorktree stubs.
      ensureEpic: async () => null,
      landEpicToMaster: async () => ({ landed: false }),
      epicHeadSha: async () => null,
    };

    const deps = {
      authority: (_project: string, _epicId: string, _todos: any[]) => true,
      wm: stubWm,
    };

    // Test oi1UnionReachable and verify both arms are false.
    const result = await oi1UnionReachable(stubWm, epicId, todoId, 'master');
    expect(result.verdict).toBe('unreachable');
    expect(result.reachableTrunk).toBe(false);
    expect(result.reachableEpic).toBe(false);

    // Test acceptTimeAncestorGate: must reject (reverse acceptance) when both arms are false.
    const ok = await acceptTimeAncestorGate(project, todoId, epicId, [], title, 'sess', deps);
    expect(ok).toBe(false);
  });
});
