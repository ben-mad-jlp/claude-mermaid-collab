/**
 * base_gate_verdict as the VERDICT SPINE across the base gate and the LAND gate
 * (audit item 1 / worst case O1): when an epic's tip sha carries a stored FULL-SUITE
 * PASS in the durable shared-verdict layer — e.g. tipSha == baseSha after all leaves
 * merged, so the base gate just greened the exact same tree — the land gate's
 * regression floor must consume that measurement instead of re-running the full suite.
 *
 * HEADLINE (O1 kill): verified to FAIL on master (343e335f) before the spine consult
 * landed — `runEpicLandGate` consulted only `epic_land_gate`, so the floor spawned the
 * full suite again at a tip the base gate had just measured green:
 *   "the O1 kill: ... floor is NOT spawned ..." failed with
 *   floorCalls = [FLOOR_CMD] (expected []) and floorMode 'full' (expected 'spine').
 *
 * Mirrors the harnesses of base-gate-shared-verdict.test.ts (real bun:sqlite ledger under
 * an isolated MERMAID_SUPERVISOR_DIR) and land-gate-impacted-floor.test.ts (mock git/spawn).
 * Runs via `bun test` (uses bun:sqlite).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runBaseGateShared, baseGateKey, quarantineSetHash, sharedVerdictKey, resetBaseGateCoalescer,
} from '../base-gate-coalescer';
import {
  recordBaseGateVerdict, getBaseGateVerdict, deleteBaseGateVerdictsForBase,
  recordEpicBaseGate, _closeLedgerDb,
} from '../worker-ledger';
import type { GateDeclaration, GateSpawn, LeafGateResult } from '../leaf-gate';
import { runEpicLandGate } from '../epic-land-gate';
import { planImpactedBaseGate, isFullSuiteAnchorVerdict } from '../base-gate-impacted';
import type { FloorPlan } from '../impacted-tests';
import { handleEpicTool } from '../../mcp/epic-tools';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

const FLOOR_CMD = 'bun run scripts/test-backend.ts --baseline=scripts/backend-test-baseline.json --lane=fast';
const PROJECT = '/spine-proj';
const TIP = 'abcdef1234567890abcdef1234567890abcdef12';
const TRUNK = 'c88912ae000000000000000000000000000000aa';

const cfg = {
  typecheck: 'npx tsc --noEmit',
  tests: [{ match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' as const }],
  floors: [{ match: new RegExp('^src/'), command: FLOOR_CMD }],
};

const decl: GateDeclaration = { kind: 'declared', cfg, manifestPath: '.collab/project.json' };

const PASS: LeafGateResult = { status: 'pass', output: '', reasons: [], declared: true, baselineFailures: {} };

const mockGit = (_cwd: string, args: string[]) => {
  if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, stdout: `${TIP}\n` };
  if (args[0] === 'rev-parse' && args[1] === 'master') return { code: 0, stdout: `${TRUNK}\n` };
  if (args[0] === 'merge-base') return { code: 0, stdout: `${TRUNK}\n` };
  if (args[0] === 'diff') return { code: 0, stdout: 'src/services/foo.ts\n' };
  if (args[0] === 'worktree') return { code: 0, stdout: '' };
  return { code: 1, stdout: '' };
};

function spySpawn(calls: string[]): GateSpawn {
  return async (_cwd, command) => {
    calls.push(command);
    return { ran: true, code: 0, output: 'OK' };
  };
}

const fullPlanner = (): FloorPlan => ({ mode: 'full', candidateCount: 0, trigger: 'test: forced full' });

function landOpts(over: Record<string, unknown> = {}) {
  return {
    project: PROJECT,
    repo: PROJECT,
    epicId: `spine-epic-${crypto.randomUUID().slice(0, 8)}`,
    epicBranch: 'collab/epic/spine',
    epicWorktreeCwd: '/epic',
    decl,
    git: mockGit,
    fs: { exists: () => true, symlink: () => {} },
    quarantineLookup: () => [],
    floorPlanner: fullPlanner,
    ...over,
  };
}

/** The exact key the BASE gate's write path uses for (PROJECT, TIP, decl.cfg, empty set). */
function tipSpineKey(): string {
  return sharedVerdictKey(baseGateKey(PROJECT, TIP, cfg), quarantineSetHash([]));
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verdict-spine-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
  resetBaseGateCoalescer();
});
afterEach(() => {
  _closeLedgerDb();
  _closeSupervisorDb();
  resetBaseGateCoalescer();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('O1 kill — land gate consumes a base-gate full-suite PASS at the epic tip', () => {
  test('base-gate PASS at sha X, then runEpicLandGate with epicTipSha=X: floor is NOT spawned, result pass, floorMode spine', async () => {
    // The BASE gate measures the tree at TIP green, via its real write path.
    const key = baseGateKey(PROJECT, TIP, cfg);
    await runBaseGateShared(key, async () => PASS, {
      project: PROJECT,
      verdict: { project: PROJECT, baseSha: TIP, quarantineHash: quarantineSetHash([]) },
    });
    expect(getBaseGateVerdict(tipSpineKey())?.status).toBe('pass');

    // The LAND gate at the same tip: the floor must be spine-consumed, not re-run.
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls) }) as any);

    const floorCalls = spawnCalls.filter((c) => c.includes('test-backend'));
    expect(floorCalls).toEqual([]); // full suite NOT spawned — the O1 kill
    expect(r.status).toBe('pass');
    expect(r.floorMode).toBe('spine');
    // The reasons line names the consumed verdict's measuredAt and sha.
    expect(r.reasons.some((x) => x.includes('verdict spine') && x.includes(TIP.slice(0, 8)))).toBe(true);
  });

  test('key-parity: the base-gate write path and the land-gate read path produce byte-identical keys for one cfg', async () => {
    const readKeys: string[] = [];
    await runEpicLandGate(landOpts({
      spawn: spySpawn([]),
      verdictStore: {
        get: (k: string) => { readKeys.push(k); return null; },
        record: () => true,
      },
    }) as any);
    expect(readKeys.length).toBeGreaterThan(0);
    expect(readKeys[0]).toBe(tipSpineKey()); // byte-identical to the write path's key
  });

  test('a stored FAIL at the tip is NOT consumed — the floor still runs', async () => {
    recordBaseGateVerdict({
      key: tipSpineKey(), project: PROJECT, baseSha: TIP, status: 'fail',
      resultJson: JSON.stringify({ ...PASS, status: 'fail' }), quarantineHash: quarantineSetHash([]),
    });
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls) }) as any);
    expect(spawnCalls.filter((c) => c.includes('test-backend')).length).toBe(1);
    expect(r.floorMode).toBe('full');
  });

  test('quarantine-hash mismatch ⇒ key miss ⇒ the floor runs', async () => {
    recordBaseGateVerdict({
      key: sharedVerdictKey(baseGateKey(PROJECT, TIP, cfg), quarantineSetHash(['src/other-flaky.test.ts'])),
      project: PROJECT, baseSha: TIP, status: 'pass',
      resultJson: JSON.stringify(PASS), quarantineHash: quarantineSetHash(['src/other-flaky.test.ts']),
    });
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls) }) as any);
    expect(spawnCalls.filter((c) => c.includes('test-backend')).length).toBe(1);
    expect(r.floorMode).toBe('full');
  });

  test('an impacted-measured PASS at the tip cannot feed the spine consult (not a full-suite proof)', async () => {
    recordBaseGateVerdict({
      key: tipSpineKey(), project: PROJECT, baseSha: TIP, status: 'pass',
      resultJson: JSON.stringify({ ...PASS, impactedBase: { anchor: TRUNK, ran: 3, candidates: 10 } }),
      quarantineHash: quarantineSetHash([]),
    });
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls) }) as any);
    expect(spawnCalls.filter((c) => c.includes('test-backend')).length).toBe(1);
    expect(r.floorMode).toBe('full');
  });
});

describe('land gate FEEDS the spine', () => {
  test('a full-suite floor PASS persists a spine row that planImpactedBaseGate can anchor on', async () => {
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls) }) as any);
    expect(r.status).toBe('pass');
    expect(r.floorMode).toBe('full');
    expect(spawnCalls.filter((c) => c.includes('test-backend')).length).toBe(1);

    const row = getBaseGateVerdict(tipSpineKey());
    expect(row?.status).toBe('pass');
    expect(row?.baseSha).toBe(TIP);
    expect(row && isFullSuiteAnchorVerdict(row)).toBe(true); // anchor-eligible

    // A later BASE gate for a child of TIP anchors its impacted plan on this row.
    const plan = await planImpactedBaseGate('/epic', cfg, {
      project: PROJECT,
      baseSha: 'baby1234000000000000000000000000000000bb',
      quarantineHash: quarantineSetHash([]),
      runGit: async (_cwd: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args.includes('--verify')) return { code: 0, stdout: 'master' };
        if (args[0] === 'merge-base') return { code: 0, stdout: TIP };
        if (args[0] === 'diff') return { code: 0, stdout: 'src/services/foo.ts\n' };
        return { code: 1, stdout: '' };
      },
      planner: () => ({ mode: 'impacted', tests: ['src/x.test.ts'], candidateCount: 5, trigger: null }),
      ensureAnchor: () => {},
    });
    expect(plan.mode).toBe('impacted');
    if (plan.mode === 'impacted') expect(plan.anchor).toBe(TIP);
  });

  test('an impacted floor PASS is NOT persisted to the spine (would poison anchor duty)', async () => {
    const planner = (): FloorPlan => ({ mode: 'impacted', tests: ['src/x.test.ts'], candidateCount: 9, trigger: null });
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn([]), floorPlanner: planner }) as any);
    expect(r.status).toBe('pass');
    expect(r.floorMode).toBe('impacted');
    expect(getBaseGateVerdict(tipSpineKey())).toBeNull();
  });

  test('a second land at the same tip consumes the first land\'s spine write', async () => {
    await runEpicLandGate(landOpts({ spawn: spySpawn([]) }) as any);
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls) }) as any);
    expect(spawnCalls.filter((c) => c.includes('test-backend'))).toEqual([]);
    expect(r.floorMode).toBe('spine');
  });

  test('skipCache bypasses the spine consult — an explicit fresh measure really re-runs', async () => {
    await runEpicLandGate(landOpts({ spawn: spySpawn([]) }) as any); // seeds a spine PASS at TIP
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls), skipCache: true }) as any);
    expect(spawnCalls.filter((c) => c.includes('test-backend')).length).toBe(1);
    expect(r.floorMode).toBe('full');
  });

  test('a HUMAN actor still consumes a spine PASS (a measurement, not a stale verdict)', async () => {
    await runEpicLandGate(landOpts({ spawn: spySpawn([]) }) as any);
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls), actor: { kind: 'human' } }) as any);
    expect(spawnCalls.filter((c) => c.includes('test-backend'))).toEqual([]);
    expect(r.floorMode).toBe('spine');
  });
});

describe('invalidation reaches land-gate-written spine rows', () => {
  test('deleteBaseGateVerdictsForBase(tipSha) clears a row the LAND gate wrote', async () => {
    await runEpicLandGate(landOpts({ spawn: spySpawn([]) }) as any);
    expect(getBaseGateVerdict(tipSpineKey())?.status).toBe('pass');
    expect(deleteBaseGateVerdictsForBase(TIP)).toBe(1);
    expect(getBaseGateVerdict(tipSpineKey())).toBeNull();
  });

  test('the invalidate_base_gate verb clears a land-gate-written verdict at that sha', async () => {
    const epicId = 'spine-inv-epic';
    await runEpicLandGate(landOpts({ spawn: spySpawn([]), epicId }) as any);
    expect(getBaseGateVerdict(tipSpineKey())?.status).toBe('pass');

    // The verb resolves the sha to clear from the epic's base-gate bookkeeping row.
    recordEpicBaseGate({ epicId, project: dir, baseSha: TIP, status: 'fail', command: 'x', output: 'red' });
    const res = await handleEpicTool('invalidate_base_gate', {
      project: dir, session: 's1', epicId, reason: 'spine invalidation pin',
    });
    const parsed = JSON.parse(res!);
    expect(parsed.ok).toBe(true);
    expect(parsed.clearedSharedVerdicts).toBe(1);
    expect(getBaseGateVerdict(tipSpineKey())).toBeNull();
  });
});
