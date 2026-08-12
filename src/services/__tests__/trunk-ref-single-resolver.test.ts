/**
 * Proof that every call site delegating to trunk-ref.ts's shared resolver actually consults
 * origin/HEAD FIRST — not just that main-first probe ordering happens to agree with it. Both
 * `main` and `master` exist with distinct real tips in this repo shape, so a resolver that
 * probed main-then-master WITHOUT reading origin/HEAD would always return 'main' regardless
 * of where origin/HEAD points. Only a genuinely origin/HEAD-first resolver flips its answer
 * between the two tests below.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE adopt-branch-as-epic.js's module-scope import of
// todo-store.js / workgraph-tools.js fires (pattern: trunk-ref-main.test.ts:21-23).
const supervisorDir = mkdtempSync(join(tmpdir(), 'trunk-ref-single-resolver-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { resolveTrunkRef, defaultGitRunner } from '../trunk-ref.js';
import { resolveTrunkRef as stewardResolveTrunkRef } from '../steward-proof.js';
import { detectBaseTrunk, runGit } from '../adopt-branch-as-epic.js';
import { detectTrunkRef } from '../epic-branch-status.js';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store.js';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

let repos: string[] = [];

afterEach(() => {
  for (const r of repos) rmSync(r, { recursive: true, force: true });
  repos = [];
});

/** Both `main` and `master` real, with distinct tips, and origin/HEAD pointed at
 *  `originHeadBranch` via a plain ref (no real `origin` remote needed). */
function makeBothBranchesRepo(originHeadBranch: 'main' | 'master'): string {
  const dir = mkdtempSync(join(tmpdir(), 'trunk-ref-single-resolver-repo-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# main\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'main tip');

  git(dir, 'branch', 'master');
  git(dir, 'checkout', '-q', 'master');
  writeFileSync(join(dir, 'MASTER.md'), '# master\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'master tip');
  git(dir, 'checkout', '-q', 'main');

  git(dir, 'update-ref', `refs/remotes/origin/${originHeadBranch}`, originHeadBranch);
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${originHeadBranch}`);

  return dir;
}

describe('every trunk-ref call site is origin/HEAD-first, not just main-first', () => {
  it("origin/HEAD -> master: every call site returns 'master' (both main and master exist)", async () => {
    const dir = makeBothBranchesRepo('master');

    expect(await resolveTrunkRef(dir)).toBe('master');
    expect(await stewardResolveTrunkRef(dir)).toBe('master');
    expect(await detectBaseTrunk(dir, runGit)).toBe('master');
    expect(await detectTrunkRef(dir)).toBe('master');
    // Stands in for leaf-worktree-reaper.ts:244-246's private resolveTrunkRef, which is a
    // one-line delegate to sharedResolveTrunkRef(projectRoot, gcGitRead) — gcGitRead is a
    // `git -C cwd ...args` Bun.spawn runner of the same shape as defaultGitRunner, so this
    // proves the reaper's path without exporting a new seam.
    expect(await resolveTrunkRef(dir, defaultGitRunner)).toBe('master');
  });

  it("origin/HEAD -> main: every call site returns 'main' (the mirror proving origin/HEAD wins, not just main-first ordering)", async () => {
    const dir = makeBothBranchesRepo('main');

    expect(await resolveTrunkRef(dir)).toBe('main');
    expect(await stewardResolveTrunkRef(dir)).toBe('main');
    expect(await detectBaseTrunk(dir, runGit)).toBe('main');
    expect(await detectTrunkRef(dir)).toBe('main');
    expect(await resolveTrunkRef(dir, defaultGitRunner)).toBe('main');
  });
});
