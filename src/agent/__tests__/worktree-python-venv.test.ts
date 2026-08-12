/**
 * Worktree provisioning for PYTHON projects (handoff
 * `handoff-leaf-worktree-python-provisioning-and-contested-card-diagnosis`, Finding 1).
 *
 * A git worktree starts WITHOUT `.venv` (gitignored), so a Python leaf whose acceptance
 * requires pytest had exactly two options: `cd` into the main checkout and borrow its
 * interpreter — a scope violation that BLOCKS the leaf — or not run its tests at all.
 * Observed live in yolox-markup mission 6e7ef04d: 5 `working-root-escape` incidents across
 * 2 leaves in one morning, one of which ran `git stash` in the MAIN checkout, and one leaf
 * that reached reviewVerdict:"pass" and was blocked anyway as `scope-incident`.
 *
 * The node_modules fix (decision c4a8bf40) was the identical case and was never generalised
 * past Node. These tests pin the generalisation.
 *
 * MUTATION CONTRACT: remove the python row from `SHARED_DEP_ECOSYSTEMS` and Test A/B/E must
 * red. Narrow the exclude patterns back to node_modules-only and Test C must red.
 */
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

/** Fixture: a python project at `backend/` whose venv exists ONLY in the main checkout. */
async function pythonRepo(repo: string, venvDir = '.venv'): Promise<void> {
  await fs.writeFile(path.join(repo, '.gitignore'), `${venvDir}/\nnode_modules/\n`);
  await fs.mkdir(path.join(repo, 'backend'), { recursive: true });
  await fs.writeFile(path.join(repo, 'backend', 'pyproject.toml'), '[project]\nname="backend"\n');
  await fs.mkdir(path.join(repo, 'backend', venvDir, 'bin'), { recursive: true });
  await fs.writeFile(path.join(repo, 'backend', venvDir, 'bin', 'python'), '#!/bin/sh\necho py\n');
  await fs.writeFile(path.join(repo, 'backend', venvDir, 'pyvenv.cfg'), 'home = /usr/bin\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', 'python project']);
}

describe('WorktreeManager — python venv provisioning', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-venv-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'main']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-venv-persist-'));
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

  it('Test A: a LEAF worktree gets backend/.venv, resolving to the main checkout', async () => {
    await pythonRepo(repo);

    const wt = await mgr.ensure('leaf-py-a');
    const link = path.join(wt.path, 'backend', '.venv');

    const st = await fs.lstat(link);
    expect(st.isSymbolicLink()).toBe(true);
    expect(await fs.realpath(link)).toBe(await fs.realpath(path.join(repo, 'backend', '.venv')));

    // The whole point: the interpreter is reachable from inside the worktree.
    expect(await fs.readFile(path.join(link, 'bin', 'python'), 'utf8')).toContain('echo py');
  });

  it('Test B: an EPIC worktree gets it too (the second call site)', async () => {
    await pythonRepo(repo);

    const epic = await mgr.ensureEpic('py-epic');
    expect(epic).not.toBeNull();
    const link = path.join(epic!.path, 'backend', '.venv');

    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(link)).toBe(await fs.realpath(path.join(repo, 'backend', '.venv')));
  });

  it('Test C: the venv symlink is git-excluded so a worker can never stage it', async () => {
    await pythonRepo(repo);
    const wt = await mgr.ensure('leaf-py-c');

    const res = await runGit(wt.path, ['rev-parse', '--git-path', 'info/exclude']);
    const raw = res.stdout.trim();
    const excludePath = path.isAbsolute(raw) ? raw : path.join(wt.path, raw);
    const body = await fs.readFile(excludePath, 'utf8');
    expect(body).toContain('/backend/.venv');

    // Behavioural proof, not just the file contents: git must refuse to see it.
    const status = await runGit(wt.path, ['status', '--porcelain', '--untracked-files=all']);
    expect(status.stdout).not.toContain('backend/.venv');
  });

  it('Test D: never clobbers a real venv already present in the worktree', async () => {
    await pythonRepo(repo);
    const wt = await mgr.ensure('leaf-py-d');

    // Re-running provisioning must be a no-op, not a replace (idempotence + data-loss guard).
    const before = await fs.realpath(path.join(wt.path, 'backend', '.venv'));
    const again = await mgr.ensure('leaf-py-d');
    expect(await fs.realpath(path.join(again.path, 'backend', '.venv'))).toBe(before);
  });

  it('Test E: a bare `venv` layout works too, and only ONE dep dir is linked', async () => {
    await pythonRepo(repo, 'venv');
    const wt = await mgr.ensure('leaf-py-e');

    expect((await fs.lstat(path.join(wt.path, 'backend', 'venv'))).isSymbolicLink()).toBe(true);
    // `.venv` does not exist in the main repo, so nothing should have been linked for it.
    await expect(fs.lstat(path.join(wt.path, 'backend', '.venv'))).rejects.toThrow();
  });

  it('Test F: a python project with NO venv in the main checkout is a clean no-op', async () => {
    await fs.writeFile(path.join(repo, '.gitignore'), '.venv/\n');
    await fs.mkdir(path.join(repo, 'backend'), { recursive: true });
    await fs.writeFile(path.join(repo, 'backend', 'requirements.txt'), 'pytest\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'no venv']);

    const wt = await mgr.ensure('leaf-py-f');
    // Worktree still created; simply nothing to link.
    expect(wt.path).toBeTruthy();
    await expect(fs.lstat(path.join(wt.path, 'backend', '.venv'))).rejects.toThrow();
  });

  it('Test G: node_modules provisioning still works (no regression from the generalisation)', async () => {
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'jsdom'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'node_modules', 'jsdom', 'index.js'), 'module.exports=1\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'js project']);

    const wt = await mgr.ensure('leaf-js');
    const link = path.join(wt.path, 'ui', 'node_modules');
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(link)).toBe(await fs.realpath(path.join(repo, 'ui', 'node_modules')));

    const res = await runGit(wt.path, ['rev-parse', '--git-path', 'info/exclude']);
    const raw = res.stdout.trim();
    const excludePath = path.isAbsolute(raw) ? raw : path.join(wt.path, raw);
    expect(await fs.readFile(excludePath, 'utf8')).toContain('/ui/node_modules');
  });

  it('Test H: a POLYGLOT repo gets both ecosystems in one worktree', async () => {
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n.venv/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1\n');
    await fs.mkdir(path.join(repo, 'backend'), { recursive: true });
    await fs.writeFile(path.join(repo, 'backend', 'pyproject.toml'), '[project]\nname="backend"\n');
    await fs.mkdir(path.join(repo, 'backend', '.venv', 'bin'), { recursive: true });
    await fs.writeFile(path.join(repo, 'backend', '.venv', 'bin', 'python'), '#!/bin/sh\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'polyglot']);

    const wt = await mgr.ensure('leaf-poly');
    expect((await fs.lstat(path.join(wt.path, 'node_modules'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(wt.path, 'backend', '.venv'))).isSymbolicLink()).toBe(true);
  });
});
