import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'sup-store-esc-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  createEscalation,
  getEscalation,
  listOpenEscalations,
  _closeDb,
} from '../supervisor-store';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

/**
 * Regression for the worktree-scoped escalation bug (incident 2026-06-09, todo
 * bc75ebb2): a worker under isolation has cwd = <repo>/.collab/agent-sessions/
 * worktrees/<lane>, so createEscalation stored that worktree path as `project`
 * and the escalation never appeared in the repo-root inbox — the human never
 * saw it, await_human_decision timed out, the worker stalled. Fix: normalize
 * `project` through trackingProjectRoot at the write boundary.
 */
describe('createEscalation — worktree project normalization', () => {
  const repo = '/Users/me/Code/claude-mermaid-collab';
  const worktree = `${repo}/.collab/agent-sessions/worktrees/backend-1`;

  it('stores an isolated-worker escalation under the tracking repo root, not the worktree path', () => {
    const { escalation, isNew } = createEscalation({
      project: worktree, // worker cwd under isolation
      session: 'worker-abc',
      kind: 'decision',
      questionText: 'scope conflict — how should I proceed?',
    });
    expect(isNew).toBe(true);
    expect(escalation.project).toBe(repo); // normalized, NOT the worktree path
    expect(getEscalation(escalation.id)?.project).toBe(repo);
    // And it surfaces in the repo-root inbox (a UI list filtering by `repo`).
    expect(listOpenEscalations().some((e) => e.id === escalation.id && e.project === repo)).toBe(true);
  });

  it('dedupes a worktree-path and a repo-root escalation to the same row', () => {
    const q = 'same question, two cwds';
    const a = createEscalation({ project: worktree, session: 'w', kind: 'blocker', questionText: q });
    const b = createEscalation({ project: repo, session: 'w', kind: 'blocker', questionText: q });
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false); // matched the existing (normalized) row
    expect(b.escalation.id).toBe(a.escalation.id);
  });

  it('same-repo (non-isolated) project is an identity no-op', () => {
    const { escalation } = createEscalation({
      project: repo,
      session: 'w2',
      kind: 'blocker',
      questionText: 'plain repo-root escalation',
    });
    expect(escalation.project).toBe(repo);
  });
});
