/**
 * Every cache keyed by "the project" must use the SAME canonicalisation as the path resolver.
 *
 * WHY: while wiring the stores to store-paths.ts, openDb was switched to canonicalProjectRoot
 * while _closeProject still used the older trackingProjectRoot. The two disagreed for any path
 * they normalise differently, so eviction silently missed the entry it was meant to drop and the
 * caller kept a stale handle — a backfill test caught it only because it reopens a database it
 * has just mutated behind the store's back. That is the same "two keys, one file" defect the
 * resolver exists to remove, reintroduced one layer up. These tests pin the invariant directly
 * so it cannot drift again.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { openDb, _closeProject } from '../todo-store';

const made: string[] = [];
function project(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'cache-key-')));
  mkdirSync(join(p, '.collab'), { recursive: true });
  made.push(p);
  return p;
}
afterEach(() => {
  while (made.length) {
    const p = made.pop()!;
    try { _closeProject(p); } catch { /* ignore */ }
    try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** A handle is live iff a trivial query still works; a closed one throws. */
function isOpen(db: Database): boolean {
  try { db.query('SELECT 1').get(); return true; } catch { return false; }
}

describe('store cache keys are canonical', () => {
  it('two spellings of one project share ONE handle', () => {
    const p = project();
    const a = openDb(p);
    const b = openDb(p + '/'); // trailing slash — a different string, the same project
    expect(b).toBe(a);
  });

  it('a symlinked path shares the handle of its real path', () => {
    const p = project();
    const link = join(tmpdir(), `cache-key-link-${process.pid}-${made.length}`);
    try {
      symlinkSync(p, link);
      const viaReal = openDb(p);
      const viaLink = openDb(link);
      expect(viaLink).toBe(viaReal); // /tmp vs /private/tmp must not fork the cache
    } finally { try { rmSync(link, { force: true }); } catch { /* ignore */ } }
  });

  it('closing by ANY spelling evicts the entry — the bug this file exists for', () => {
    const p = project();
    const db = openDb(p);
    _closeProject(p + '/'); // close using a different spelling than the open used
    expect(isOpen(db)).toBe(false); // the handle really was closed, not missed
    const fresh = openDb(p);
    expect(fresh).not.toBe(db); // and the next open builds a new one
  });

  it('an agent-session worktree resolves to the tracking repo handle', () => {
    const p = project();
    const wt = join(p, '.collab', 'agent-sessions', 'worktrees', 'leaf-exec-xyz');
    mkdirSync(wt, { recursive: true });
    expect(openDb(wt)).toBe(openDb(p));
  });
});
