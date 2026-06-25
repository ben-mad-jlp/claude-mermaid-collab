/**
 * Tests for trackingProjectRoot and todo-store worktree cwd resolution (L1 §4):
 *   4a. trackingProjectRoot maps a worktree cwd → tracking repo root.
 *   4b. todo-store resolves a worktree cwd to the tracking repo's todos.db —
 *       a todo written via the repo root is readable via the worktree cwd.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { trackingProjectRoot } from '../project-registry';
import { createTodo, getTodo, _closeProject } from '../todo-store';

describe('trackingProjectRoot — path mapping', () => {
  it('test 4a — maps a worktree cwd to the tracking repo root', () => {
    const repo = '/Users/me/Code/claude-mermaid-collab';
    const wt = `${repo}/.collab/agent-sessions/worktrees/leaf-exec-abc`;
    expect(trackingProjectRoot(wt)).toBe(repo);
  });

  it('test 4a — identity for a non-worktree path (plain repo root)', () => {
    const repo = '/Users/me/Code/claude-mermaid-collab';
    expect(trackingProjectRoot(repo)).toBe(repo);
  });

  it('test 4a — non-greedy match resolves to first .collab/agent-sessions/ anchor', () => {
    // A deeper nested path still resolves to the first (outermost) repo root.
    const repo = '/Users/me/Code/some-repo';
    const wt = `${repo}/.collab/agent-sessions/worktrees/lane-1`;
    expect(trackingProjectRoot(wt)).toBe(repo);
  });

  it('test 4a — Windows-style backslash path resolves correctly', () => {
    const repo = 'C:\\Users\\me\\Code\\project';
    const wt = `${repo}\\.collab\\agent-sessions\\worktrees\\leaf-abc`;
    expect(trackingProjectRoot(wt)).toBe(repo);
  });
});

describe('todo-store — worktree cwd resolves to the tracking todos.db', () => {
  let repo: string;
  let worktreePath: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'tracking-root-test-'));
    worktreePath = join(repo, '.collab', 'agent-sessions', 'worktrees', 'lane-1');
    mkdirSync(worktreePath, { recursive: true });
  });

  afterEach(() => {
    _closeProject(repo);
    // _closeProject normalizes via trackingProjectRoot, so closing with repo root is sufficient.
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('test 4b — todo written via repo root is readable via worktree cwd', async () => {
    const todo = await createTodo(repo, { allowOrphan: true,
      title: 'T',
      ownerSession: 'test',
    });

    // Read via the worktree cwd — should resolve to the same <repo>/.collab/todos.db.
    const viaWorktree = getTodo(worktreePath, todo.id);
    expect(viaWorktree).not.toBeNull();
    expect(viaWorktree!.id).toBe(todo.id);
    expect(viaWorktree!.title).toBe('T');
  });

  it('test 4b — todo written via worktree cwd is readable via repo root', async () => {
    const todo = await createTodo(worktreePath, { allowOrphan: true,
      title: 'written-from-worktree',
      ownerSession: 'test',
    });

    const viaRepo = getTodo(repo, todo.id);
    expect(viaRepo).not.toBeNull();
    expect(viaRepo!.id).toBe(todo.id);
  });
});
