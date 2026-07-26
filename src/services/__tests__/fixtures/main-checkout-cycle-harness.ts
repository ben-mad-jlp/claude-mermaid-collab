/**
 * Shared test harness for main-checkout land + forward-integrate cycles.
 * Provides git wrapper, repo initialization, WorktreeManager factory, and git probes.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WorktreeManagerOpts } from '../../../agent/worktree-manager';
import type { MainCheckoutResidueError, MainCheckoutBranchChangedError } from '../../main-checkout-invariant';

type Violation = MainCheckoutResidueError | MainCheckoutBranchChangedError;

export const EXISTING_TEST_FILE = 'src/services/__tests__/sample-existing.test.ts';

export async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
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

export async function initCycleRepo(repo: string, defaultBranch: string): Promise<void> {
  await runGit(repo, ['init', '-q', '-b', defaultBranch]);
  await runGit(repo, ['config', 'user.email', 't@t']);
  await runGit(repo, ['config', 'user.name', 'T']);
  mkdirSync(join(repo, 'src', 'services', '__tests__'), { recursive: true });
  writeFileSync(join(repo, EXISTING_TEST_FILE), 'export const test = () => true;\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', 'base']);
}

export async function makeManager(
  repo: string,
  persistDir: string,
  opts?: { spawn?: (cmd: string[], opts: any) => any },
): Promise<{ mgr: any; violations: Violation[] }> {
  const violations: Violation[] = [];

  const { WorktreeManager } = await import('../../../agent/worktree-manager');

  const managerOpts: WorktreeManagerOpts = {
    projectRoot: repo,
    baseDir: join(persistDir, 'worktrees'),
    persistDir,
    onMainCheckoutViolation: (err: Violation) => {
      violations.push(err);
    },
  };

  if (opts?.spawn) {
    managerOpts.spawn = opts.spawn;
  }

  return { mgr: new WorktreeManager(managerOpts), violations };
}

export async function buildEpicTouchingExistingTestFile(
  mgr: any,
  epicId: string,
  baseRef: string,
): Promise<{ editedContent: string }> {
  const epic = await mgr.ensureEpic(epicId, undefined, baseRef);
  if (!epic) throw new Error('ensureEpic returned null');

  const testFilePath = join(epic.path, EXISTING_TEST_FILE);
  const editedContent = 'export const test = () => true; // modified\n';
  writeFileSync(testFilePath, editedContent);
  await runGit(epic.path, ['add', '-A']);
  await runGit(epic.path, ['commit', '-q', '-m', 'epic: edit existing test file']);

  return { editedContent };
}

export interface MainCheckoutProbes {
  branch: string;
  sha: string;
  porcelain: string;
  stagedNameStatus: string;
  unstagedNameStatus: string;
}

export async function probeMainCheckout(repo: string): Promise<MainCheckoutProbes> {
  const [branch, sha, porcelain, stagedNameStatus, unstagedNameStatus] = await Promise.all([
    runGit(repo, ['symbolic-ref', '--short', 'HEAD']),
    runGit(repo, ['rev-parse', 'HEAD']),
    runGit(repo, ['status', '--porcelain', '--untracked-files=no']),
    runGit(repo, ['diff', '--cached', '--name-status']),
    runGit(repo, ['diff', '--name-status']),
  ]);

  return {
    branch: branch.stdout.trim(),
    sha: sha.stdout.trim(),
    porcelain: porcelain.stdout,
    stagedNameStatus: stagedNameStatus.stdout,
    unstagedNameStatus: unstagedNameStatus.stdout,
  };
}
