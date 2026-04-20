import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createGitOps } from '../git-ops.js';

const ops = createGitOps();

async function run(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn({ cmd: ['git', ...args], cwd, stdout: 'pipe', stderr: 'pipe' });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }
}

async function initRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmc-git-ops-'));
  await run(dir, ['init', '-q', '-b', 'main']);
  await run(dir, ['config', 'user.email', 'test@example.com']);
  await run(dir, ['config', 'user.name', 'Test']);
  await run(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

describe('git-ops', () => {
  let repoRootIsGit = false;
  let repoDir: string | null = null;

  beforeEach(async () => {
    repoRootIsGit = await ops.isGitRepo(process.cwd());
    repoDir = null;
  });

  afterEach(() => {
    if (repoDir && fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('isGitRepo returns true for a git repo and false for non-repo', async () => {
    if (!repoRootIsGit) return;
    repoDir = await initRepo();
    expect(await ops.isGitRepo(repoDir)).toBe(true);

    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'cmc-non-repo-'));
    try {
      expect(await ops.isGitRepo(nonRepo)).toBe(false);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('stashCreate returns empty string when working tree is clean', async () => {
    if (!repoRootIsGit) return;
    repoDir = await initRepo();
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'hello\n');
    await run(repoDir, ['add', '.']);
    await run(repoDir, ['commit', '-q', '-m', 'init']);

    const sha = await ops.stashCreate(repoDir, 'nothing to stash');
    expect(sha).toBe('');
  });

  it('stashCreate returns a valid SHA when there are changes, and the object exists', async () => {
    if (!repoRootIsGit) return;
    repoDir = await initRepo();
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'hello\n');
    await run(repoDir, ['add', '.']);
    await run(repoDir, ['commit', '-q', '-m', 'init']);

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'modified\n');

    const sha = await ops.stashCreate(repoDir, 'checkpoint');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    // Verify git object exists
    const proc = Bun.spawn({
      cmd: ['git', 'cat-file', '-t', sha],
      cwd: repoDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const type = (await new Response(proc.stdout).text()).trim();
    expect(await proc.exited).toBe(0);
    expect(type).toBe('commit');
  });

  it('checkoutAll restores worktree contents from a stash SHA', async () => {
    if (!repoRootIsGit) return;
    repoDir = await initRepo();
    const file = path.join(repoDir, 'a.txt');
    fs.writeFileSync(file, 'v1\n');
    await run(repoDir, ['add', '.']);
    await run(repoDir, ['commit', '-q', '-m', 'init']);

    // Modify and checkpoint
    fs.writeFileSync(file, 'v2-modified\n');
    const sha = await ops.stashCreate(repoDir, 'cp');
    expect(sha).not.toBe('');

    // Discard modifications
    await ops.resetHard(repoDir);
    expect(fs.readFileSync(file, 'utf8')).toBe('v1\n');

    // Restore from stash
    await ops.checkoutAll(repoDir, sha);
    expect(fs.readFileSync(file, 'utf8')).toBe('v2-modified\n');
  });

  it('resetHard restores HEAD state', async () => {
    if (!repoRootIsGit) return;
    repoDir = await initRepo();
    const file = path.join(repoDir, 'a.txt');
    fs.writeFileSync(file, 'v1\n');
    await run(repoDir, ['add', '.']);
    await run(repoDir, ['commit', '-q', '-m', 'init']);

    fs.writeFileSync(file, 'dirty\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('dirty\n');

    await ops.resetHard(repoDir);
    expect(fs.readFileSync(file, 'utf8')).toBe('v1\n');
  });

  it('throws on invalid ref', async () => {
    if (!repoRootIsGit) return;
    repoDir = await initRepo();
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'x\n');
    await run(repoDir, ['add', '.']);
    await run(repoDir, ['commit', '-q', '-m', 'init']);

    await expect(ops.resetHard(repoDir, 'nonexistent-ref')).rejects.toThrow();
  });
});
