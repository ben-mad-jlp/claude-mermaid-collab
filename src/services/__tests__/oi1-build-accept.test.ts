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
const { acceptTimeAncestorGate } = await import('../coordinator-live');

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
    setOrchestratorLevel(project, 'build');
    const ok = await acceptTimeAncestorGate(project, 'todo-1', 'epic-1', [], 'Trial', 'sess');
    expect(ok).toBe(true);
  });

  it('also accepts at `nudge` (still below drive)', async () => {
    const project = '/tmp/oi1-nudge-proj-does-not-exist';
    setOrchestratorLevel(project, 'nudge');
    const ok = await acceptTimeAncestorGate(project, 'todo-1', 'epic-1', [], 'Trial', 'sess');
    expect(ok).toBe(true);
  });
});
