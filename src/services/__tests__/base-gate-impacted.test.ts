/**
 * Impacted-set EPIC BASE gate (base-gate-impacted.ts wired through runBaseGate +
 * runBaseGateShared): when trunk sha M reachable from base B carries a stored FULL-SUITE
 * green in the shared-verdict layer, the base gate runs only the impacted set of the diff
 * M..B; every uncertainty (no anchor, planner fallback trigger, impacted-measured anchor)
 * runs the full suite exactly as before. A PASS measured on an impacted subset is stored
 * WITH its marker and must never anchor a further impacted run (chain-blindness guard).
 *
 * Harness mirrors base-gate-shared-verdict.test.ts (real worker-ledger on a temp
 * MERMAID_SUPERVISOR_DIR, bun:sqlite) + land-gate-impacted-floor.test.ts (injected
 * spawn/git/planner). Runs via `bun test`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runBaseGateShared, baseGateKey, quarantineSetHash, sharedVerdictKey, resetBaseGateCoalescer,
} from '../base-gate-coalescer';
import { recordBaseGateVerdict, getBaseGateVerdict, _closeLedgerDb } from '../worker-ledger';
import {
  planImpactedBaseGate, narrowBaseGateConfig, isFullSuiteAnchorVerdict,
  type ImpactedBaseGateOpts,
} from '../base-gate-impacted';
import { runBaseGate, type GateSpawn, type LeafGateConfig, type LeafGateResult } from '../leaf-gate';
import type { FloorPlan } from '../impacted-tests';
import type { GitRunner } from '../trunk-ref';

const PROJECT = '/proj';
const TRUNK_SHA = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111'; // M
const BASE_SHA = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222'; // B
const SUITE_CMD = 'bun run scripts/test-backend.ts --baseline=scripts/backend-test-baseline.json';

const CFG: LeafGateConfig = {
  typecheck: 'npx tsc --noEmit',
  suites: [{ match: /^src\//, command: SUITE_CMD }],
};

const Q_HASH = quarantineSetHash([]);

/** Injected git: no origin/HEAD, no `main`, trunk = `master`; merge-base(B, master) = M. */
function mockGit(over: { diff?: string; mergeBase?: string } = {}): GitRunner {
  return async (_cwd, args) => {
    if (args[0] === 'symbolic-ref') return { code: 1, stdout: '' };
    if (args[0] === 'rev-parse' && args.includes('main')) return { code: 1, stdout: '' };
    if (args[0] === 'rev-parse' && args.includes('master')) return { code: 0, stdout: `${TRUNK_SHA}\n` };
    if (args[0] === 'merge-base') return { code: 0, stdout: `${over.mergeBase ?? TRUNK_SHA}\n` };
    if (args[0] === 'diff') return { code: 0, stdout: over.diff ?? 'src/services/foo.ts\n' };
    return { code: 1, stdout: '' };
  };
}

function passingSpawn(calls: string[]): GateSpawn {
  return async (_cwd, command) => {
    calls.push(command);
    return { ran: true, code: 0, output: 'OK' };
  };
}

const impactedPlanner = (tests: string[], candidateCount = 10) => (): FloorPlan =>
  ({ mode: 'impacted', tests, candidateCount, trigger: null });

function impactedOpts(over: Partial<ImpactedBaseGateOpts> = {}): ImpactedBaseGateOpts {
  return {
    project: PROJECT,
    baseSha: BASE_SHA,
    quarantineHash: Q_HASH,
    runGit: mockGit(),
    planner: impactedPlanner(['src/a.test.ts', 'src/b.test.ts']),
    ...over,
  };
}

/** Seed a FULL-SUITE green anchor row for trunk sha M under the current lane signature. */
function seedFullSuiteAnchor(): string {
  const key = sharedVerdictKey(baseGateKey(PROJECT, TRUNK_SHA, CFG), Q_HASH);
  const full: LeafGateResult = { status: 'pass', output: '', reasons: [], declared: true, baselineFailures: {} };
  expect(recordBaseGateVerdict({
    key, project: PROJECT, baseSha: TRUNK_SHA, status: 'pass',
    resultJson: JSON.stringify(full), quarantineHash: Q_HASH,
  })).toBe(true);
  return key;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'impacted-base-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
  resetBaseGateCoalescer();
});
afterEach(() => {
  _closeLedgerDb();
  resetBaseGateCoalescer();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('impacted base gate — green anchor + leaf-change diff', () => {
  test('suite lane carries --files= with only impacted files; verdict stored WITH the impacted marker', async () => {
    seedFullSuiteAnchor();
    const calls: string[] = [];
    const keyB = baseGateKey(PROJECT, BASE_SHA, CFG);
    const r = await runBaseGateShared(
      keyB,
      () => runBaseGate('/wt', CFG, passingSpawn(calls), undefined, undefined, impactedOpts()),
      { project: PROJECT, verdict: { project: PROJECT, baseSha: BASE_SHA, quarantineHash: Q_HASH } },
    );

    expect(r.status).toBe('pass');
    expect(calls).toContain('npx tsc --noEmit'); // typecheck lane untouched
    expect(calls).toContain(`${SUITE_CMD} --files=src/a.test.ts,src/b.test.ts`);
    expect(calls).not.toContain(SUITE_CMD); // never the unfiltered full suite
    expect(r.impactedBase).toEqual({ anchor: TRUNK_SHA, ran: 2, candidates: 10 });
    expect(r.reasons).toContain(`impacted base gate: ran 2 of 10 candidates (anchor ${TRUNK_SHA.slice(0, 8)})`);

    // The stored verdict for B is HONEST: it carries the impacted marker in resultJson.
    const stored = getBaseGateVerdict(sharedVerdictKey(keyB, Q_HASH));
    expect(stored?.status).toBe('pass');
    const parsed = JSON.parse(stored!.resultJson!) as LeafGateResult;
    expect(parsed.impactedBase).toEqual({ anchor: TRUNK_SHA, ran: 2, candidates: 10 });
    // ...and leaves MAY dispatch on it: the shared layer serves it as a normal PASS.
    let extraRuns = 0;
    const replay = await runBaseGateShared(
      keyB,
      async () => { extraRuns++; throw new Error('must be served from the stored verdict'); },
      { project: PROJECT, verdict: { project: PROJECT, baseSha: BASE_SHA, quarantineHash: Q_HASH } },
    );
    expect(extraRuns).toBe(0);
    expect(replay.status).toBe('pass');
  });

  test('an empty impacted set skips the capable suite lane entirely (typecheck still runs)', async () => {
    seedFullSuiteAnchor();
    const calls: string[] = [];
    const r = await runBaseGate('/wt', CFG, passingSpawn(calls), undefined, undefined,
      impactedOpts({ planner: impactedPlanner([], 10) }));
    expect(r.status).toBe('pass');
    expect(calls).toEqual(['npx tsc --noEmit']);
    expect(r.impactedBase).toEqual({ anchor: TRUNK_SHA, ran: 0, candidates: 10 });
  });
});

describe('impacted base gate — full-suite fallbacks', () => {
  test('no anchor for trunk ⇒ full suite, byte-identical declared command', async () => {
    const calls: string[] = [];
    const r = await runBaseGate('/wt', CFG, passingSpawn(calls), undefined, undefined, impactedOpts());
    expect(r.status).toBe('pass');
    expect(calls).toEqual(['npx tsc --noEmit', SUITE_CMD]);
    expect(r.impactedBase).toBeUndefined();
    expect(r.reasons.some((x) => x.includes('no green anchor for trunk'))).toBe(true);
  });

  test('anchor exists but an infra file in the diff triggers the REAL planner fallback ⇒ full suite', async () => {
    seedFullSuiteAnchor();
    const calls: string[] = [];
    // No injected planner: the real planImpactedFloor sees package.json in the diff and
    // fires its infra trigger — the SAME trigger set as the land gate, reused not re-implemented.
    const r = await runBaseGate('/wt', CFG, passingSpawn(calls), undefined, undefined,
      impactedOpts({ runGit: mockGit({ diff: 'package.json\nsrc/services/foo.ts\n' }), planner: undefined }));
    expect(r.status).toBe('pass');
    expect(calls).toEqual(['npx tsc --noEmit', SUITE_CMD]);
    expect(r.impactedBase).toBeUndefined();
    expect(r.reasons.some((x) => x.includes('infra path changed: package.json'))).toBe(true);
  });

  test('no lane command supports --files ⇒ full suite without any git probing', async () => {
    const cfg: LeafGateConfig = { typecheck: 'npx tsc --noEmit', baseTest: 'bun run other-runner' };
    const calls: string[] = [];
    const runGit: GitRunner = async () => { throw new Error('must not probe git'); };
    const r = await runBaseGate('/wt', cfg, passingSpawn(calls), undefined, undefined,
      impactedOpts({ runGit }));
    expect(r.status).toBe('pass');
    expect(calls).toEqual(['npx tsc --noEmit', 'bun run other-runner']);
    expect(r.reasons.some((x) => x.includes('no base lane command supports --files'))).toBe(true);
  });
});

describe('chain-blindness guard — impacted PASS is never an anchor', () => {
  test('a stored impacted PASS for B refuses anchor duty for a later base C', async () => {
    // Step 1: impacted run for B, anchored on a genuine full-suite green of M.
    seedFullSuiteAnchor();
    const keyB = baseGateKey(PROJECT, BASE_SHA, CFG);
    await runBaseGateShared(
      keyB,
      () => runBaseGate('/wt', CFG, passingSpawn([]), undefined, undefined, impactedOpts()),
      { project: PROJECT, verdict: { project: PROJECT, baseSha: BASE_SHA, quarantineHash: Q_HASH } },
    );
    const storedB = getBaseGateVerdict(sharedVerdictKey(keyB, Q_HASH));
    expect(storedB?.status).toBe('pass');
    expect(isFullSuiteAnchorVerdict(storedB!)).toBe(false); // the marker does its job

    // Step 2: a later base C whose merge-base resolves to B must NOT ride B's impacted
    // PASS as an anchor — impacted-on-impacted chains accumulate blind spots.
    const C_SHA = 'cccc3333cccc3333cccc3333cccc3333cccc3333';
    const plan = await planImpactedBaseGate('/wt', CFG, impactedOpts({
      baseSha: C_SHA,
      runGit: mockGit({ mergeBase: BASE_SHA }),
    }));
    expect(plan.mode).toBe('full');
    expect((plan as { reason: string }).reason).toContain('not a full-suite green');

    // And through the full gate: C runs the unfiltered suite.
    const calls: string[] = [];
    const r = await runBaseGate('/wt', CFG, passingSpawn(calls), undefined, undefined,
      impactedOpts({ baseSha: C_SHA, runGit: mockGit({ mergeBase: BASE_SHA }) }));
    expect(calls).toContain(SUITE_CMD);
    expect(calls.some((c) => c.includes('--files='))).toBe(false);
    expect(r.impactedBase).toBeUndefined();
  });

  test('a stored FAIL or a marker-less but corrupt resultJson also refuses anchor duty', async () => {
    const key = sharedVerdictKey(baseGateKey(PROJECT, TRUNK_SHA, CFG), Q_HASH);
    recordBaseGateVerdict({
      key, project: PROJECT, baseSha: TRUNK_SHA, status: 'pass',
      resultJson: '{corrupt', quarantineHash: Q_HASH,
    });
    const stored = getBaseGateVerdict(key)!;
    expect(isFullSuiteAnchorVerdict(stored)).toBe(false);
    const plan = await planImpactedBaseGate('/wt', CFG, impactedOpts());
    expect(plan.mode).toBe('full');
  });
});

describe('narrowBaseGateConfig', () => {
  test('narrows only --files-capable commands; drops capable lanes on an empty set', () => {
    const cfg: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      suites: [{ match: /^src\//, command: SUITE_CMD }, { match: /^ui\//, command: 'bun run ui-tests' }],
      baseTest: SUITE_CMD,
    };
    const narrowed = narrowBaseGateConfig(cfg, ['src/x.test.ts']);
    expect(narrowed.typecheck).toBe('npx tsc --noEmit');
    expect(narrowed.suites?.map((l) => l.command)).toEqual([
      `${SUITE_CMD} --files=src/x.test.ts`, 'bun run ui-tests',
    ]);
    expect(narrowed.baseTest).toBe(`${SUITE_CMD} --files=src/x.test.ts`);

    const empty = narrowBaseGateConfig(cfg, []);
    expect(empty.suites?.map((l) => l.command)).toEqual(['bun run ui-tests']);
    expect(empty.baseTest).toBeUndefined();
  });
});
