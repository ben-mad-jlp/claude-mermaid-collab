/**
 * land-gate-invalidate.test.ts — pin the invalidation round-trip of the land-gate verdict spine
 *
 * Tests that the invalidate_base_gate verb properly clears cached verdicts in both the
 * per-epic (epic_base_gate) and shared (base_gate_verdict) layers, forcing a re-measure on
 * the next land attempt. Also verifies that the verb is properly advertised in the MCP tool list.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runBaseGateShared, baseGateKey, quarantineSetHash, sharedVerdictKey, resetBaseGateCoalescer,
} from '../base-gate-coalescer';
import {
  recordBaseGateVerdict, getBaseGateVerdict,
  recordEpicBaseGate, _closeLedgerDb,
} from '../worker-ledger';
import type { GateDeclaration, GateSpawn, LeafGateResult } from '../leaf-gate';
import { runEpicLandGate } from '../epic-land-gate';
import { handleEpicTool } from '../../mcp/epic-tools';
import { EPIC_TOOL_DEFS } from '../../mcp/epic-tools';
import { ADVERTISED_ORDER } from '../../mcp/advertised-tools';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

const FLOOR_CMD = 'bun run scripts/test-backend.ts --baseline=scripts/backend-test-baseline.json --lane=fast';
const PROJECT = '/invalidate-proj';
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

const fullPlanner = () => ({ mode: 'full' as const, candidateCount: 0, trigger: 'test: forced full' });

function landOpts(over: Record<string, unknown> = {}) {
  return {
    project: PROJECT,
    repo: PROJECT,
    epicId: 'inv-round-trip-epic',
    epicBranch: 'collab/epic/inv',
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
  dir = mkdtempSync(join(tmpdir(), 'invalidate-'));
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

describe('land-gate verdict spine invalidation round-trip', () => {
  it('an invalidated land-gate verdict is re-measured on the next attempt', async () => {
    // 1. Seed the FAIL at the (epicId, TIP, TRUNK) triple with an explicit past clock.
    const seededAt = Date.now() - 60_000; // 60 seconds in the past, well within TTL
    recordBaseGateVerdict({
      key: tipSpineKey(),
      project: PROJECT,
      baseSha: TIP,
      status: 'fail',
      resultJson: JSON.stringify({ ...PASS, status: 'fail' }),
      quarantineHash: quarantineSetHash([]),
    }, seededAt);

    const seededRow = getBaseGateVerdict(tipSpineKey())!;
    expect(seededRow.status).toBe('fail');
    expect(seededRow.measuredAt).toBe(seededAt);

    // Record the per-epic bookkeeping row that the verb resolves the sha from
    recordEpicBaseGate({
      epicId: 'inv-round-trip-epic',
      project: dir,
      baseSha: TIP,
      status: 'fail',
      command: 'x',
      output: 'red',
    });

    // 2. Pre-invalidation read serves the cached fail with no floor spawn.
    const preCalls: string[] = [];
    const served = await runBaseGateShared(
      baseGateKey(PROJECT, TIP, cfg),
      async () => {
        preCalls.push(FLOOR_CMD);
        return { ...PASS, status: 'fail' };
      },
      {
        project: PROJECT,
        verdict: {
          project: PROJECT,
          baseSha: TIP,
          quarantineHash: quarantineSetHash([]),
        },
      },
    );
    expect(served.status).toBe('fail');
    expect(preCalls.filter((c) => c.includes('test-backend'))).toEqual([]);

    // Reset the coalescer so no in-flight entry survives
    resetBaseGateCoalescer();

    // 3. Invalidate the cached verdict
    const res = await handleEpicTool('invalidate_base_gate', {
      project: dir,
      session: 's1',
      epicId: 'inv-round-trip-epic',
      reason: 'invalidation round-trip pin',
    });

    const parsed = JSON.parse(res!);
    expect(parsed.ok).toBe(true);
    expect(parsed.clearedSharedVerdicts).toBe(1);
    expect(getBaseGateVerdict(tipSpineKey())).toBeNull();

    // 4. Next attempt re-measures
    const spawnCalls: string[] = [];
    const r = await runEpicLandGate(landOpts({ spawn: spySpawn(spawnCalls) }) as any);

    // Verify the floor spawned exactly once (test-backend, not typecheck)
    expect(spawnCalls.filter((c) => c.includes('test-backend')).length).toBe(1);
    expect(r.floorMode).toBe('full');

    // Verify a NEW row was written with strictly greater measuredAt
    const fresh = getBaseGateVerdict(tipSpineKey());
    expect(fresh).not.toBeNull();
    expect(fresh!.baseSha).toBe(TIP);
    expect(fresh!.status).toBe('pass');
    expect(fresh!.measuredAt).toBeGreaterThan(seededRow.measuredAt);
  });

  it('the MCP tool list advertises invalidate_base_gate with epicId addressing', async () => {
    // Verify the tool def exists with epicId in properties and required
    const def = (EPIC_TOOL_DEFS as any[]).find((d) => d?.name === 'invalidate_base_gate');
    expect(def).toBeDefined();
    expect('epicId' in def.inputSchema.properties).toBe(true);
    expect(def.inputSchema.required).toContain('epicId');

    // Verify it's advertised in ADVERTISED_ORDER
    expect(
      ADVERTISED_ORDER.some((e: any) => e.group === 'EPIC' && e.name === 'invalidate_base_gate'),
    ).toBe(true);
  });
});
