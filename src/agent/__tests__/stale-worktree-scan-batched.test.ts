/**
 * listStaleWorktrees must answer the same questions with a bounded number of git processes.
 *
 * MEASURED 2026-08-11: it spawned `rev-parse` + `log -1` PER WORKTREE — ~25 processes for a
 * dozen worktrees, synchronously on the thread that serves /api/health. Stack samples of a
 * wedged sidecar showed posix_spawn on the main thread beside SQLite, the friction-watch pass
 * blew its own 90s budget 99 times, and the liveness watchdog SIGKILLed the sidecar repeatedly.
 *
 * The batching is only safe because HEAD shas come from the porcelain output, so ages stay
 * exact for DETACHED worktrees — 5 of ours are detached, and their HEAD is not any branch tip.
 * Batching by ref would mis-age exactly the worktrees most likely to be abandoned, so the
 * detached case is tested explicitly rather than assumed.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorktreeManager } from '../worktree-manager';

const made: string[] = [];
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

function git(cwd: string, args: string[]): string {
  const p = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  if (p.exitCode !== 0) {
    // Throw on a failed fixture command: a silently broken setup becomes a wrong assertion.
    throw new Error(`git ${args.join(' ')}: ${new TextDecoder().decode(p.stderr)}`);
  }
  return new TextDecoder().decode(p.stdout).trim();
}

function repoWithWorktrees(): { root: string; attached: string; detached: string } {
  const raw = mkdtempSync(join(tmpdir(), 'stale-scan-'));
  made.push(raw);
  // git reports resolved paths (/private/var on macOS); resolve here or every comparison misses.
  const root = realpathSync(raw);
  git(root, ['init', '-q', '-b', 'master']);
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);

  const attached = join(root, 'wt-attached');
  git(root, ['worktree', 'add', '-q', '-b', 'feature', attached]);

  // Detached: no branch at all, so its age can only come from its own HEAD sha.
  const detached = join(root, 'wt-detached');
  const sha = git(root, ['rev-parse', 'HEAD']);
  git(root, ['worktree', 'add', '-q', '--detach', detached, sha]);

  return { root, attached, detached };
}

const mgr = (root: string) =>
  new WorktreeManager({
    projectRoot: root,
    baseDir: join(root, '.collab', 'worktrees'),
    persistDir: join(root, '.collab'),
  });

describe('stale worktree scan', () => {
  it('reports nothing when every worktree is fresh and its branch is alive', async () => {
    const { root } = repoWithWorktrees();
    const stale = await mgr(root).listStaleWorktrees();
    expect(stale).toEqual([]);
  });

  it('ages a DETACHED worktree from its own HEAD, not from a branch tip', async () => {
    const { root, detached } = repoWithWorktrees();
    // Everything is seconds old, so a zero-tolerance window must flag it — proving the age was
    // actually resolved. A detached worktree has no ref to read, so a ref-based lookup would
    // silently report ageMs 0 and never flag it.
    const stale = await mgr(root).listStaleWorktrees({ maxAgeMs: 0 });
    const row = stale.find((s) => s.path === detached);
    expect(row).toBeDefined();
    expect(row!.reason).toBe('stale');
    expect(row!.ageMs).toBeGreaterThan(0);
    expect(row!.branch).toBeNull();
  });

  it('flags a worktree whose branch was deleted', async () => {
    const { root, attached } = repoWithWorktrees();
    // Force-delete the ref out from under the worktree.
    rmSync(join(root, '.git', 'refs', 'heads', 'feature'), { force: true });
    const stale = await mgr(root).listStaleWorktrees();
    const row = stale.find((s) => s.path === attached);
    expect(row?.reason).toBe('branch-gone');
  });

  it('never reports the MAIN checkout as stale, even via a symlinked project root', async () => {
    const { root } = repoWithWorktrees();
    // Hand the manager the UNRESOLVED path (/var/... on macOS) while git reports the resolved
    // one (/private/var/...). path.resolve does not follow symlinks, so a resolve-only guard
    // misses here and files friction against the repo itself. Passing the already-resolved
    // path makes both sides agree and the assertion vacuous.
    const unresolved = root.startsWith('/private/') ? root.slice('/private'.length) : root;
    const m = new WorktreeManager({
      projectRoot: unresolved,
      baseDir: join(unresolved, '.collab', 'worktrees'),
      persistDir: join(unresolved, '.collab'),
    });
    const stale = await m.listStaleWorktrees({ maxAgeMs: 0 });
    expect(stale.some((s) => realpathSync(s.path) === root)).toBe(false);
  });

  it('spawns a BOUNDED number of git processes, not one per worktree', async () => {
    const { root } = repoWithWorktrees();
    // Add more worktrees; the git-call count must not scale with them.
    // DISTINCT commits per worktree. With every worktree on the same sha the set of HEADs
    // dedups to one, the batch and the per-sha fallback cost the same, and the bound below
    // cannot tell them apart — the first cut of this test was vacuous for exactly that reason.
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(root, `f${i}.txt`), `${i}\n`);
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', `c${i}`]);
      git(root, ['worktree', 'add', '-q', '--detach', join(root, `extra-${i}`), git(root, ['rev-parse', 'HEAD'])]);
    }

    const m = mgr(root) as unknown as { runGit: (...a: unknown[]) => Promise<unknown> };
    const original = m.runGit.bind(m);
    let calls = 0;
    m.runGit = (...a: unknown[]) => { calls++; return original(...a); };

    await (m as unknown as WorktreeManager).listStaleWorktrees();

    // porcelain list + for-each-ref + one batched log = 3, plus isGitRepo's probe. The old
    // implementation cost 2 per worktree (12+ here) and grew with every epic.
    expect(calls).toBeLessThanOrEqual(6);
  });
});
