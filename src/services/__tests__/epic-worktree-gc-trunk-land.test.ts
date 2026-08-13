/**
 * @serial-test-lane: builds real temp git repo + real `git worktree add` checkouts
 *
 * Test for the trunk-land-index backed landedness proof in path 1.5 of gcLeafWorktrees.
 * Verifies that the GC pass correctly distinguishes landed vs. unlanded terminal epics
 * using the canonical trailer-index reader.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-gc-trunk-land-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager } from '../coordinator-live';
import { createTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { gcLeafWorktrees } from '../leaf-worktree-reaper';
import { recordEpicLand } from '../epic-land-record-store';

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

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('gcLeafWorktrees — trunk-land-index backed proof', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gc-trunk-land-repo-'));
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

  it('quarantines only the trunk-confirmed epic worktree and keeps every collab/epic branch', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create three epics: landed, record-but-unlanded, live
    const landed = await createTodo(repo, {
      allowOrphan: true,
      title: 'landed epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'done',
    });
    const landedId8 = landed.id.slice(0, 8);
    const landedDir = join(wm.baseDir(), `__epic-${landedId8}__`);

    const unlanded = await createTodo(repo, {
      allowOrphan: true,
      title: 'record-but-unlanded epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'done',
    });
    const unlandedId8 = unlanded.id.slice(0, 8);
    const unlandedDir = join(wm.baseDir(), `__epic-${unlandedId8}__`);

    const live = await createTodo(repo, {
      allowOrphan: true,
      title: 'live epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'todo',
    });
    const liveId8 = live.id.slice(0, 8);
    const liveDir = join(wm.baseDir(), `__epic-${liveId8}__`);

    // Add worktrees with proper branch names for each epic
    const landedBranch = `collab/epic/${landedId8}`;
    const unlandedBranch = `collab/epic/${unlandedId8}`;
    const liveBranch = `collab/epic/${liveId8}`;

    await runGit(repo, ['worktree', 'add', '-b', landedBranch, landedDir]);
    await runGit(repo, ['worktree', 'add', '-b', unlandedBranch, unlandedDir]);
    await runGit(repo, ['worktree', 'add', '-b', liveBranch, liveDir]);

    // Commit a file in each worktree with proper Collab-Epic trailer
    const worktreePairs = [
      [landedDir, landed] as const,
      [unlandedDir, unlanded] as const,
      [liveDir, live] as const,
    ];
    for (const [dir, todo] of worktreePairs) {
      writeFileSync(join(dir, 'work.txt'), 'work\n');
      await runGit(dir, ['add', 'work.txt']);
      await runGit(dir, ['commit', '-q', '-m', `work\n\nCollab-Epic: ${todo.id}`]);
    }

    // Get the HEAD sha for each worktree
    const landedHeadRes = await runGit(landedDir, ['rev-parse', 'HEAD']);
    const landedTipSha = landedHeadRes.stdout.trim();

    const unlandedHeadRes = await runGit(unlandedDir, ['rev-parse', 'HEAD']);
    const unlandedTipSha = unlandedHeadRes.stdout.trim();

    // Record the land for the landed epic (merge it into master)
    await runGit(repo, ['checkout', '-q', 'master']);
    await runGit(repo, ['merge', '--no-ff', '-q', '-m', `merge ${landedId8}`, landedBranch]);
    recordEpicLand(repo, {
      epicId: landed.id,
      epicTipSha: landedTipSha,
      landedMergeSha: 'deadbeef',
      landedAt: Date.now(),
    });

    // Record the land for the unlanded epic WITHOUT merging to master
    recordEpicLand(repo, {
      epicId: unlanded.id,
      epicTipSha: unlandedTipSha,
      landedMergeSha: 'deadbeef',
      landedAt: Date.now(),
    });

    // Run GC
    const report = await gcLeafWorktrees(repo);

    // Assertions
    // 1. Exactly one removal record (the landed epic)
    expect(report.records.length).toBe(1);

    // 2. The record is for the landed epic
    const record = report.records[0];
    expect(record.path).toBe(landedDir);
    expect(record.reasonClass).toBe('epic-terminal-landed');
    expect(record.epicId8).toBe(landedId8);

    // 3. All three branches still exist
    const landedBranchRes = await runGit(repo, ['rev-parse', '--verify', landedBranch]);
    expect(landedBranchRes.code).toBe(0);

    const unlandedBranchRes = await runGit(repo, ['rev-parse', '--verify', unlandedBranch]);
    expect(unlandedBranchRes.code).toBe(0);

    const liveBranchRes = await runGit(repo, ['rev-parse', '--verify', liveBranch]);
    expect(liveBranchRes.code).toBe(0);

    // 4. The unlanded epic dir still exists (refused)
    expect(existsSync(unlandedDir)).toBe(true);

    // 5. The live epic dir still exists (skipped as in_progress)
    expect(existsSync(liveDir)).toBe(true);

    // 6. The refused list contains entries for the unlanded epic and not the landed one
    const refusedPaths = report.refused.map((r) => r.path);
    expect(refusedPaths).toContain(unlandedDir);
    expect(refusedPaths).not.toContain(landedDir);
  });

  it('after three synthetic land cycles the surviving worktree count equals the live-work count', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    const N = 3;

    for (let i = 0; i < N; i++) {
      // Create one landed and one live epic per cycle
      const landed = await createTodo(repo, {
        allowOrphan: true,
        title: `landed ${i}`,
        ownerSession: 'test',
        kind: 'epic',
        status: 'done',
      });

      const live = await createTodo(repo, {
        allowOrphan: true,
        title: `live ${i}`,
        ownerSession: 'test',
        kind: 'epic',
        status: 'todo',
      });

      const landedId8 = landed.id.slice(0, 8);
      const liveId8 = live.id.slice(0, 8);
      const landedDir = join(wm.baseDir(), `__epic-${landedId8}__`);
      const liveDir = join(wm.baseDir(), `__epic-${liveId8}__`);

      const landedBranch = `collab/epic/${landedId8}`;
      const liveBranch = `collab/epic/${liveId8}`;

      // Add worktrees
      await runGit(repo, ['worktree', 'add', '-b', landedBranch, landedDir]);
      await runGit(repo, ['worktree', 'add', '-b', liveBranch, liveDir]);

      // Commit work with trailers
      const cycleWorktrees = [
        [landedDir, landed] as const,
        [liveDir, live] as const,
      ];
      for (const [dir, todo] of cycleWorktrees) {
        writeFileSync(join(dir, `work${i}.txt`), `cycle ${i}\n`);
        await runGit(dir, ['add', `.`]);
        await runGit(dir, ['commit', '-q', '-m', `cycle ${i}\n\nCollab-Epic: ${todo.id}`]);
      }

      // Get HEAD sha for landed
      const landedHeadRes = await runGit(landedDir, ['rev-parse', 'HEAD']);
      const landedTipSha = landedHeadRes.stdout.trim();

      // Merge and record the landed epic
      await runGit(repo, ['checkout', '-q', 'master']);
      await runGit(repo, ['merge', '--no-ff', '-q', '-m', `merge cycle ${i}`, landedBranch]);
      recordEpicLand(repo, {
        epicId: landed.id,
        epicTipSha: landedTipSha,
        landedMergeSha: 'deadbeef',
        landedAt: Date.now(),
      });

      // Run GC for this cycle
      await gcLeafWorktrees(repo);
    }

    // After N cycles, count surviving worktrees that match __epic-*__
    const entries = readdirSync(wm.baseDir());
    const survivalCount = entries.filter((e) => e.startsWith('__epic-') && e.endsWith('__')).length;

    // Should equal the live-work count (N live epics)
    expect(survivalCount).toBe(N);
  });
});
