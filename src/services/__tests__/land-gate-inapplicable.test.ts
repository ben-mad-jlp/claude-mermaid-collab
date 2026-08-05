/**
 * Regression: a land gate that CANNOT RUN must report INAPPLICABLE, never FAILURE.
 *
 * Incident 2026-08-04, mission db089158 (repo qbs). Two independent probes each turned an
 * environment fact into a false code verdict, and together they blocked every land:
 *
 *   1. compile gate — qbs has `qbs.sln` at its root, so detectCompileCheck selects
 *      `dotnet build`. `dotnet` is NOT installed on the host. execFile returned ENOENT,
 *      which the numeric coercion in execAsync flattened to exit code 1, so "no compiler"
 *      was indistinguishable from "the build is red". Blocker: `tsc-failed` — on an epic
 *      whose entire diff is nine .js and .sh files, containing zero C# and zero TypeScript.
 *
 *   2. merge trial — `git worktree add --detach <trial> master` on a repo whose trunk is
 *      `main` and which has no `master` ref at all. worktree-add failed, the trial returned
 *      { clean: false }, and the verdict read `merge-conflict`. `git merge-tree main <epic>`
 *      was CLEAN for every epic the entire time.
 *
 * Cost: seven epic branches stranded, $47.53, zero commits landed, conductor idle.
 *
 * EVERY assertion below calls the PRODUCTION functions (execAsync / resolveTrunkRef /
 * realRunners.tscClean). A test that re-implements the probe inline would pass against the
 * un-fixed code and guard nothing — that was the first draft of this file, and it did.
 */
import { describe, it, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectCompileCheck } from '../compile-gate';
import { execAsync, resolveTrunkRef, realRunners, _resetTscCleanCache } from '../steward-proof';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

/** Is dotnet on this host? Deliberately NOT asked via execAsync.notFound — that is the
 *  field under test, and a guard built on it disarms itself the moment the fix regresses
 *  (a `notFound = false` regression made every abstain test silently "skip" and pass). */
function dotnetInstalled(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return (e as { code?: unknown }).code !== 'ENOENT';
  }
}

/** A committed repo on `branch`. Identity is set per-repo: the host may have no global
 *  user.email, and an unattributable commit would fail the test for the wrong reason. */
function makeRepo(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'land-gate-test-'));
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

describe('execAsync: a missing binary is distinguishable from a non-zero exit', () => {
  it('flags ENOENT as notFound', async () => {
    const r = await execAsync('definitely-not-a-real-binary-xyz', ['--version']);
    expect(r.notFound).toBe(true); // ← pre-fix this was code 1, identical to a red build
  });

  it('does NOT flag a real tool that ran and failed', async () => {
    const r = await execAsync('git', ['rev-parse', '--verify', 'no-such-ref-here']);
    expect(r.code).not.toBe(0);
    expect(r.notFound).toBe(false); // a genuine failure must still fail the gate
  });

  it('does NOT flag a real tool that succeeded', async () => {
    const r = await execAsync('git', ['--version']);
    expect(r.code).toBe(0);
    expect(r.notFound).toBe(false);
  });
});

describe('compile gate: a missing compiler ABSTAINS instead of failing the land', () => {
  it('detectCompileCheck selects dotnet when a .sln is present — the trigger condition', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sln-test-'));
    try {
      writeFileSync(join(dir, 'qbs.sln'), '');
      const check = detectCompileCheck(dir);
      expect(check).not.toBeNull();
      expect(check!.cmd).toContain('dotnet');
      expect(check!.label).toBe('C#/.NET');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a language with no static compile step still abstains (pre-existing behaviour)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nolang-test-'));
    try {
      writeFileSync(join(dir, 'main.py'), 'print(1)\n');
      expect(detectCompileCheck(dir)).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('realRunners.tscClean PASSES on a .sln repo when dotnet is not installed', async () => {
    if (dotnetInstalled()) {
      // dotnet IS installed here, so this host cannot reproduce the incident condition.
      // Skipping loudly beats a green tick that checked nothing.
      console.warn('[land-gate-inapplicable] SKIPPED: dotnet is installed on this host');
      return;
    }
    const dir = makeRepo('main');
    try {
      writeFileSync(join(dir, 'qbs.sln'), '');       // → detectCompileCheck picks dotnet build
      writeFileSync(join(dir, 'health.js'), '1\n');  // the epic's actual content: no C#, no TS
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'js only');
      _resetTscCleanCache();
      // Pre-fix this returned false → blocker `tsc-failed` on a diff with nothing to compile.
      expect(await realRunners.tscClean(dir)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the abstain is NOT cached — installing a toolchain takes effect immediately', async () => {
    if (dotnetInstalled()) {
      console.warn('[land-gate-inapplicable] SKIPPED: dotnet is installed on this host');
      return;
    }
    const dir = makeRepo('main');
    try {
      writeFileSync(join(dir, 'qbs.sln'), '');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'sln');
      _resetTscCleanCache();
      expect(await realRunners.tscClean(dir)).toBe(true);
      // A cached abstain would outlive `apt install dotnet` by the full 10-minute TTL. The
      // second call must recompute, which it can only do if nothing was stored.
      expect(await realRunners.tscClean(dir)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('resolveTrunkRef: the trunk is resolved, never assumed to be master', () => {
  it('resolves main on a repo with NO master ref — the incident shape', async () => {
    const dir = makeRepo('main');
    try {
      expect(() => git(dir, 'rev-parse', '--verify', 'master')).toThrow();
      expect(await resolveTrunkRef(dir)).toBe('main');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still resolves master on a master-trunk repo (no behaviour change)', async () => {
    const dir = makeRepo('master');
    try {
      expect(await resolveTrunkRef(dir)).toBe('master');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('origin/HEAD wins over the probe order when a repo carries BOTH main and master', async () => {
    const dir = makeRepo('main');
    try {
      git(dir, 'branch', 'master'); // legacy ref present but NOT the trunk
      git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
      expect(await resolveTrunkRef(dir)).toBe('main');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the resolved ref is one worktree-add actually accepts', async () => {
    const dir = makeRepo('main');
    try {
      // THE BUG: the trial pinned its worktree at the literal ref 'master'.
      expect(() => git(dir, 'worktree', 'add', '--detach', join(dir, '.t-master'), 'master')).toThrow();
      // THE FIX: resolved trunk → worktree-add succeeds, so the trial reaches a real merge.
      const trunk = await resolveTrunkRef(dir);
      const trial = join(dir, '.t-trunk');
      git(dir, 'worktree', 'add', '--detach', trial, trunk);
      git(dir, 'worktree', 'remove', '--force', trial);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
