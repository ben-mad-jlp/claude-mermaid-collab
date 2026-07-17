/**
 * Tests for quarantine-MOVE reclamation of reclaimable orphan worktrees: the
 * `WorktreeManager.quarantineMove` / `sweepTrash` primitives, and their wiring into
 * `gcLeafWorktrees`'s class-2 orphan branch via `isReclaimable`. Builds real temp git
 * repos + real `git worktree add` checkouts (mirrors the pattern in
 * orphan-worktree-gc.test.ts / worktree-freshness.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-wt-quarantine-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager } from '../../services/coordinator-live';
import { _closeProject } from '../../services/todo-store';
import { _closeDb as _closeSupervisorDb } from '../../services/supervisor-store';
import { gcLeafWorktrees, WORKTREE_RECLAIM_MIN_AGE_MS } from '../../services/leaf-worktree-reaper';
import { WorktreeManager, WORKTREE_TRASH_TTL_MS } from '../worktree-manager';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

/** Backdate a dir's mtime AND atime past WORKTREE_RECLAIM_MIN_AGE_MS — required for
 *  isReclaimable's age guard. Must run LAST, after every fs mutation that touches the
 *  dir's entries. */
async function backdatePastReclaim(dir: string) {
  const old = new Date(Date.now() - WORKTREE_RECLAIM_MIN_AGE_MS - 60_000);
  await utimes(dir, old, old);
}

/** Commit with an OLD GIT_COMMITTER_DATE so headCommitAgeMs sees a >7-day HEAD. */
async function commitOld(cwd: string, message: string) {
  writeFileSync(join(cwd, 'work.txt'), 'old work\n');
  await runGit(cwd, ['add', '-A']);
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000 - 60_000) / 1000);
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, 'commit', '--message', message], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
      GIT_COMMITTER_DATE: `${sevenDaysAgo} +0000`,
    },
  });
  const [, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return code ?? 0;
}

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('gcLeafWorktrees — quarantine-MOVE reclamation', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'wt-quarantine-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  });

  afterEach(() => {
    _closeProject(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('case 1: reclaimable orphan → quarantined into .collab/.trash with a manifest, pruned from git', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    const laneDir = join(wm.baseDir(), 'lane-reclaimable');
    await runGit(repo, ['worktree', 'add', '-b', 'lane-reclaimable-branch', laneDir]);
    await commitOld(laneDir, 'old work');
    await backdatePastReclaim(laneDir);

    const report = await gcLeafWorktrees(repo);

    // Original path is gone.
    expect(existsSync(laneDir)).toBe(false);

    // report.quarantined records it, with a trash dir that actually exists.
    const entry = report.quarantined.find((q) => q.path === laneDir);
    expect(entry).toBeTruthy();
    expect(entry!.trashDir).toContain(join('.collab', '.trash'));
    expect(existsSync(entry!.trashDir)).toBe(true);

    // manifest.json exists and records the original path.
    const manifestPath = join(entry!.trashDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.origPath).toBe(laneDir);

    // No report.removed / report.refused entry for this dir — it went through quarantine.
    expect(report.removed).not.toContain(laneDir);
    expect(report.refused.find((r) => r.path === laneDir)).toBeFalsy();

    // git worktree admin entry was pruned (no longer registered).
    const registeredNames = (await wm.listRegisteredPaths()).map((p) => p.split('/').pop());
    expect(registeredNames).not.toContain(laneDir.split('/').pop());
  });

  it('case 2: guard-failing dir → left in place, not moved, not force-removed', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    const laneDir = join(wm.baseDir(), 'lane-dirty-guard');
    await runGit(repo, ['worktree', 'add', '-b', 'lane-dirty-guard-branch', laneDir]);
    await commitOld(laneDir, 'old work');
    // Tracked, uncommitted edit — trips isReclaimable's clean guard (a).
    writeFileSync(join(laneDir, 'README.md'), 'edited\n');
    await backdatePastReclaim(laneDir);

    const report = await gcLeafWorktrees(repo);

    // Dir is untouched, contents intact.
    expect(existsSync(laneDir)).toBe(true);
    expect(readFileSync(join(laneDir, 'README.md'), 'utf8')).toBe('edited\n');

    // No quarantine entry for it.
    expect(report.quarantined.find((q) => q.path === laneDir)).toBeFalsy();

    // Flagged as refused — either the pre-isReclaimable dirty check (orphan-dirty) or the
    // isReclaimable gate itself (orphan-not-reclaimable) trips first depending on ordering;
    // either is an acceptable "leave in place" outcome.
    const refusal = report.refused.find((r) => r.path === laneDir);
    expect(refusal).toBeTruthy();
    expect(['orphan-dirty', 'orphan-not-reclaimable']).toContain(refusal!.reason);
  });
});

describe('WorktreeManager.sweepTrash — TTL hard-delete', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(join(tmpdir(), 'wt-trash-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(join(tmpdir(), 'wt-trash-persist-'));
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: join(persistDir, 'worktrees'),
      persistDir,
    });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => {});
  });

  it('removes expired trash-ts dirs, keeps fresh ones with manifest intact', async () => {
    const now = Date.now();
    const expiredTs = now - WORKTREE_TRASH_TTL_MS - 1000;
    const freshTs = now;

    const expiredDir = join(repo, '.collab', '.trash', String(expiredTs), 'lane-expired');
    const freshDir = join(repo, '.collab', '.trash', String(freshTs), 'lane-fresh');
    await fs.mkdir(expiredDir, { recursive: true });
    await fs.mkdir(freshDir, { recursive: true });
    await fs.writeFile(join(expiredDir, 'manifest.json'), JSON.stringify({ origPath: 'x', reason: 'r', ts: expiredTs, branch: null, head: null }));
    await fs.writeFile(join(freshDir, 'manifest.json'), JSON.stringify({ origPath: 'y', reason: 'r', ts: freshTs, branch: null, head: null }));

    const removed = await mgr.sweepTrash(now);

    expect(removed).toContain(join(repo, '.collab', '.trash', String(expiredTs)));
    expect(existsSync(join(repo, '.collab', '.trash', String(expiredTs)))).toBe(false);

    expect(existsSync(freshDir)).toBe(true);
    expect(existsSync(join(freshDir, 'manifest.json'))).toBe(true);
  });
});
