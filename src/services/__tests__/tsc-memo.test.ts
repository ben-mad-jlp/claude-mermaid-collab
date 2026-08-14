/**
 * tsc-memo.test.ts — ONE durable tree-keyed typecheck verdict, consulted by all runners.
 *
 * HEADLINE (fails on master, where no shared layer exists): steward-proof's tscClean
 * records a PASS for a tree, and the land-gate typecheck floor plus the base gate's
 * typecheck lane for the SAME tree are then served with ZERO spawns. On master each of
 * those four runners re-ran the whole-tree typecheck independently — the only memo was
 * steward-proof's in-process Map keyed `${cwd}:${HEAD}`, underivable by the others.
 *
 * Hermetic: MERMAID_SUPERVISOR_DIR points at a per-file temp dir (set before any ledger
 * open), runners/git/clock are injected everywhere a real spawn would otherwise happen.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const supervisorDir = mkdtempSync(join(tmpdir(), 'tsc-memo-test-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { memoizedTsc, resolveTscKey, TSC_FAIL_TTL_MS, type TscGit } from '../tsc-memo';
import { recordTscVerdict, getTscVerdict, _closeLedgerDb } from '../worker-ledger';
import { stewardTscClean } from '../steward-proof';
import { runLandTypecheckFloor } from '../land-typecheck-floor';
import { runBaseGate, type GateSpawn } from '../leaf-gate';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

/** A committed clean repo WITH a tsconfig.json, so detectCompileCheck selects the tsc
 *  command — the same command every production runner resolves for a TS repo. */
function makeTsRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tsc-memo-repo-'));
  git(dir, 'init', '-q', '-b', 'master');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'tsconfig.json'), '{}\n');
  // Unique content per repo: identical trees HASH IDENTICALLY (by design — that is the
  // memo's whole point), so without this every test repo would share one verdict.
  writeFileSync(join(dir, 'a.ts'), `export const a = ${JSON.stringify(dir)};\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

const repos: string[] = [];
function repo(): string {
  const r = makeTsRepo();
  repos.push(r);
  return r;
}

/** Counting runner: every invocation is a "spawn" the memo failed to save. */
function countingRunner(result: { ran?: boolean; code?: number; output?: string } = {}) {
  const state = { runs: 0 };
  const runner = async () => {
    state.runs++;
    return { ran: result.ran ?? true, code: result.code ?? 0, output: result.output ?? '' };
  };
  return { state, runner };
}

/** Fake in-memory git for pure (no-repo) tests. */
function fakeGit(o: { porcelain?: string; tree?: string; top?: string }): TscGit {
  return (_cwd, args) => {
    if (args[0] === 'status') return { code: 0, stdout: o.porcelain ?? '' };
    if (args[1] === 'HEAD^{tree}') return { code: 0, stdout: (o.tree ?? 'tree-1') + '\n' };
    if (args[1] === '--show-toplevel') return { code: 0, stdout: (o.top ?? '/repo') + '\n' };
    return { code: 1, stdout: '' };
  };
}

afterAll(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(supervisorDir, { recursive: true, force: true });
  for (const r of repos) rmSync(r, { recursive: true, force: true });
});

describe('cross-runner reuse (the headline — fails on master)', () => {
  it('a PASS recorded by steward tscClean serves the land floor AND the base-gate typecheck lane with ZERO spawns', async () => {
    const dir = repo();

    // 1. Steward measures: ONE run, verdict recorded durably for this tree.
    const steward = countingRunner({ code: 0 });
    expect(await stewardTscClean(dir, steward.runner)).toBe(true);
    expect(steward.state.runs).toBe(1);

    // 2. Land-gate typecheck floor, same tree: served from the memo — its spawn NEVER fires.
    const floorSpawn = countingRunner({ code: 0 });
    const floor = await runLandTypecheckFloor({
      repo: dir,
      epicWorktreeCwd: dir,
      spawn: floorSpawn.runner as unknown as GateSpawn,
    });
    expect(floor.status).toBe('pass');
    expect(floorSpawn.state.runs).toBe(0); // ← on master this is 1: every runner re-measured

    // 3. Base gate's cfg.typecheck lane, same tree + same command: also zero spawns.
    const baseSpawn = countingRunner({ code: 0 });
    const base = await runBaseGate(
      dir,
      { typecheck: 'npx tsc --noEmit -p tsconfig.json' },
      baseSpawn.runner as unknown as GateSpawn,
    );
    expect(base.status).toBe('pass');
    expect(baseSpawn.state.runs).toBe(0); // ← on master this is 1
  });
});

describe('tree-hash identity (not commit sha)', () => {
  it('an empty commit on top — same tree, new commit sha — still HITS', async () => {
    const dir = repo();
    const { state, runner } = countingRunner({ code: 0 });
    const r1 = await memoizedTsc(dir, 'tsc-cmd-tree-test', { runner });
    expect(r1.source).toBe('run');
    const shaBefore = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'no-op tip bump');
    expect(git(dir, 'rev-parse', 'HEAD')).not.toBe(shaBefore); // commit sha moved…
    const r2 = await memoizedTsc(dir, 'tsc-cmd-tree-test', { runner });
    expect(r2.source).toBe('memo'); // …but the TREE did not
    expect(state.runs).toBe(1);
  });

  it('a REAL content change (new tree) misses and re-measures', async () => {
    const dir = repo();
    const { state, runner } = countingRunner({ code: 0 });
    await memoizedTsc(dir, 'tsc-cmd-content-test', { runner });
    writeFileSync(join(dir, 'b.ts'), 'export const b = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'content change');
    const r2 = await memoizedTsc(dir, 'tsc-cmd-content-test', { runner });
    expect(r2.source).toBe('run');
    expect(state.runs).toBe(2);
  });
});

describe('dirty-tree discipline', () => {
  it('a dirty tree never consults and never stores — always runs', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'dirty.ts'), 'export const d = 1;\n'); // untracked → porcelain non-empty
    const { state, runner } = countingRunner({ code: 0 });
    expect((await memoizedTsc(dir, 'tsc-cmd-dirty-test', { runner })).source).toBe('run');
    expect((await memoizedTsc(dir, 'tsc-cmd-dirty-test', { runner })).source).toBe('run');
    expect(state.runs).toBe(2);
    // Nothing was stored while dirty: cleaning the tree still MISSES on first consult.
    rmSync(join(dir, 'dirty.ts'));
    expect((await memoizedTsc(dir, 'tsc-cmd-dirty-test', { runner })).source).toBe('run');
    expect(state.runs).toBe(3);
    // …and only now is the clean-tree verdict durable.
    expect((await memoizedTsc(dir, 'tsc-cmd-dirty-test', { runner })).source).toBe('memo');
    expect(state.runs).toBe(3);
  });
});

describe('FAIL serve budget', () => {
  it('a FAIL is served WITH its output within 10 min, then re-measured', async () => {
    let t = 1_000_000_000;
    const now = () => t;
    const g = fakeGit({ tree: 'tree-fail-ttl' });
    const { state, runner } = countingRunner({ code: 2, output: 'x.ts(1,1): error TS2322: boom\n' });

    const r1 = await memoizedTsc('/repo', 'tsc-cmd-fail', { runner, git: g, now });
    expect(r1.source).toBe('run');
    expect(r1.code).toBe(2);

    t += TSC_FAIL_TTL_MS - 1; // still inside the budget
    const r2 = await memoizedTsc('/repo', 'tsc-cmd-fail', { runner, git: g, now });
    expect(r2.source).toBe('memo');
    expect(r2.code).toBe(2);
    expect(r2.output).toContain('error TS2322: boom'); // a served FAIL still explains itself
    expect(state.runs).toBe(1);

    t += 2; // past the budget — a red must re-earn itself
    const r3 = await memoizedTsc('/repo', 'tsc-cmd-fail', { runner, git: g, now });
    expect(r3.source).toBe('run');
    expect(state.runs).toBe(2);
  });

  it('a PASS is served indefinitely for its tree', async () => {
    let t = 1_000_000_000;
    const now = () => t;
    const g = fakeGit({ tree: 'tree-pass-forever' });
    const { state, runner } = countingRunner({ code: 0 });
    await memoizedTsc('/repo', 'tsc-cmd-pass', { runner, git: g, now });
    t += 365 * 24 * 60 * 60 * 1000; // a year later, same tree
    const r2 = await memoizedTsc('/repo', 'tsc-cmd-pass', { runner, git: g, now });
    expect(r2.source).toBe('memo');
    expect(state.runs).toBe(1);
  });
});

describe('fail-open plumbing', () => {
  it('a throwing git still invokes the runner (never blocks a gate)', async () => {
    const g: TscGit = () => {
      throw new Error('git exploded');
    };
    const { state, runner } = countingRunner({ code: 0 });
    const r = await memoizedTsc('/repo', 'tsc-cmd-git-throws', { runner, git: g });
    expect(r.source).toBe('run');
    expect(r.code).toBe(0);
    expect(state.runs).toBe(1);
  });

  it('a ran:false runner result (spawn failure / missing compiler) is NEVER recorded', async () => {
    const g = fakeGit({ tree: 'tree-ran-false' });
    const { state, runner } = countingRunner({ ran: false, code: 1 });
    await memoizedTsc('/repo', 'tsc-cmd-ran-false', { runner, git: g });
    await memoizedTsc('/repo', 'tsc-cmd-ran-false', { runner, git: g });
    expect(state.runs).toBe(2); // no verdict stored → no serve
  });

  it("steward's compiler-absent ABSTAIN stays uncached and reads as clean", async () => {
    const dir = repo();
    const { state, runner } = countingRunner({ ran: false, code: 1 });
    expect(await stewardTscClean(dir, runner)).toBe(true); // inapplicable, never a failure
    expect(await stewardTscClean(dir, runner)).toBe(true);
    expect(state.runs).toBe(2); // installing the toolchain takes effect immediately
  });
});

describe('key identity', () => {
  it('same tree, different command → different keys', async () => {
    const g = fakeGit({ tree: 'tree-cmd-split' });
    const a = await resolveTscKey('/repo', 'cmd-a', g);
    const b = await resolveTscKey('/repo', 'cmd-b', g);
    expect(a.key).not.toBe('');
    expect(a.key).not.toBe(b.key);
  });

  it('same command + tree, different cwd RELATIVE to the toplevel → different keys (a subdir reads a different tsconfig)', async () => {
    const g = fakeGit({ tree: 'tree-cwd-split', top: '/repo' });
    const root = await resolveTscKey('/repo', 'cmd', g);
    const desktop = await resolveTscKey('/repo/desktop', 'cmd', g);
    expect(root.cwdKind).toBe('');
    expect(desktop.cwdKind).toBe('desktop');
    expect(root.key).not.toBe(desktop.key);
  });

  it('two checkouts of the SAME tree share a key (worktree-independence)', async () => {
    const g1 = fakeGit({ tree: 'tree-shared', top: '/checkout-one' });
    const g2 = fakeGit({ tree: 'tree-shared', top: '/checkout-two' });
    const k1 = await resolveTscKey('/checkout-one', 'cmd', g1);
    const k2 = await resolveTscKey('/checkout-two', 'cmd', g2);
    expect(k1.key).toBe(k2.key);
  });
});

describe('worker-ledger tsc_verdict helpers', () => {
  it('recordTscVerdict re-reads after write and round-trips through getTscVerdict', () => {
    const ok = recordTscVerdict(
      { key: 'k-roundtrip', cwdKind: '', treeSha: 't1', command: 'c1', status: 'fail', exitCode: 2, output: 'tail' },
      12345,
    );
    expect(ok).toBe(true);
    const row = getTscVerdict('k-roundtrip');
    expect(row?.status).toBe('fail');
    expect(row?.exitCode).toBe(2);
    expect(row?.output).toBe('tail');
    expect(row?.measuredAt).toBe(12345);
    expect(getTscVerdict('k-missing')).toBeNull();
  });
});
