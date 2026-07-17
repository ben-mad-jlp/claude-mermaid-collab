import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mainCheckoutRoot, snapshotMainCheckout, sweepLeakedWrites, reclaimPreDirtyScopeOverlap } from '../worktree-write-leak';

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

describe('reclaimPreDirtyScopeOverlap (friction 552f95c2 — grandfathered leak debris)', () => {
  it('quarantines + restores pre-dirty tracked files INSIDE the declared scope; snapshot entry removed', () => {
    // Simulate a prior killed run's leak: main-checkout tracked file dirty BEFORE this run.
    writeFileSync(join(repo, 'desktop', 'existing.js'), 'LEAKED prior-attempt content\n');
    const snap = snapshotMainCheckout(worktree);
    expect(snap.before.get('desktop/existing.js')).toBeDefined();

    const quarantine = join(repo, '.collab', 'leak-quarantine', 'test-a1');
    const reclaimed = reclaimPreDirtyScopeOverlap(worktree, snap, ['desktop/existing.js'], quarantine);
    expect(reclaimed).toEqual(['desktop/existing.js']);
    // main checkout restored to HEAD
    expect(readFileSync(join(repo, 'desktop', 'existing.js'), 'utf8')).toBe('orig\n');
    // dirty content preserved in quarantine — nothing destroyed
    expect(readFileSync(join(quarantine, 'desktop', 'existing.js'), 'utf8')).toBe('LEAKED prior-attempt content\n');
    // snapshot entry cleared so THIS run's own later changes to the path are sweepable
    expect(snap.before.has('desktop/existing.js')).toBe(false);
  });

  it('leaves out-of-scope dirt and untracked pre-existing files alone', () => {
    writeFileSync(join(repo, 'desktop', 'existing.js'), 'human edit maybe\n');
    writeFileSync(join(repo, 'stray.txt'), 'untracked junk\n');
    const snap = snapshotMainCheckout(worktree);
    const quarantine = join(repo, '.collab', 'leak-quarantine', 'test-a2');
    // declared scope does NOT include the dirty file
    const reclaimed = reclaimPreDirtyScopeOverlap(worktree, snap, ['src/other.ts'], quarantine);
    expect(reclaimed).toEqual([]);
    expect(readFileSync(join(repo, 'desktop', 'existing.js'), 'utf8')).toBe('human edit maybe\n');
    expect(existsSync(join(repo, 'stray.txt'))).toBe(true);
    // untracked path in scope is also left alone (not this class)
    const snap2 = snapshotMainCheckout(worktree);
    const r2 = reclaimPreDirtyScopeOverlap(worktree, snap2, ['stray.txt'], quarantine);
    expect(r2).toEqual([]);
    expect(existsSync(join(repo, 'stray.txt'))).toBe(true);
  });

  it('empty declared scope or non-worktree cwd → no-op', () => {
    writeFileSync(join(repo, 'desktop', 'existing.js'), 'dirty\n');
    const snap = snapshotMainCheckout(worktree);
    expect(reclaimPreDirtyScopeOverlap(worktree, snap, [], join(repo, 'q'))).toEqual([]);
    const plain = mkdtempSync(join(tmpdir(), 'wwl-plain2-'));
    try {
      const psnap = snapshotMainCheckout(plain);
      expect(reclaimPreDirtyScopeOverlap(plain, psnap, ['a.ts'], join(plain, 'q'))).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('sweepLeakedWrites still catches the SAME path when it changes again after reclaim (de-grandfathered)', () => {
    writeFileSync(join(repo, 'desktop', 'existing.js'), 'old leak\n');
    const snap = snapshotMainCheckout(worktree);
    reclaimPreDirtyScopeOverlap(worktree, snap, ['desktop/existing.js'], join(repo, '.collab', 'leak-quarantine', 'test-a3'));
    // this run leaks to the same path again
    writeFileSync(join(repo, 'desktop', 'existing.js'), 'new leak this run\n');
    const swept = sweepLeakedWrites(worktree, snap);
    expect(swept).toContain('desktop/existing.js');
    expect(readFileSync(join(repo, 'desktop', 'existing.js'), 'utf8')).toBe('orig\n'); // root restored
    expect(readFileSync(join(worktree, 'desktop', 'existing.js'), 'utf8')).toBe('new leak this run\n'); // relocated to lane
  });
});
