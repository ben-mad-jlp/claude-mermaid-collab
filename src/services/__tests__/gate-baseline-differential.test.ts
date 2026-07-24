/**
 * Composed regression coverage for the base-differential acceptance path
 * (mission af97cb19). Unit-level coverage of `runLeafGate`'s baseline diff already
 * lives in `leaf-gate.test.ts:507`; this file proves the COMPOSED path — a real
 * `runBaseGate` result, round-tripped through JSON the same way the ledger persists
 * it (`worker-ledger.ts:806`), then fed into `runLeafGate` — across all FOUR lane
 * kinds the gate supports (whole-tree `typecheck`, change-set-scoped `typechecks[]`,
 * change-set-triggered `suites[]`, and per-file `tests` via `resolveLaneBaseline`),
 * plus the bounded-refund seam that stops a persistently red base from looping the
 * leaf forever, and the executor-level arm that turns a red base into an epic-wide
 * hold rather than a leaf rejection.
 *
 * Replays the build123d f6dbf929 shape: a `suites` lane red at base with 7
 * pre-existing failing spec files, fingerprinted from real runner-shaped output
 * (`FAIL <path>` lines) so `extractFailingTests` derives them for real.
 */
import { describe, it, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBaseGate, runLeafGate, type GateSpawn, type LeafGateConfig } from '../leaf-gate';
import { MAX_BASE_MOVED_REFUNDS, MAX_REDISPATCH } from '../harness-caps';
import {
  createTodo, claimTodo, getTodo, bumpRetryCountIfOwned, refundBaseMovedRetryIfUnderCap, _closeProject,
} from '../todo-store';
import { runLeaf, type LeafExecutorDeps } from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

/** Builds a scripted GateSpawn: keyed by exact command string, records every call. */
function stubSpawn(script: Record<string, { ran: boolean; code?: number; output?: string }>) {
  const calls: Array<{ cwd: string; command: string }> = [];
  const spawn: GateSpawn = async (cwd, command) => {
    calls.push({ cwd, command });
    const s = script[command];
    if (!s) throw new Error(`unscripted command: ${command}`);
    return { ran: s.ran, code: s.code ?? 0, output: s.output ?? '' };
  };
  return { spawn, calls };
}

const BASELINE_SPECS = [
  'src/one.test.ts', 'src/two.test.ts', 'src/three.test.ts', 'src/four.test.ts',
  'src/five.test.ts', 'src/six.test.ts', 'src/seven.test.ts',
];
const BASELINE_OUTPUT = BASELINE_SPECS.map((f) => `FAIL ${f}`).join('\n');

const CFG: LeafGateConfig = {
  suites: [{ match: new RegExp('^src/'), command: 'bun test', cwd: undefined }],
};

// TS-diagnostic-shaped fixtures for the two typecheck lanes — parseTypecheckFiles
// (leaf-gate.ts:925) only matches `path(l,c): error TSxxxx` / `path:l:c - error TSxxxx`,
// not `FAIL <path>` lines.
const BASELINE_TS_FILES = ['src/a.ts', 'src/b.ts'];
const BASELINE_TS_OUTPUT = BASELINE_TS_FILES.map((f) => `${f}(3,1): error TS2304: x`).join('\n');
const NET_NEW_TS_OUTPUT = `${BASELINE_TS_OUTPUT}\nsrc/new_thing.ts(3,1): error TS2304: x`;
const TYPECHECKS_MATCH = /^src\//;

type SpawnScript = Record<string, { ran: boolean; code?: number; output?: string }>;

interface LaneScenario {
  changeSet: string[];
  script: SpawnScript;
}

interface LaneCase {
  /** Names the lane kind under test. */
  name: string;
  baseCfg: LeafGateConfig;
  leafCfg: LeafGateConfig;
  baseScript: SpawnScript;
  /** The `baselineFailures` key this lane's baseline is keyed under. */
  baseKey: string;
  /** True for the `tests` lane: its baseline is delivered via `resolveLaneBaseline`
   *  (runLeafGate's 6th arg), never via the `baselines` map (leaf-gate.ts:546,678). */
  useResolver?: boolean;
  scenarios: {
    baselineOnly: LaneScenario & { expectBaselineContains: string[] };
    netNew: LaneScenario & { newFingerprint: string; excludeFingerprints: string[] };
    failClosed: LaneScenario;
  };
}

const LANE_CASES: LaneCase[] = [
  {
    name: 'typecheck (whole tree)',
    baseCfg: { typecheck: 'npx tsc --noEmit' },
    leafCfg: { typecheck: 'npx tsc --noEmit' },
    baseScript: { 'npx tsc --noEmit': { ran: true, code: 1, output: BASELINE_TS_OUTPUT } },
    baseKey: 'typecheck',
    scenarios: {
      baselineOnly: {
        changeSet: ['src/a.ts'],
        script: { 'npx tsc --noEmit': { ran: true, code: 1, output: BASELINE_TS_OUTPUT } },
        expectBaselineContains: BASELINE_TS_FILES,
      },
      netNew: {
        changeSet: ['src/new_thing.ts'],
        script: { 'npx tsc --noEmit': { ran: true, code: 1, output: NET_NEW_TS_OUTPUT } },
        newFingerprint: 'src/new_thing.ts',
        excludeFingerprints: BASELINE_TS_FILES,
      },
      failClosed: {
        changeSet: ['src/a.ts'],
        script: { 'npx tsc --noEmit': { ran: true, code: 1, output: 'segmentation fault (core dumped)' } },
      },
    },
  },
  {
    name: 'typechecks[] (change-set-scoped)',
    baseCfg: { typechecks: [{ match: TYPECHECKS_MATCH, command: 'npx tsc --noEmit -p .', cwd: undefined }] },
    leafCfg: { typechecks: [{ match: TYPECHECKS_MATCH, command: 'npx tsc --noEmit -p .', cwd: undefined }] },
    baseScript: { 'npx tsc --noEmit -p .': { ran: true, code: 1, output: BASELINE_TS_OUTPUT } },
    baseKey: `typechecks:${TYPECHECKS_MATCH.source}`,
    scenarios: {
      baselineOnly: {
        changeSet: ['src/a.ts'],
        script: { 'npx tsc --noEmit -p .': { ran: true, code: 1, output: BASELINE_TS_OUTPUT } },
        expectBaselineContains: BASELINE_TS_FILES,
      },
      netNew: {
        changeSet: ['src/new_thing.ts'],
        script: { 'npx tsc --noEmit -p .': { ran: true, code: 1, output: NET_NEW_TS_OUTPUT } },
        newFingerprint: 'src/new_thing.ts',
        excludeFingerprints: BASELINE_TS_FILES,
      },
      failClosed: {
        changeSet: ['src/a.ts'],
        script: { 'npx tsc --noEmit -p .': { ran: true, code: 1, output: 'segmentation fault (core dumped)' } },
      },
    },
  },
  {
    name: 'suites[] (change-set-triggered full suite)',
    baseCfg: CFG,
    leafCfg: CFG,
    baseScript: { 'bun test': { ran: true, code: 1, output: BASELINE_OUTPUT } },
    baseKey: `suites:${CFG.suites![0].match.source}`,
    scenarios: {
      baselineOnly: {
        changeSet: ['src/one.test.ts'],
        script: { 'bun test': { ran: true, code: 1, output: BASELINE_OUTPUT } },
        expectBaselineContains: BASELINE_SPECS,
      },
      netNew: {
        changeSet: ['src/new_thing.test.ts'],
        script: { 'bun test': { ran: true, code: 1, output: `${BASELINE_OUTPUT}\nFAIL src/new_thing.test.ts` } },
        newFingerprint: 'src/new_thing.test.ts',
        excludeFingerprints: BASELINE_SPECS,
      },
      failClosed: {
        changeSet: ['src/one.test.ts'],
        script: { 'bun test': { ran: true, code: 1, output: 'segmentation fault (core dumped)' } },
      },
    },
  },
  {
    name: 'tests[] (per-file, resolveLaneBaseline)',
    baseCfg: { baseTest: 'bun test' },
    leafCfg: { tests: [{ match: /^src\//, command: 'bun test {file}', cwd: undefined, mode: 'per-file' }] },
    baseScript: { 'bun test': { ran: true, code: 1, output: BASELINE_OUTPUT } },
    baseKey: 'baseTest',
    useResolver: true,
    scenarios: {
      baselineOnly: {
        changeSet: ['src/one.test.ts', 'src/two.test.ts'],
        script: {
          "bun test 'src/one.test.ts'": { ran: true, code: 1, output: 'FAIL src/one.test.ts' },
          "bun test 'src/two.test.ts'": { ran: true, code: 1, output: 'FAIL src/two.test.ts' },
        },
        expectBaselineContains: ['src/one.test.ts', 'src/two.test.ts'],
      },
      netNew: {
        changeSet: ['src/new_thing.test.ts'],
        script: { "bun test 'src/new_thing.test.ts'": { ran: true, code: 1, output: 'FAIL src/new_thing.test.ts' } },
        newFingerprint: 'src/new_thing.test.ts',
        excludeFingerprints: BASELINE_SPECS,
      },
      failClosed: {
        changeSet: ['src/one.test.ts'],
        script: { "bun test 'src/one.test.ts'": { ran: true, code: 1, output: 'segmentation fault (core dumped)' } },
      },
    },
  },
];

describe('base-differential — composed runBaseGate → ledger round-trip → runLeafGate', () => {
  for (const c of LANE_CASES) {
    describe(c.name, () => {
      it('SCENARIO 1 — baseline-only: a leaf reproducing exactly the base\'s red fingerprints passes', async () => {
        const { spawn: baseSpawn } = stubSpawn(c.baseScript);
        const baseResult = await runBaseGate('/wt', c.baseCfg, baseSpawn);
        expect(baseResult.status).toBe('fail');
        expect(baseResult.baselineFailures).toBeDefined();

        const roundTripped = JSON.parse(JSON.stringify(baseResult.baselineFailures));

        const { changeSet, script, expectBaselineContains } = c.scenarios.baselineOnly;
        const { spawn: leafSpawn } = stubSpawn(script);
        const baselines = c.useResolver ? undefined : roundTripped;
        const resolveLaneBaseline = c.useResolver
          ? async () => roundTripped[c.baseKey] ?? null
          : undefined;
        const leafResult = await runLeafGate('/wt', c.leafCfg, changeSet, leafSpawn, baselines, resolveLaneBaseline);

        expect(leafResult.status).toBe('pass');
        expect(leafResult.baselineOnly).toBeDefined();
        for (const f of expectBaselineContains) expect(leafResult.baselineOnly).toContain(f);
        expect(leafResult.reasons).toEqual([]);
      });

      it('SCENARIO 2 — net-new: a leaf adding a NEW failing fingerprint on top of the baseline fails, naming only the new one', async () => {
        const { spawn: baseSpawn } = stubSpawn(c.baseScript);
        const baseResult = await runBaseGate('/wt', c.baseCfg, baseSpawn);
        const roundTripped = JSON.parse(JSON.stringify(baseResult.baselineFailures));

        const { changeSet, script, newFingerprint, excludeFingerprints } = c.scenarios.netNew;
        const { spawn: leafSpawn } = stubSpawn(script);
        const baselines = c.useResolver ? undefined : roundTripped;
        const resolveLaneBaseline = c.useResolver
          ? async () => roundTripped[c.baseKey] ?? null
          : undefined;
        const leafResult = await runLeafGate('/wt', c.leafCfg, changeSet, leafSpawn, baselines, resolveLaneBaseline);

        expect(leafResult.status).toBe('fail');
        const reasonText = leafResult.reasons.join('\n');
        expect(reasonText).toContain(newFingerprint);
        for (const f of excludeFingerprints) expect(reasonText).not.toContain(f);
      });

      it('FAIL-CLOSED — a red lane whose output yields no extractable fingerprints never passes silently', async () => {
        const { spawn: baseSpawn } = stubSpawn(c.baseScript);
        const baseResult = await runBaseGate('/wt', c.baseCfg, baseSpawn);
        const roundTripped = JSON.parse(JSON.stringify(baseResult.baselineFailures));

        const { changeSet, script } = c.scenarios.failClosed;
        const { spawn: leafSpawn } = stubSpawn(script);
        const baselines = c.useResolver ? undefined : roundTripped;
        const resolveLaneBaseline = c.useResolver
          ? async () => roundTripped[c.baseKey] ?? null
          : undefined;
        const leafResult = await runLeafGate('/wt', c.leafCfg, changeSet, leafSpawn, baselines, resolveLaneBaseline);

        expect(leafResult.status).toBe('fail');
      });
    });
  }

  describe('SCENARIO 3 — bounded refund then redispatch cap', () => {
    let project: string;
    beforeEach(() => {
      project = mkdtempSync(join(tmpdir(), 'gate-baseline-differential-'));
      process.env.MERMAID_SUPERVISOR_DIR = project;
    });
    afterEach(() => {
      _closeProject(project);
      delete process.env.MERMAID_SUPERVISOR_DIR;
      rmSync(project, { recursive: true, force: true });
    });

    test('a persistently-red base grants exactly MAX_BASE_MOVED_REFUNDS refunds, then retryCount climbs to MAX_REDISPATCH', async () => {
      const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'x', status: 'ready' });
      const claim = await claimTodo(project, t.id, 'agent-1', 60_000);
      const claimToken = claim?.claim?.token;

      const dispatches = MAX_BASE_MOVED_REFUNDS + MAX_REDISPATCH;
      let granted = 0;
      for (let i = 0; i < dispatches; i++) {
        await bumpRetryCountIfOwned(project, t.id, claimToken); // dispatch-time bump
        const refunded = await refundBaseMovedRetryIfUnderCap(project, t.id, MAX_BASE_MOVED_REFUNDS, claimToken);
        if (refunded) granted++;
      }

      const final = getTodo(project, t.id)!;
      expect(granted).toBe(MAX_BASE_MOVED_REFUNDS);
      expect(final.baseMovedRefunds).toBe(MAX_BASE_MOVED_REFUNDS);
      expect(final.retryCount).toBeGreaterThanOrEqual(MAX_REDISPATCH);
    });
  });
});

/** Minimal LeafExecutorDeps whose base arm (leaf-executor.ts:2745-2767) runs before any
 *  node spawn — only the members that arm touches need real bodies. Not `makeDeps` from
 *  leaf-executor.test.ts (not exported); this is a compact local stand-in. */
function makeBaseArmDeps(): {
  deps: LeafExecutorDeps;
  invokeSpecs: NodeSpec[];
  escalations: Array<{ kind: string; questionText: string }>;
} {
  const invokeSpecs: NodeSpec[] = [];
  const escalations: Array<{ kind: string; questionText: string }> = [];
  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        invokeSpecs.push(spec);
        return { ok: true, exitCode: 0, stdout: '', durationMs: 1, rateLimited: false, authMode: 'subscription', text: '' };
      },
    },
    wm: {
      async ensure() {
        return { isGit: true, path: '/tmp/wt', branch: 'b', baseBranch: 'm' } as never;
      },
      async remove() { /* noop */ },
    } as never,
    epicId: 'epic-hold-test',
    epicBranch: 'collab/epic/hold-test',
    assertAuth: () => 'subscription',
    async complete() { return {}; },
    async mergeToEpic() { return {}; },
    escalate: (input) => { escalations.push({ kind: input.kind, questionText: input.questionText }); },
    recordNode: () => null as any,
    ensureBaseGreen: async () => ({
      status: 'fail',
      command: 'bun test',
      output: 'FAIL src/a.test.ts',
      reasons: ['suite lane failed: bun test'],
      declared: true,
      fresh: true,
      baselineFailures: { 'suites:^src\\/': ['src/a.test.ts'] },
    }),
  };
  return { deps, invokeSpecs, escalations };
}

describe('a red base lane surfaces as the epic-wide hold, not a leaf rejection', () => {
  it('blocks before any node spends, carrying epic-base-red, with no reject verdict', async () => {
    const { deps, invokeSpecs } = makeBaseArmDeps();
    const leaf = {
      id: 'leaf-hold-0001',
      title: 'hold-arm leaf',
      status: 'in_progress',
      sessionName: 'leaf-exec-hold-0001',
      type: null,
      kind: null,
    } as unknown as Todo;

    const res = await runLeaf('proj', leaf, deps);

    expect(res.outcome).toBe('blocked');
    expect(res.reason).toMatch(/^epic-base-red/);
    expect(res.nodesSpent).toBe(0);
    expect(invokeSpecs.length).toBe(0);
  });
});
