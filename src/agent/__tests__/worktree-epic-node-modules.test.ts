import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../worktree-manager.ts';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

describe('WorktreeManager — epic worktree node_modules symlink provisioning', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-nm-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'main']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-nm-persist-'));
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: path.join(persistDir, 'worktrees'),
      persistDir,
    });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => {});
  });

  it('Test A: creates the link, resolving to the main checkout', async () => {
    // Fixture: main repo with root package.json + ui/package.json + ui/node_modules
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'jsdom'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'node_modules', 'jsdom', 'index.js'), 'module.exports=1\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'packages']);

    const epic = await mgr.ensureEpic('nm-epic');
    expect(epic).not.toBeNull();

    const uiNM = path.join(epic!.path, 'ui', 'node_modules');
    const stat = await fs.lstat(uiNM);
    expect(stat.isSymbolicLink()).toBe(true);

    // realpath on both sides to handle macOS /var symlink canonicalization
    const actualTarget = await fs.realpath(uiNM);
    const expectedTarget = await fs.realpath(path.join(repo, 'ui', 'node_modules'));
    expect(actualTarget).toBe(expectedTarget);

    // Resolves THROUGH the link
    await fs.access(path.join(uiNM, 'jsdom', 'index.js'));
  });

  it('Test B: idempotent; second call does not throw and link still resolves', async () => {
    // Fixture: main repo with ui/node_modules
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'jsdom'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'node_modules', 'jsdom', 'index.js'), 'module.exports=1\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'packages']);

    const first = await mgr.ensureEpic('nm-epic');
    expect(first).not.toBeNull();

    // Second call should not throw
    await expect(mgr.ensureEpic('nm-epic')).resolves.not.toBeNull();

    const uiNM = path.join(first!.path, 'ui', 'node_modules');
    const stat = await fs.lstat(uiNM);
    expect(stat.isSymbolicLink()).toBe(true);

    const actualTarget = await fs.realpath(uiNM);
    const expectedTarget = await fs.realpath(path.join(repo, 'ui', 'node_modules'));
    expect(actualTarget).toBe(expectedTarget);
  });

  it('Test C: a real directory at the destination survives (never clobber)', async () => {
    // Fixture: main repo with ui/node_modules
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'jsdom'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'node_modules', 'jsdom', 'index.js'), 'module.exports=1\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'packages']);

    const first = await mgr.ensureEpic('nm-epic');
    expect(first).not.toBeNull();

    const uiNM = path.join(first!.path, 'ui', 'node_modules');
    // Remove the symlink
    await fs.rm(uiNM, { recursive: true, force: true });
    // Create a real directory with a sentinel file
    await fs.mkdir(uiNM, { recursive: true });
    const sentinelPath = path.join(uiNM, 'sentinel.txt');
    await fs.writeFile(sentinelPath, 'keep-me\n');

    // Re-ensure the epic — should not clobber the real directory
    await mgr.ensureEpic('nm-epic');

    // Should NOT be a symlink
    const stat = await fs.lstat(uiNM);
    expect(stat.isSymbolicLink()).toBe(false);

    // Sentinel should still be readable
    const content = await fs.readFile(sentinelPath, 'utf8');
    expect(content).toBe('keep-me\n');
  });

  it('Test D: missing deps do not fail creation', async () => {
    // Fixture: main repo with ui/package.json but NO ui/node_modules
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'packages']);

    // Should not throw even though ui/node_modules doesn't exist
    await expect(mgr.ensureEpic('nm-epic-2')).resolves.not.toBeNull();

    const epic = await mgr.ensureEpic('nm-epic-2');
    const uiNM = path.join(epic!.path, 'ui', 'node_modules');

    // ui/node_modules should not exist in the worktree
    try {
      await fs.lstat(uiNM);
      expect(false).toBe(true); // should not reach here
    } catch (err: any) {
      expect(err.code).toBe('ENOENT');
    }
  });
});
