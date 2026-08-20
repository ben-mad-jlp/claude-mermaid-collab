/**
 * Pins (1) nested ui/node_modules provisioning via WorktreeManager.ensure() and
 * (2) out-of-scope gate-could-not-run → leaf-gate-could-not-run infra classification.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../../agent/worktree-manager.ts';
import { formatGateErrorReason } from '../leaf-gate.ts';
import { classifyInfraRejection } from '../conductor-infra-arm.ts';

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

describe('worktree-ui-anchor', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-ui-anchor-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'main']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-ui-anchor-persist-'));
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

  it('a fresh leaf worktree resolves ui/vite from the main checkout ui/node_modules', async () => {
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'root' }) + '\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), JSON.stringify({ name: 'ui' }) + '\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'tracked packages']);

    // Main-checkout deps only — never staged (gitignored).
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'vite'), { recursive: true });
    await fs.writeFile(
      path.join(repo, 'ui', 'node_modules', 'vite', 'package.json'),
      JSON.stringify({ name: 'vite' }) + '\n',
    );

    const wt = await mgr.ensure('leaf-ui-anchor');
    const wtNm = path.join(wt.path, 'ui', 'node_modules');
    const repoNm = path.join(repo, 'ui', 'node_modules');

    expect((await fs.lstat(wtNm)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(wtNm)).toBe(await fs.realpath(repoNm));
    expect(
      JSON.parse(await fs.readFile(path.join(wtNm, 'vite', 'package.json'), 'utf8')).name,
    ).toBe('vite');
  });

  it('a gate-could-not-run naming a file outside declaredFiles classifies as infra rather than a leaf rejection', () => {
    const reason = formatGateErrorReason({
      status: 'error',
      command: 'npx tsc --noEmit',
      output: "ui/src/Foo.tsx(3,1): error TS2307: Cannot find module './x'",
      reasons: [],
      declared: true,
    });

    expect(classifyInfraRejection(reason, ['src/services/leaf-gate.ts'])).toBe('leaf-gate-could-not-run');
    expect(classifyInfraRejection(reason, ['ui/src/Foo.tsx'])).toBeNull();
  });
});
