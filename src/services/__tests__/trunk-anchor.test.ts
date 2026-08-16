/**
 * trunk-anchor.ts — the daemon-side producer of FULL-SUITE green anchors at the trunk sha.
 *
 * Anchor miss ⇒ exactly ONE run dispatched THROUGH the coalescer, and the stored verdict
 * lands under the exact key `planImpactedBaseGate` reads (cross-checked by consuming it).
 * Existing full-suite PASS ⇒ no run. Failed run ⇒ no PASS stored + 15-min retry throttle
 * (injected clock). Recursion guard: the anchor run's gate invocation gets NO impacted
 * opts, so its lanes run un-narrowed and its verdict satisfies isFullSuiteAnchorVerdict.
 *
 * Harness mirrors base-gate-shared-verdict.test.ts (real worker-ledger on a temp
 * MERMAID_SUPERVISOR_DIR, bun:sqlite). Runs via `bun test`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runBaseGateShared, baseGateKey, quarantineSetHash, sharedVerdictKey, resetBaseGateCoalescer,
} from '../base-gate-coalescer';
import { recordBaseGateVerdict, getBaseGateVerdict, _closeLedgerDb } from '../worker-ledger';
import {
  planImpactedBaseGate, isFullSuiteAnchorVerdict, type ImpactedBaseGateOpts,
} from '../base-gate-impacted';
import {
  ensureTrunkAnchor, resetTrunkAnchorThrottle, TRUNK_ANCHOR_FAIL_RETRY_MS,
  defaultMakeTrunkWorktree,
  type EnsureTrunkAnchorOpts,
} from '../trunk-anchor';
import type { GateSpawn, LeafGateConfig, LeafGateResult, GateDeclaration } from '../leaf-gate';
import type { FloorPlan } from '../impacted-tests';
import { defaultGitRunner, type GitRunner } from '../trunk-ref';

const PROJECT = '/proj';
const TRUNK_SHA = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111'; // M
const BASE_SHA = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222'; // an epic base B on top of M
const SUITE_CMD = 'bun run scripts/test-backend.ts --baseline=scripts/backend-test-baseline.json';

const CFG: LeafGateConfig = {
  typecheck: 'npx tsc --noEmit',
  suites: [{ match: /^src\//, command: SUITE_CMD }],
};

const Q_HASH = quarantineSetHash([]);
const VKEY = () => sharedVerdictKey(baseGateKey(PROJECT, TRUNK_SHA, CFG), Q_HASH);

const PASS: LeafGateResult = { status: 'pass', output: 'all green', reasons: [], declared: true, baselineFailures: {} };
const FAIL: LeafGateResult = {
  status: 'fail', command: SUITE_CMD, output: 'FAIL src/x.test.ts',
  reasons: ['suite lane failed'], declared: true, baselineFailures: { 'suites:^src\\/': ['src/x.test.ts'] },
};

/** Injected git for ensureTrunkAnchor: no origin/HEAD, no `main`; trunk = master @ M. */
const anchorGit: GitRunner = async (_cwd, args) => {
  if (args[0] === 'symbolic-ref') return { code: 1, stdout: '' };
  if (args[0] === 'rev-parse' && args.includes('main')) return { code: 1, stdout: '' };
  if (args[0] === 'rev-parse' && args.includes('master')) return { code: 0, stdout: `${TRUNK_SHA}\n` };
  return { code: 1, stdout: '' };
};

const DECL: GateDeclaration = { kind: 'declared', cfg: CFG, manifestPath: '/x/.collab/project.json' };

function anchorOpts(over: Partial<EnsureTrunkAnchorOpts> = {}): EnsureTrunkAnchorOpts {
  return {
    runGit: anchorGit,
    gateDecl: () => DECL,
    quarantine: () => [],
    makeWorktree: async () => ({ path: '/trunk-wt', cleanup: async () => {} }),
    runGate: async () => PASS,
    ...over,
  };
}

/** planImpactedBaseGate opts for an epic base B whose merge-base with trunk is M. */
function consumerOpts(over: Partial<ImpactedBaseGateOpts> = {}): ImpactedBaseGateOpts {
  const git: GitRunner = async (_cwd, args) => {
    if (args[0] === 'symbolic-ref') return { code: 1, stdout: '' };
    if (args[0] === 'rev-parse' && args.includes('main')) return { code: 1, stdout: '' };
    if (args[0] === 'rev-parse' && args.includes('master')) return { code: 0, stdout: `${TRUNK_SHA}\n` };
    if (args[0] === 'merge-base') return { code: 0, stdout: `${TRUNK_SHA}\n` };
    if (args[0] === 'diff') return { code: 0, stdout: 'src/services/foo.ts\n' };
    return { code: 1, stdout: '' };
  };
  const planner = (): FloorPlan => ({ mode: 'impacted', tests: ['src/a.test.ts'], candidateCount: 7, trigger: null });
  return {
    project: PROJECT, baseSha: BASE_SHA, quarantineHash: Q_HASH,
    runGit: git, planner, ensureAnchor: () => {},
    ...over,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trunk-anchor-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
  resetBaseGateCoalescer();
  resetTrunkAnchorThrottle();
});
afterEach(() => {
  _closeLedgerDb();
  resetBaseGateCoalescer();
  resetTrunkAnchorThrottle();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('anchor miss → one capped run → consumable anchor', () => {
  test('dispatches exactly one run THROUGH the coalescer and stores a full-suite PASS under the key planImpactedBaseGate reads', async () => {
    let runs = 0;
    const sharedKeys: string[] = [];
    const runShared: typeof runBaseGateShared = (key, run, opts) => {
      sharedKeys.push(key);
      return runBaseGateShared(key, run, opts); // delegate to the REAL coalescer
    };

    const r = await ensureTrunkAnchor(PROJECT, anchorOpts({
      runShared,
      runGate: async () => { runs++; return PASS; },
    }));
    expect(r).toEqual({ ran: true, anchored: true });
    expect(runs).toBe(1);
    expect(sharedKeys).toEqual([baseGateKey(PROJECT, TRUNK_SHA, CFG)]);

    // The stored row is a full-suite anchor…
    const row = getBaseGateVerdict(VKEY());
    expect(row?.status).toBe('pass');
    expect(isFullSuiteAnchorVerdict(row!)).toBe(true);

    // …and the CONSUMER actually finds it: an epic base B on top of M plans impacted.
    const plan = await planImpactedBaseGate('/epic-wt', CFG, consumerOpts());
    expect(plan).toEqual({ mode: 'impacted', anchor: TRUNK_SHA, tests: ['src/a.test.ts'], candidateCount: 7 });

    // A second ensureTrunkAnchor call is a no-op.
    const r2 = await ensureTrunkAnchor(PROJECT, anchorOpts({
      runGate: async () => { runs++; throw new Error('must not run again'); },
      makeWorktree: async () => { throw new Error('must not create a worktree'); },
    }));
    expect(r2).toEqual({ ran: false, anchored: true });
    expect(runs).toBe(1);
  });

  test('concurrent triggers for the same (project, trunkSha) coalesce onto ONE attempt', async () => {
    let runs = 0;
    let release!: () => void;
    const gateDone = new Promise<void>((res) => { release = res; });
    const opts = anchorOpts({
      runGate: async () => { runs++; await gateDone; return PASS; },
    });
    const p1 = ensureTrunkAnchor(PROJECT, opts);
    const p2 = ensureTrunkAnchor(PROJECT, opts);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(runs).toBe(1);
    expect(r1.anchored).toBe(true);
    expect(r2.anchored).toBe(true);
  });
});

describe('existing full-suite PASS → no run', () => {
  test('a stored full-suite green anchor makes ensureTrunkAnchor a pure no-op', async () => {
    expect(recordBaseGateVerdict({
      key: VKEY(), project: PROJECT, baseSha: TRUNK_SHA, status: 'pass',
      resultJson: JSON.stringify(PASS), quarantineHash: Q_HASH,
    })).toBe(true);

    let worktrees = 0;
    const r = await ensureTrunkAnchor(PROJECT, anchorOpts({
      makeWorktree: async () => { worktrees++; return { path: '/trunk-wt', cleanup: async () => {} }; },
      runGate: async () => { throw new Error('must not run'); },
    }));
    expect(r).toEqual({ ran: false, anchored: true });
    expect(worktrees).toBe(0);
  });

  test('a stored IMPACTED-measured PASS is NOT an anchor: a real full-suite run replaces it', async () => {
    const impactedPass: LeafGateResult = { ...PASS, impactedBase: { anchor: 'x'.repeat(40), ran: 3, candidates: 9 } };
    expect(recordBaseGateVerdict({
      key: VKEY(), project: PROJECT, baseSha: TRUNK_SHA, status: 'pass',
      resultJson: JSON.stringify(impactedPass), quarantineHash: Q_HASH,
    })).toBe(true);
    expect(isFullSuiteAnchorVerdict(getBaseGateVerdict(VKEY())!)).toBe(false);

    let runs = 0;
    const r = await ensureTrunkAnchor(PROJECT, anchorOpts({ runGate: async () => { runs++; return PASS; } }));
    expect(runs).toBe(1);
    expect(r).toEqual({ ran: true, anchored: true });
    expect(isFullSuiteAnchorVerdict(getBaseGateVerdict(VKEY())!)).toBe(true);
  });
});

describe('failed run → no PASS stored, retry throttled 15 min', () => {
  test('fail stores a FAIL verdict (never a PASS); retry blocked inside 15 min, allowed after', async () => {
    let t = 10_000_000;
    const now = () => t;
    let runs = 0;

    const failOpts = anchorOpts({ now, runGate: async () => { runs++; return FAIL; } });
    const r1 = await ensureTrunkAnchor(PROJECT, failOpts);
    expect(runs).toBe(1);
    expect(r1.ran).toBe(true);
    expect(r1.anchored).toBe(false);
    const row = getBaseGateVerdict(VKEY());
    expect(row?.status).toBe('fail'); // the layer's semantics: a measured fail IS stored…
    // …but it can never anchor an impacted run.
    const plan = await planImpactedBaseGate('/epic-wt', CFG, consumerOpts());
    expect(plan.mode).toBe('full');

    // Inside the window: throttled, no new run.
    t += TRUNK_ANCHOR_FAIL_RETRY_MS - 1;
    const r2 = await ensureTrunkAnchor(PROJECT, failOpts);
    expect(runs).toBe(1);
    expect(r2.ran).toBe(false);
    expect(r2.anchored).toBe(false);

    // Past the window: one fresh re-measure, green this time → anchored.
    t += 2;
    const r3 = await ensureTrunkAnchor(PROJECT, anchorOpts({ now, runGate: async () => { runs++; return PASS; } }));
    expect(runs).toBe(2);
    expect(r3).toEqual({ ran: true, anchored: true });
  });
});

describe('recursion guard: the anchor run is never impacted-narrowed', () => {
  test('the DEFAULT gate runner spawns the raw lane commands — no --files= narrowing — and the verdict proves full-suite', async () => {
    // Even with everything an impacted run would need in place (a stored green at a
    // reachable sha), the anchor run must execute the un-narrowed lanes: runBaseGate's
    // `impacted` param is simply never passed.
    const spawned: string[] = [];
    const spawn: GateSpawn = async (_cwd, command) => {
      spawned.push(command);
      return { ran: true, code: 0, output: 'ok' };
    };
    const r = await ensureTrunkAnchor(PROJECT, anchorOpts({
      runGate: undefined, // exercise the DEFAULT runGate (real runBaseGate)
      spawn,
    }));
    expect(r).toEqual({ ran: true, anchored: true });
    expect(spawned).toEqual(['npx tsc --noEmit', SUITE_CMD]); // full lanes, verbatim
    for (const cmd of spawned) expect(cmd).not.toContain('--files=');
    expect(isFullSuiteAnchorVerdict(getBaseGateVerdict(VKEY())!)).toBe(true);
  });
});

describe('lazy trigger inside planImpactedBaseGate', () => {
  test('anchor-lookup MISS fires ensureAnchor (fire-and-forget) and still returns full', async () => {
    const fired: string[] = [];
    const plan = await planImpactedBaseGate('/epic-wt', CFG, consumerOpts({
      ensureAnchor: (p) => { fired.push(p); },
    }));
    expect(plan.mode).toBe('full');
    expect(fired).toEqual([PROJECT]);
  });

  test('an impacted-measured (non-full-suite) anchor row also fires the trigger', async () => {
    const impactedPass: LeafGateResult = { ...PASS, impactedBase: { anchor: 'x'.repeat(40), ran: 3, candidates: 9 } };
    recordBaseGateVerdict({
      key: VKEY(), project: PROJECT, baseSha: TRUNK_SHA, status: 'pass',
      resultJson: JSON.stringify(impactedPass), quarantineHash: Q_HASH,
    });
    const fired: string[] = [];
    const plan = await planImpactedBaseGate('/epic-wt', CFG, consumerOpts({
      ensureAnchor: (p) => { fired.push(p); },
    }));
    expect(plan.mode).toBe('full');
    expect(fired).toEqual([PROJECT]);
  });

  test('with a full-suite anchor present the trigger does NOT fire', async () => {
    recordBaseGateVerdict({
      key: VKEY(), project: PROJECT, baseSha: TRUNK_SHA, status: 'pass',
      resultJson: JSON.stringify(PASS), quarantineHash: Q_HASH,
    });
    const fired: string[] = [];
    const plan = await planImpactedBaseGate('/epic-wt', CFG, consumerOpts({
      ensureAnchor: (p) => { fired.push(p); },
    }));
    expect(plan.mode).toBe('impacted');
    expect(fired).toEqual([]);
  });
});

describe('degraded inputs never throw', () => {
  test('no declared gate → clean refusal', async () => {
    const r = await ensureTrunkAnchor(PROJECT, anchorOpts({
      gateDecl: () => ({ kind: 'absent', manifestPath: '/x', reason: 'none' }),
    }));
    expect(r.ran).toBe(false);
    expect(r.anchored).toBe(false);
  });

  test('unresolvable trunk sha → clean refusal', async () => {
    const r = await ensureTrunkAnchor(PROJECT, anchorOpts({
      runGit: async () => ({ code: 1, stdout: '' }),
    }));
    expect(r.ran).toBe(false);
    expect(r.anchored).toBe(false);
    expect(r.reason).toContain('cannot resolve trunk sha');
  });

  test('worktree setup failure → clean refusal, nothing stored', async () => {
    const r = await ensureTrunkAnchor(PROJECT, anchorOpts({ makeWorktree: async () => null }));
    expect(r.ran).toBe(false);
    expect(r.anchored).toBe(false);
    expect(getBaseGateVerdict(VKEY())).toBeNull();
  });
});

describe('defaultMakeTrunkWorktree', () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  }

  /** Committed repo WITH a desktop/ subdir (so the detached checkout has a target dir to
   *  symlink into) and real, UNTRACKED node_modules at both the root and desktop/. */
  function makeSubdirRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'trunk-anchor-subdir-repo-'));
    git(dir, 'init', '-q', '-b', 'master');
    git(dir, 'config', 'user.email', 't@t.t');
    git(dir, 'config', 'user.name', 't');
    writeFileSync(join(dir, 'root.txt'), 'root\n');
    mkdirSync(join(dir, 'desktop'), { recursive: true });
    writeFileSync(join(dir, 'desktop', 'package.json'), '{}\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    mkdirSync(join(dir, 'desktop', 'node_modules'), { recursive: true });
    return dir;
  }

  let repoDir: string;
  let result: { path: string; cleanup: () => Promise<void> } | null = null;

  afterEach(async () => {
    if (result) { await result.cleanup(); result = null; }
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  });

  test('symlinks node_modules for every direct subdirectory that has one, even with no declared desktop lane cwd', async () => {
    repoDir = makeSubdirRepo();
    const headSha = git(repoDir, 'rev-parse', 'HEAD');
    const cfg: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      suites: [{ match: /^src\//, command: 'x' }],
    };
    result = await defaultMakeTrunkWorktree(repoDir, headSha, cfg, defaultGitRunner);
    expect(result).not.toBeNull();
    expect(existsSync(join(result!.path, 'desktop', 'node_modules'))).toBe(true);
    expect(existsSync(join(result!.path, 'node_modules'))).toBe(true);
  });
});
