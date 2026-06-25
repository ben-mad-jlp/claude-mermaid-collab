import { describe, it, expect } from 'bun:test';
import { WorktreeManager } from '../worktree-manager.ts';

/**
 * Per-project worktree mutex (todo 6bc2dc36). Git's worktree admin (.git/worktrees +
 * the global `worktree prune`) is NOT safe under concurrent add/remove/prune from
 * multiple leaves on the same repo — a sibling's still-live leaf-exec worktree could be
 * pruned mid-run → ENOENT spawn cascade. WorktreeManager now serialises every
 * worktree-MUTATING method behind an instance-level lock. This test proves two
 * concurrent mutating calls never overlap their git spawns (max concurrency == 1).
 */

function makeTrackingSpawn() {
  let active = 0;
  let maxActive = 0;
  const spawn = (_cmd: string[], _opts: unknown) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    return {
      stdout: null,
      stderr: null,
      // Resolve after a tick so overlap is observable if the lock were absent.
      exited: new Promise<number>((resolve) =>
        setTimeout(() => {
          active -= 1;
          resolve(0);
        }, 8),
      ),
      kill() {},
      on() {},
    };
  };
  return { spawn, getMax: () => maxActive };
}

describe('WorktreeManager — per-project worktree mutex (6bc2dc36)', () => {
  it('serialises concurrent mutating calls (git spawns never overlap)', async () => {
    const { spawn, getMax } = makeTrackingSpawn();
    const mgr = new WorktreeManager({
      projectRoot: '/fake/repo',
      baseDir: '/fake/repo/.collab/wt',
      persistDir: '/fake/repo/.collab',
      spawn: spawn as any,
    });

    // removeEpic makes several git spawns (isGitRepo, worktree remove, prune, branch -D)
    // and has no fs-record dependency — ideal to observe interleaving. Fire 4 concurrently
    // for DIFFERENT epics; with the lock they run one-at-a-time.
    await Promise.all([
      mgr.removeEpic('epic-aaaaaaaa').catch(() => {}),
      mgr.removeEpic('epic-bbbbbbbb').catch(() => {}),
      mgr.removeEpic('epic-cccccccc').catch(() => {}),
      mgr.removeEpic('epic-dddddddd').catch(() => {}),
    ]);

    expect(getMax()).toBe(1); // never two git spawns in flight at once
  });

  it('a failing section does not wedge the queue (next call still runs)', async () => {
    let calls = 0;
    const spawn = (_cmd: string[], _opts: unknown) => {
      calls += 1;
      // First call's process throws on exit; later calls succeed.
      const fail = calls === 1;
      return {
        stdout: null,
        stderr: null,
        exited: fail ? Promise.reject(new Error('boom')) : Promise.resolve(0),
        kill() {},
        on() {},
      };
    };
    const mgr = new WorktreeManager({
      projectRoot: '/fake/repo',
      baseDir: '/fake/repo/.collab/wt',
      persistDir: '/fake/repo/.collab',
      spawn: spawn as any,
    });

    await mgr.removeEpic('epic-aaaaaaaa').catch(() => {});
    // The queue must not be wedged by the first call's rejection.
    await mgr.removeEpic('epic-bbbbbbbb').catch(() => {});
    expect(calls).toBeGreaterThan(1);
  });
});
