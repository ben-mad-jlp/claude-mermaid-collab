import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseDeclaredScope,
  computeCommitScope,
  stageAndCommitScoped,
  listUntrackedPaths,
} from '../leaf-commit-scope';

// Helper: create a temporary git repo for testing
function createTestRepo(name: string): string {
  const tmpDir = join(process.cwd(), `.test-repos-${process.pid}`);
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const repo = join(tmpDir, name);
  if (existsSync(repo)) rmSync(repo, { recursive: true });
  mkdirSync(repo, { recursive: true });

  execFileSync('git', ['init'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });

  return repo;
}

function cleanTestRepos() {
  const tmpDir = join(process.cwd(), `.test-repos-${process.pid}`);
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function createJunkFiles(repo: string) {
  // Seed 110 junk files like the bug report
  const junkFiles: string[] = [];
  for (let i = 0; i < 50; i++) {
    const dir = join(repo, '.bsync', 'components');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `c${i}.bcomp.json`);
    writeFileSync(file, '{}');
    junkFiles.push(`.bsync/components/c${i}.bcomp.json`);
  }
  for (let i = 0; i < 40; i++) {
    const dir = join(repo, '.bsync', 'experiments', `e${i}`, 'trials.jsonl');
    mkdirSync(join(repo, '.bsync', 'experiments', `e${i}`), { recursive: true });
    writeFileSync(dir, '');
    junkFiles.push(`.bsync/experiments/e${i}/trials.jsonl`);
  }
  for (let i = 0; i < 20; i++) {
    const file = join(repo, `out${i}.step`);
    writeFileSync(file, '');
    junkFiles.push(`out${i}.step`);
  }
  return junkFiles;
}

describe('leaf-commit-scope', () => {
  let repo: string;

  beforeEach(() => {
    repo = createTestRepo('scope-test');
  });

  afterEach(() => {
    cleanTestRepos();
  });

  it('THE REPORTED BUG: git add -A pollution with junk files', async () => {
    // Seed 110 untracked junk files BEFORE the snapshot
    const junkFiles = createJunkFiles(repo);
    const untrackedAtStart = listUntrackedPaths(repo);
    expect(untrackedAtStart).toHaveLength(110);

    // Create a tracked file and modify it
    const srcDir = join(repo, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): pass');
    git(repo, 'add', 'src/sim.py');
    git(repo, 'commit', '-m', 'init');

    // Modify sim.py
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): return 42');

    // Compute scope with empty declared scope
    const decision = computeCommitScope(repo, {
      declaredFiles: ['src/sim.py'],
      untrackedAtStart,
    });

    // Stage and commit with scoped commit
    const run = (args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        try {
          const stdout = git(repo, ...args);
          resolve({ code: 0, stdout, stderr: '' });
        } catch (e) {
          resolve({
            code: (e as any).status || 1,
            stdout: '',
            stderr: (e as any).stderr?.toString() || String(e),
          });
        }
      });

    // Stage and commit
    await stageAndCommitScoped(run, {
      stage: decision.stage,
      outOfScope: decision.outOfScope,
      message: 'feat: simulate',
    });

    // Verify: only src/sim.py is in the commit, NOT the 110 junk files
    const showOutput = git(repo, 'show', '--name-only', 'HEAD');
    const lines = showOutput.split('\n');
    // Find first blank line (separates commit header+message from filenames)
    let blankIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '' && i > 0) {
        blankIdx = i;
        break;
      }
    }
    // Files are after the blank line(s); they don't start with whitespace
    const committedFiles = lines.slice(blankIdx + 1).filter((l) => l.trim() && !l.startsWith(' '));
    expect(committedFiles).toEqual(['src/sim.py']);

    // Verify 110 files are out-of-scope
    expect(decision.outOfScope).toHaveLength(110);
  });

  it('Created file ships alongside declared scope', async () => {
    // Set up: tracked file
    const srcDir = join(repo, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): pass');
    git(repo, 'add', 'src/sim.py');
    git(repo, 'commit', '-m', 'init');

    const untrackedAtStart = listUntrackedPaths(repo);

    // Modify tracked file + create new test file
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): return 42');
    const testDir = join(repo, 'tests');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'test_sim.py'), 'assert foo() == 42');

    const decision = computeCommitScope(repo, {
      declaredFiles: ['src/sim.py'],
      untrackedAtStart,
    });

    expect(decision.stage).toContain('src/sim.py');
    expect(decision.stage).toContain('tests/test_sim.py'); // created file ships
    expect(decision.incident).toBe(false);
  });

  it('Pre-existing untracked junk excluded with empty declared scope', async () => {
    const junkFiles = createJunkFiles(repo);
    const untrackedAtStart = listUntrackedPaths(repo);

    // Create tracked file
    const srcDir = join(repo, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): pass');
    git(repo, 'add', 'src/sim.py');
    git(repo, 'commit', '-m', 'init');

    // Modify tracked file
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): return 42');

    const decision = computeCommitScope(repo, {
      declaredFiles: [], // empty declaration
      untrackedAtStart,
    });

    expect(decision.stage).toContain('src/sim.py');
    expect(decision.outOfScope).toEqual([]);
    // Junk is never in stage (not in createdNow since it existed at start)
  });

  it('Incident when all dirty paths outside declared scope', async () => {
    const srcDir = join(repo, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): pass');
    writeFileSync(join(repo, 'other.ts'), 'export function bar() {}');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'init');

    const untrackedAtStart = listUntrackedPaths(repo);

    // Only modify other.ts, not sim.py (which is in declared scope)
    writeFileSync(join(repo, 'other.ts'), 'export function bar() { return 123; }');

    const decision = computeCommitScope(repo, {
      declaredFiles: ['src/sim.py'],
      untrackedAtStart,
    });

    expect(decision.incident).toBe(true);
    expect(decision.stage).toEqual([]);
  });

  it('Trailer on commit message', async () => {
    const srcDir = join(repo, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): pass');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'init');

    const untrackedAtStart = listUntrackedPaths(repo);
    writeFileSync(join(srcDir, 'sim.py'), 'def foo(): return 42');

    const decision = computeCommitScope(repo, {
      declaredFiles: [],
      untrackedAtStart,
    });

    const run = (args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        try {
          const stdout = git(repo, ...args);
          resolve({ code: 0, stdout, stderr: '' });
        } catch (e) {
          resolve({
            code: (e as any).status || 1,
            stdout: '',
            stderr: (e as any).stderr?.toString() || String(e),
          });
        }
      });

    await stageAndCommitScoped(run, {
      stage: decision.stage,
      outOfScope: decision.outOfScope,
      message: 'feat: update sim',
      trailer: 'Collab-Todo: abc123',
    });

    const logOutput = git(repo, 'log', '-1', '--format=%B');
    expect(logOutput).toContain('Collab-Todo: abc123');
  });

  it('parseDeclaredScope extracts "Implement ONLY this file: X"', () => {
    const desc1 = `Some preamble\nImplement ONLY this file: src/sim.py\nSome trailing text`;
    const result1 = parseDeclaredScope(desc1);
    expect(result1).toEqual(['src/sim.py']);

    const desc2 = `No declaration here`;
    const result2 = parseDeclaredScope(desc2);
    expect(result2).toEqual([]);

    const desc3 = null;
    const result3 = parseDeclaredScope(desc3);
    expect(result3).toEqual([]);
  });

  it('Ignored files never staged even when created during run', async () => {
    writeFileSync(join(repo, '.gitignore'), '*.tmp\n*.log');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-m', 'init');

    const untrackedAtStart = listUntrackedPaths(repo);
    expect(untrackedAtStart).toEqual([]);

    // Create ignored files during run
    writeFileSync(join(repo, 'test.tmp'), 'ignored');
    writeFileSync(join(repo, 'debug.log'), 'ignored');

    const decision = computeCommitScope(repo, {
      declaredFiles: [],
      untrackedAtStart,
    });

    // Ignored files should NOT be in stage (listUntrackedPaths respects .gitignore)
    expect(decision.stage).not.toContain('test.tmp');
    expect(decision.stage).not.toContain('debug.log');
  });

  it('Boundaries emit separate commits per boundary', async () => {
    // Create two files in different boundaries
    const bsyncViewerDir = join(repo, 'bsync-viewer');
    const bsyncToolsDir = join(repo, 'bsync-tools');
    mkdirSync(bsyncViewerDir, { recursive: true });
    mkdirSync(bsyncToolsDir, { recursive: true });

    writeFileSync(join(bsyncViewerDir, 'main.ts'), 'export function view() {}');
    writeFileSync(join(bsyncToolsDir, 'tool.ts'), 'export function tool() {}');

    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'init');

    const untrackedAtStart = listUntrackedPaths(repo);

    // Modify both files
    writeFileSync(join(bsyncViewerDir, 'main.ts'), 'export function view() { return 1; }');
    writeFileSync(join(bsyncToolsDir, 'tool.ts'), 'export function tool() { return 2; }');

    const decision = computeCommitScope(repo, {
      declaredFiles: [],
      untrackedAtStart,
    });

    const run = (args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        try {
          const stdout = git(repo, ...args);
          resolve({ code: 0, stdout, stderr: '' });
        } catch (e) {
          resolve({
            code: (e as any).status || 1,
            stdout: '',
            stderr: (e as any).stderr?.toString() || String(e),
          });
        }
      });

    const res = await stageAndCommitScoped(run, {
      stage: decision.stage,
      outOfScope: decision.outOfScope,
      message: 'feat: update',
      boundaries: ['bsync-viewer/', 'bsync-tools/'],
    });

    // Should have 2 commits, one per boundary
    expect(res.commits.length).toBe(2);

    // Verify commit count in log
    const log = git(repo, 'log', '--oneline', '--all');
    const commitLines = log.split('\n').filter(Boolean);
    expect(commitLines.length).toBeGreaterThanOrEqual(2);
  });

  // Acceptance: grep for actual git add -A command invocations in src/ (excluding test fixtures)
  // Legitimate prose mentions of "never use git add -A" are excluded by the pattern.
  // leaf-commit-scope.ts itself is excluded: its `add -A -- <chunk>` call is intentionally
  // pathspec-scoped (staging deletions for an enumerated path list), never a bare repo-root
  // `git add -A` — that's the exact bug this test otherwise guards against.
  it('no `git add -A` / `git add .` anywhere in src/ outside test fixtures', () => {
    // Match actual git command invocations: ['add', '-A'] or ['add', '-u'] or git add . / git add -A
    // Pattern: matches run-time array/command forms, excludes prose comments about "never" using them
    const hits = execFileSync(
      'bash',
      [
        '-c',
        `git grep -nE "\\[.add.\\s*(,\\s*)?['\\\"]?-[Au]|exec.*git.*add\\s+(-A|-u|\\\\.)\\b|git\\s+add\\s+(-A|-u|\\\\.)\\b" -- 'src/**' ':!src/**/__tests__/**' ':!src/**/*.test.ts' ':!src/**/*.test.js' ':!src/services/leaf-commit-scope.ts' || true`,
      ],
      { encoding: 'utf8', cwd: process.cwd() }
    );
    expect(hits.trim()).toBe('');
  });

  it('delete-only change-set stages and commits the deletion', async () => {
    const srcDir = join(repo, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'old.ts'), 'export const old = 1;');
    git(repo, 'add', 'src/old.ts');
    git(repo, 'commit', '-m', 'init');

    const untrackedAtStart = listUntrackedPaths(repo);

    // Delete via filesystem unlink (mirrors what an implement/fix node does), not `git rm`.
    rmSync(join(srcDir, 'old.ts'));

    const decision = computeCommitScope(repo, {
      declaredFiles: ['src/old.ts'],
      untrackedAtStart,
    });
    expect(decision.stage).toContain('src/old.ts');

    const run = (args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        try {
          const stdout = git(repo, ...args);
          resolve({ code: 0, stdout, stderr: '' });
        } catch (e) {
          resolve({
            code: (e as any).status || 1,
            stdout: '',
            stderr: (e as any).stderr?.toString() || String(e),
          });
        }
      });

    await stageAndCommitScoped(run, {
      stage: decision.stage,
      outOfScope: decision.outOfScope,
      message: 'delete old.ts',
    });

    expect(existsSync(join(srcDir, 'old.ts'))).toBe(false);
    const tracked = git(repo, 'ls-files', 'src/old.ts');
    expect(tracked.trim()).toBe('');
  });

  it('mixed edit + delete change-set stages both correctly', async () => {
    const srcDir = join(repo, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'keep.ts'), 'export const keep = 1;');
    writeFileSync(join(srcDir, 'gone.ts'), 'export const gone = 1;');
    git(repo, 'add', 'src/keep.ts', 'src/gone.ts');
    git(repo, 'commit', '-m', 'init');

    const untrackedAtStart = listUntrackedPaths(repo);

    writeFileSync(join(srcDir, 'keep.ts'), 'export const keep = 2;');
    rmSync(join(srcDir, 'gone.ts'));

    const decision = computeCommitScope(repo, {
      declaredFiles: ['src/keep.ts', 'src/gone.ts'],
      untrackedAtStart,
    });
    expect(decision.stage).toContain('src/keep.ts');
    expect(decision.stage).toContain('src/gone.ts');

    const run = (args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        try {
          const stdout = git(repo, ...args);
          resolve({ code: 0, stdout, stderr: '' });
        } catch (e) {
          resolve({
            code: (e as any).status || 1,
            stdout: '',
            stderr: (e as any).stderr?.toString() || String(e),
          });
        }
      });

    await stageAndCommitScoped(run, {
      stage: decision.stage,
      outOfScope: decision.outOfScope,
      message: 'edit+delete',
    });

    const keepContent = git(repo, 'show', 'HEAD:src/keep.ts');
    expect(keepContent.trim()).toBe('export const keep = 2;');
    const tracked = git(repo, 'ls-files', 'src/gone.ts');
    expect(tracked.trim()).toBe('');
  });
});
