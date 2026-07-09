import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageUntrackedIntentToAdd } from '../stage-untracked';

let repo: string;
let base: string;

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'stu-repo-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, '.gitignore'), 'junk.log\nsnapshots/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  base = git(repo, 'rev-parse', 'HEAD').trim();
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('stage-untracked', () => {
  it('stages a new non-ignored file; ignored file stays invisible', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const x = 1;\n');
    writeFileSync(join(repo, 'junk.log'), 'noise\n');

    const staged = stageUntrackedIntentToAdd(repo);

    expect(staged).toContain('src/new.ts');
    expect(staged).not.toContain('junk.log');
    expect(git(repo, 'diff', '--stat')).toContain('src/new.ts');
    const twoDot = git(repo, 'diff', '--stat', base);
    expect(twoDot).toContain('src/new.ts');
    expect(twoDot).not.toContain('junk.log');
  });

  it('git add -A is not used: ignored junk stays untracked', () => {
    writeFileSync(join(repo, 'junk.log'), 'noise\n');
    mkdirSync(join(repo, 'snapshots'), { recursive: true });
    writeFileSync(join(repo, 'snapshots', 'db.sqlite'), 'binary-ish\n');

    stageUntrackedIntentToAdd(repo);

    const ignored = git(repo, 'status', '--porcelain', '--ignored');
    expect(ignored).toContain('!! junk.log');
    expect(ignored).toContain('!! snapshots/');
    const cached = git(repo, 'diff', '--cached', '--name-only');
    expect(cached).not.toContain('junk.log');
    expect(cached).not.toContain('snapshots/db.sqlite');
    expect(git(repo, 'ls-files', '--', 'junk.log').trim()).toBe('');
  });

  it('content is NOT staged (intent-to-add semantics)', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'new.ts'), 'line1\nline2\nline3\n');

    stageUntrackedIntentToAdd(repo);

    // An intent-to-add entry is a ZERO-CONTENT index entry, so index-vs-HEAD sees no content
    // at all and prints nothing — the empty output IS the proof the content was not staged.
    const cachedStat = git(repo, 'diff', '--cached', '--numstat');
    expect(cachedStat.trim()).toBe('');
    // ...while the content itself is still in the worktree, unstaged.
    const unstagedStat = git(repo, 'diff', '--numstat');
    expect(unstagedStat.trim()).toBe('3\t0\tsrc/new.ts');
  });

  it('git diff HEAD lists the new file only after the sweep (the review node\'s view)', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const x = 1;\n');

    // Untracked: `git status` shows it as `??`, but `git diff HEAD` omits it entirely.
    expect(git(repo, 'status', '--porcelain')).toContain('?? src/new.ts');
    expect(git(repo, 'diff', 'HEAD', '--name-only')).not.toContain('src/new.ts');

    stageUntrackedIntentToAdd(repo);

    expect(git(repo, 'diff', 'HEAD', '--name-only')).toContain('src/new.ts');
    expect(git(repo, 'diff', 'HEAD', '--numstat').trim()).toBe('1\t0\tsrc/new.ts');
  });

  it('is idempotent across laps', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const x = 1;\n');

    const first = stageUntrackedIntentToAdd(repo);
    expect(first).toContain('src/new.ts');

    const second = stageUntrackedIntentToAdd(repo);
    expect(second).toEqual([]);
  });

  it('stages a file created on a later lap too', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const x = 1;\n');
    stageUntrackedIntentToAdd(repo);

    writeFileSync(join(repo, 'src', 'later.ts'), 'export const y = 2;\n');
    const second = stageUntrackedIntentToAdd(repo);

    expect(second).toContain('src/later.ts');
  });

  it('never throws / degrades to [] on a non-git dir', () => {
    const plain = mkdtempSync(join(tmpdir(), 'stu-plain-'));
    expect(() => stageUntrackedIntentToAdd(plain)).not.toThrow();
    expect(stageUntrackedIntentToAdd(plain)).toEqual([]);
    rmSync(plain, { recursive: true, force: true });
  });
});
