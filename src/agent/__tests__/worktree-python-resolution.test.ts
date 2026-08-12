/**
 * PYTHON MODULE RESOLUTION in a leaf worktree with a SHARED venv.
 *
 * Sharing a venv shares its editable-install pin, and that pin is an absolute path into the
 * MAIN CHECKOUT. So `<worktree>/backend/.venv/bin/python -m pytest` imports the package from
 * the main checkout and tests code the leaf did not change — a leaf that MODIFIES behaviour
 * gets a green suite that never ran its diff. Live reproduction, 2026-08-07 (yolox-markup):
 *
 *   (no PYTHONPATH)             → /Users/…/yolox-markup/backend/src/annotator   ← MAIN
 *   PYTHONPATH=$PWD/backend/src → <worktree>/backend/src/annotator              ← correct
 *
 * MUTATION CONTRACT: these assert RESOLUTION, never "PYTHONPATH is set". A test that only
 * checked the variable would pass while the bug survived — the variable being present says
 * nothing about whether it wins against a `.pth`. Test A is the one that fails on 19e8d88b
 * (6.21.9) and passes after; delete the `pythonPathFor` call in worktreeSpawnEnv and it reds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { worktreeSpawnEnv } from '../node-invoker.ts';
import { pythonPathFor, pythonSourceDirs } from '../python-env.ts';

const HAS_PY3 = await (async () => {
  try {
    const p = (globalThis as any).Bun.spawn(['python3', '-c', 'print(1)'], { stdout: 'pipe', stderr: 'pipe' });
    return (await p.exited) === 0;
  } catch { return false; }
})();

/** Run a python snippet through `interp` with `env`, returning trimmed stdout. */
async function runPy(interp: string, code: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  const proc = (globalThis as any).Bun.spawn([interp, '-c', code], {
    cwd, env: env as any, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  });
  const [out, err, code_] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  if (code_ !== 0) throw new Error(`python failed (${code_}): ${err || out}`);
  return out.trim();
}

describe('python module resolution under a shared venv', () => {
  let main: string;      // the "main checkout"
  let wt: string;        // the "leaf worktree"
  let venv: string;      // real venv, created in main, symlinked into wt

  beforeEach(async () => {
    main = await fs.mkdtemp(path.join(os.tmpdir(), 'pyres-main-'));
    wt = await fs.mkdtemp(path.join(os.tmpdir(), 'pyres-wt-'));

    // Both trees hold the SAME package name with DIFFERENT contents, so the resolved
    // path alone tells us which tree was imported.
    for (const [root, tag] of [[main, 'MAIN'], [wt, 'WORKTREE']] as const) {
      await fs.mkdir(path.join(root, 'backend', 'src', 'annotator'), { recursive: true });
      await fs.writeFile(path.join(root, 'backend', 'src', 'annotator', '__init__.py'), `TAG = "${tag}"\n`);
      await fs.writeFile(path.join(root, 'backend', 'pyproject.toml'), '[project]\nname="annotator"\n');
    }
  });

  afterEach(async () => {
    await fs.rm(main, { recursive: true, force: true }).catch(() => {});
    await fs.rm(wt, { recursive: true, force: true }).catch(() => {});
  });

  /** Create a REAL venv in main/backend and editable-pin it at main's src, exactly as
   *  `pip install -e` does; then symlink it into the worktree as linkSharedDeps would. */
  async function provisionSharedVenv(): Promise<string> {
    venv = path.join(main, 'backend', '.venv');
    const mk = (globalThis as any).Bun.spawn(['python3', '-m', 'venv', venv], { stdout: 'pipe', stderr: 'pipe' });
    if ((await mk.exited) !== 0) throw new Error('venv creation failed');
    const sp = (await fs.readdir(path.join(venv, 'lib')))[0];
    const sitePkgs = path.join(venv, 'lib', sp, 'site-packages');
    await fs.writeFile(
      path.join(sitePkgs, '__editable__.annotator-0.1.0.pth'),
      `${path.join(main, 'backend', 'src')}\n`,
    );
    await fs.symlink(venv, path.join(wt, 'backend', '.venv'), 'dir');
    return path.join(wt, 'backend', '.venv', 'bin', 'python');
  }

  it.if(HAS_PY3)('Test A: worktreeSpawnEnv makes the import resolve INSIDE the worktree', async () => {
    const interp = await provisionSharedVenv();

    // Control: the bug, with a bare env — the .pth wins and we get the MAIN checkout.
    const bare = await runPy(interp, 'import annotator;print(annotator.TAG)', wt, { PATH: process.env.PATH } as any);
    expect(bare).toBe('MAIN');

    // The fix: spawn env built by worktreeSpawnEnv resolves to the WORKTREE.
    const env = worktreeSpawnEnv(wt, { PATH: process.env.PATH } as any);
    const fixed = await runPy(interp, 'import annotator;print(annotator.TAG)', wt, env);
    expect(fixed).toBe('WORKTREE');

    // And the file actually loaded lives under the worktree, not merely a matching tag.
    // realpath BOTH sides: on macOS /var/folders resolves to /private/var/folders, so
    // comparing a resolved path against an unresolved one is a false negative.
    const where = await runPy(
      interp,
      'import annotator,os;print(os.path.realpath(os.path.dirname(annotator.__file__)))',
      wt,
      env,
    );
    expect(where.startsWith(await fs.realpath(wt))).toBe(true);
    expect(where.startsWith(await fs.realpath(main))).toBe(false);
  });

  it.if(HAS_PY3)('Test B: an INHERITED PYTHONPATH still resolves, and ours wins', async () => {
    const interp = await provisionSharedVenv();
    const extra = await fs.mkdtemp(path.join(os.tmpdir(), 'pyres-extra-'));
    await fs.mkdir(path.join(extra, 'sidecar'), { recursive: true });
    await fs.writeFile(path.join(extra, 'sidecar', '__init__.py'), 'OK = 1\n');

    const env = worktreeSpawnEnv(wt, { PATH: process.env.PATH, PYTHONPATH: extra } as any);

    // Ours wins for the contested package …
    expect(await runPy(interp, 'import annotator;print(annotator.TAG)', wt, env)).toBe('WORKTREE');
    // … and the inherited entry SURVIVES (not clobbered).
    expect(await runPy(interp, 'import sidecar;print(sidecar.OK)', wt, env)).toBe('1');

    await fs.rm(extra, { recursive: true, force: true }).catch(() => {});
  });

  it('Test C: a repo with NO python dirs gets no PYTHONPATH key at all', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'pyres-plain-'));
    await fs.writeFile(path.join(plain, 'package.json'), '{"name":"js-only"}\n');

    const env = worktreeSpawnEnv(plain, { PATH: '/usr/bin' } as any);
    expect('PYTHONPATH' in env).toBe(false);      // not '' and not ':' — absent
    expect(pythonPathFor(plain)).toBeUndefined();

    await fs.rm(plain, { recursive: true, force: true }).catch(() => {});
  });

  it('Test D: a non-python repo does not clobber an inherited PYTHONPATH', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'pyres-plain2-'));
    await fs.writeFile(path.join(plain, 'package.json'), '{"name":"js-only"}\n');

    const env = worktreeSpawnEnv(plain, { PATH: '/usr/bin', PYTHONPATH: '/inherited' } as any);
    expect(env.PYTHONPATH).toBe('/inherited');

    await fs.rm(plain, { recursive: true, force: true }).catch(() => {});
  });

  it('Test E: src-layout is preferred, flat layout falls back to the project dir', async () => {
    // wt already has backend/src → src-layout
    expect(pythonSourceDirs(wt)).toEqual([path.join(wt, 'backend', 'src')]);

    const flat = await fs.mkdtemp(path.join(os.tmpdir(), 'pyres-flat-'));
    await fs.mkdir(path.join(flat, 'svc'), { recursive: true });
    await fs.writeFile(path.join(flat, 'svc', 'requirements.txt'), 'pytest\n');
    expect(pythonSourceDirs(flat)).toEqual([path.join(flat, 'svc')]);

    await fs.rm(flat, { recursive: true, force: true }).catch(() => {});
  });

  it('Test F: git isolation from E3 is untouched by the PYTHONPATH addition', async () => {
    const env = worktreeSpawnEnv(wt, {
      PATH: '/usr/bin', GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/elsewhere',
    } as any);
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_CEILING_DIRECTORIES).toBe(path.dirname(wt));
    expect(env.MERMAID_LEAF_WORKTREE).toBe(wt);
  });
});
