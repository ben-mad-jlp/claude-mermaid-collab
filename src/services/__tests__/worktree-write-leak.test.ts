import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mainCheckoutRoot, snapshotMainCheckout, sweepLeakedWrites } from '../worktree-write-leak';

let repo: string;
let worktree: string;

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'wwl-repo-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  mkdirSync(join(repo, 'desktop'), { recursive: true });
  writeFileSync(join(repo, 'desktop', 'existing.js'), 'orig\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  worktree = join(repo, '.collab', 'wt');
  git(repo, 'worktree', 'add', '-q', '--detach', worktree, 'HEAD');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('worktree-write-leak', () => {
  it('resolves the main checkout root from a worktree via git-common-dir', () => {
    // realpath the temp dir (macOS /var → /private/var) by comparing resolved git output.
    const root = mainCheckoutRoot(worktree);
    expect(root).not.toBeNull();
    expect(git(root!, 'rev-parse', '--show-toplevel').trim()).toBe(git(repo, 'rev-parse', '--show-toplevel').trim());
  });

  it('relocates an UNTRACKED file leaked into the main root into the worktree', () => {
    const snap = snapshotMainCheckout(worktree);
    // Simulate the leak: a NEW file written to the MAIN root instead of the worktree.
    writeFileSync(join(repo, 'desktop', 'leaked.js'), 'leaked-content\n');

    const swept = sweepLeakedWrites(worktree, snap);

    expect(swept).toContain('desktop/leaked.js');
    expect(existsSync(join(repo, 'desktop', 'leaked.js'))).toBe(false); // removed from main root
    expect(existsSync(join(worktree, 'desktop', 'leaked.js'))).toBe(true); // moved into worktree
    expect(readFileSync(join(worktree, 'desktop', 'leaked.js'), 'utf8')).toBe('leaked-content\n');
  });

  it('relocates a MODIFIED tracked file and restores the main root to HEAD', () => {
    const snap = snapshotMainCheckout(worktree);
    writeFileSync(join(repo, 'desktop', 'existing.js'), 'leaked-edit\n'); // leaked edit in main root

    const swept = sweepLeakedWrites(worktree, snap);

    expect(swept).toContain('desktop/existing.js');
    expect(readFileSync(join(worktree, 'desktop', 'existing.js'), 'utf8')).toBe('leaked-edit\n'); // edit moved to worktree
    expect(readFileSync(join(repo, 'desktop', 'existing.js'), 'utf8')).toBe('orig\n'); // main root restored
  });

  it('does NOT touch files that were already dirty before the snapshot', () => {
    // Pre-existing stray file in the root (e.g. a leftover from a prior run).
    writeFileSync(join(repo, 'preexisting.txt'), 'old\n');
    const snap = snapshotMainCheckout(worktree);
    // No new leak this run.
    const swept = sweepLeakedWrites(worktree, snap);
    expect(swept).toHaveLength(0);
    expect(existsSync(join(repo, 'preexisting.txt'))).toBe(true); // untouched
  });

  it('is a no-op when the cwd is not a worktree (no detectable root)', () => {
    const plain = mkdtempSync(join(tmpdir(), 'wwl-plain-'));
    const snap = snapshotMainCheckout(plain);
    expect(sweepLeakedWrites(plain, snap)).toHaveLength(0);
    rmSync(plain, { recursive: true, force: true });
  });
});
