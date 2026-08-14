// OI-1/build-level acceptance fix: acceptTimeAncestorGate must NOT reverse an
// acceptance for not-being-reachable-from-master when the project is below `drive`
// (build/nudge do not auto-land, so work legitimately lives off master — reversing
// it caused the infinite re-claim loop behind escalation 0ca77927).
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Point the orchestrator-config store at a throwaway supervisor.db BEFORE importing
// the modules that open it (mirrors orchestrator-config.test.ts).
const dir = mkdtempSync(join(tmpdir(), 'oi1-build-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

const { setOrchestratorLevel, _closeDb } = await import('../orchestrator-config');
const { acceptTimeAncestorGate, countStrandedReversals } = await import('../coordinator-live');

afterAll(() => {
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('acceptTimeAncestorGate — OI-1 build-level fix', () => {
  it('accepts at `build` via the short-circuit (no master-reachability probe, no reversal)', async () => {
    // A non-existent/non-git project: at build the level gate returns true BEFORE any
    // git/worktree probe, so acceptance is never reversed → no re-claim loop.
    const project = '/tmp/oi1-build-proj-does-not-exist';
    setOrchestratorLevel(project, 'on');
    const ok = await acceptTimeAncestorGate(project, 'todo-1', 'epic-1', [], 'Trial', 'sess');
    expect(ok).toBe(true);
  });

  it('also accepts at `nudge` (still below drive)', async () => {
    const project = '/tmp/oi1-nudge-proj-does-not-exist';
    setOrchestratorLevel(project, 'on');
    const ok = await acceptTimeAncestorGate(project, 'todo-1', 'epic-1', [], 'Trial', 'sess');
    expect(ok).toBe(true);
  });
});

describe('oi1UnionReachable — union reachability probes', () => {
  it('accepts when the epic-branch arm is reachable even though the trunk arm is false', async () => {
    const project = '/tmp/oi1-union-epic-reachable';
    setOrchestratorLevel(project, 'on');

    // Stub worktree manager: ARM A (trunk) returns false, ARM B (epic) returns true.
    const stubWm = {
      isGitRepoPublic: async () => true,
      resolveIntegrationRef: async () => 'master',
      commitOnIntegration: async (_epicId: string, _todoId: string, ref: string) => {
        // ARM A: trunk probe returns false.
        if (ref === 'master') return false;
        // ARM B: epic branch probe returns true.
        if (ref === 'collab/epic/epic-1') return true;
        return null;
      },
      epicBranchName: (_epicId: string) => 'collab/epic/epic-1',
      // Minimal Oi1LandWorktree stubs (unused in this path, but needed for interface).
      ensureEpic: async () => null,
      landEpicToMaster: async () => ({ landed: false }),
      epicHeadSha: async () => null,
    };

    const deps = {
      authority: (_project: string, _epicId: string, _todos: any[]) => true,
      wm: stubWm,
    };

    const ok = await acceptTimeAncestorGate(project, 'todo-1', 'epic-1', [], 'Trial', 'sess', deps);
    expect(ok).toBe(true);

    // Verify no reversal was recorded (countStrandedReversals should be 0).
    const reversals = countStrandedReversals(project, 'todo-1');
    expect(reversals).toBe(0);
  });

  it('reverses the acceptance when BOTH reachability arms return false', async () => {
    const project = '/tmp/oi1-union-both-false';
    setOrchestratorLevel(project, 'on');

    // Stub worktree manager: both ARM A and ARM B return false (unreachable).
    const stubWm = {
      isGitRepoPublic: async () => true,
      resolveIntegrationRef: async () => 'master',
      commitOnIntegration: async (_epicId: string, _todoId: string, _ref: string) => false,
      epicBranchName: (_epicId: string) => 'collab/epic/epic-1',
      // Minimal Oi1LandWorktree stubs.
      ensureEpic: async () => null,
      landEpicToMaster: async () => ({ landed: false }),
      epicHeadSha: async () => null,
    };

    const deps = {
      authority: (_project: string, _epicId: string, _todos: any[]) => true,
      wm: stubWm,
    };

    const ok = await acceptTimeAncestorGate(project, 'todo-2', 'epic-1', [], 'Trial', 'sess', deps);
    expect(ok).toBe(false);
  });

  it('accepts when ARM A is false and ARM B is null (fail-safe)', async () => {
    const project = '/tmp/oi1-union-null-safe';
    setOrchestratorLevel(project, 'on');

    // Stub worktree manager: ARM A returns false, ARM B returns null (indeterminate).
    const stubWm = {
      isGitRepoPublic: async () => true,
      resolveIntegrationRef: async () => 'master',
      commitOnIntegration: async (_epicId: string, _todoId: string, ref: string) => {
        if (ref === 'master') return false;
        if (ref === 'collab/epic/epic-1') return null;
        return null;
      },
      epicBranchName: (_epicId: string) => 'collab/epic/epic-1',
      // Minimal Oi1LandWorktree stubs.
      ensureEpic: async () => null,
      landEpicToMaster: async () => ({ landed: false }),
      epicHeadSha: async () => null,
    };

    const deps = {
      authority: (_project: string, _epicId: string, _todos: any[]) => true,
      wm: stubWm,
    };

    const ok = await acceptTimeAncestorGate(project, 'todo-3', 'epic-1', [], 'Trial', 'sess', deps);
    expect(ok).toBe(true);
  });
});
