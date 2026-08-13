/**
 * Durable SHARED base-gate verdict (base_gate_verdict + the coalescer's consult layer):
 * sibling epics forward-integrated to the same base sha consume ONE measurement. A PASS is
 * reusable indefinitely while the key matches; a FAIL only within a bounded budget
 * (2 consumers / 15 min), after which ONE re-measure runs — a flake-red has nothing to
 * commit, so without the budget it would pin every sibling forever.
 *
 * Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import {
  runBaseGateShared, baseGateKey, quarantineSetHash, sharedVerdictKey, resetBaseGateCoalescer,
  BASE_GATE_FAIL_VERDICT_SERVE_BUDGET, BASE_GATE_FAIL_VERDICT_TTL_MS, type SharedVerdictScope,
} from '../base-gate-coalescer';
import {
  recordBaseGateVerdict, getBaseGateVerdict, takeBaseGateFailServe, deleteBaseGateVerdictsForBase,
  recordEpicBaseGate, getEpicBaseGate, _closeLedgerDb,
} from '../worker-ledger';
import { resolveBaseGreen, type LeafGateConfig, type LeafGateResult } from '../leaf-gate';
import { handleEpicTool } from '../../mcp/epic-tools';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

let dir: string;

const CFG: LeafGateConfig = { baseTest: 'bun run base-test' };

const PASS: LeafGateResult = { status: 'pass', output: '', reasons: [], declared: true, baselineFailures: {} };
const FAIL: LeafGateResult = {
  status: 'fail', command: 'bun run base-test', output: 'FAIL src/x.test.ts',
  reasons: ['base test failed: bun run base-test'], declared: true, baselineFailures: { baseTest: ['src/x.test.ts'] },
};

function scope(over: Partial<SharedVerdictScope> = {}): SharedVerdictScope {
  return { project: '/proj', baseSha: 'sha1', quarantineHash: quarantineSetHash([]), ...over };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shared-verdict-'));
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

describe('shared PASS verdict', () => {
  test("epic A's run persists a verdict; epic B with the same key consumes it with ZERO runner invocations", async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    let runs = 0;
    const r1 = await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope() });
    expect(runs).toBe(1);
    expect(r1.status).toBe('pass');

    // Epic B: same (project, baseSha, lanes, quarantine hash) — the key is epic-independent.
    const r2 = await runBaseGateShared(
      key,
      async () => { runs++; throw new Error('epic B must not spawn the suite'); },
      { project: '/proj', verdict: scope() },
    );
    expect(runs).toBe(1);
    expect(r2).toEqual(r1);
  });

  test('a stored PASS has no serve budget: many consumers, still zero further runs', async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    let runs = 0;
    await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope() });
    for (let i = 0; i < 5; i++) {
      const r = await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope() });
      expect(r.status).toBe('pass');
    }
    expect(runs).toBe(1);
  });

  test('no verdict scope ⇒ pure single-flight semantics, nothing stored, settled key re-runs', async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    let runs = 0;
    await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj' });
    await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj' });
    expect(runs).toBe(2);
    expect(getBaseGateVerdict(sharedVerdictKey(key, quarantineSetHash([])))).toBeNull();
  });

  test("an 'error' result is an incident, never persisted as a shared verdict", async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    const err: LeafGateResult = { status: 'error', output: '', reasons: ['gate could not run: x'], declared: true };
    let runs = 0;
    await runBaseGateShared(key, async () => { runs++; return err; }, { project: '/proj', verdict: scope() });
    expect(getBaseGateVerdict(sharedVerdictKey(key, quarantineSetHash([])))).toBeNull();
    await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope() });
    expect(runs).toBe(2);
  });
});

describe('quarantine-set hash in the key', () => {
  test('same base, different active quarantine set ⇒ fresh run (the hash IS the invalidation)', async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    let runs = 0;
    await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope() });
    expect(runs).toBe(1);

    const r = await runBaseGateShared(
      key,
      async () => { runs++; return PASS; },
      { project: '/proj', verdict: scope({ quarantineHash: quarantineSetHash(['src/flaky.test.ts']) }) },
    );
    expect(runs).toBe(2);
    expect(r.status).toBe('pass');
  });

  test('quarantineSetHash is order-insensitive and content-sensitive', () => {
    expect(quarantineSetHash(['b', 'a'])).toBe(quarantineSetHash(['a', 'b']));
    expect(quarantineSetHash(['a'])).not.toBe(quarantineSetHash(['a', 'b']));
    expect(quarantineSetHash([])).not.toBe(quarantineSetHash(['a']));
  });
});

describe('FAIL serve budget (2 consumers / 15 min, whichever first)', () => {
  test('a stored FAIL serves at most 2 consumers, then the next asker re-measures and the budget resets', async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    let t = 1_000_000;
    const now = () => t;
    const vkey = sharedVerdictKey(key, quarantineSetHash([]));
    let runs = 0;

    // Measuring run: red base.
    const r0 = await runBaseGateShared(key, async () => { runs++; return FAIL; }, { project: '/proj', verdict: scope({ now }) });
    expect(runs).toBe(1);
    expect(r0.status).toBe('fail');

    // Consumers 1 and 2 are served from storage.
    for (let i = 1; i <= BASE_GATE_FAIL_VERDICT_SERVE_BUDGET; i++) {
      const r = await runBaseGateShared(key, async () => { runs++; return FAIL; }, { project: '/proj', verdict: scope({ now }) });
      expect(runs).toBe(1);
      expect(r.status).toBe('fail');
      expect(getBaseGateVerdict(vkey)?.failServeCount).toBe(i);
    }

    // Consumer 3: budget exhausted ⇒ ONE re-measure. It comes back green this time (the
    // flake-red scenario) and the fresh write resets the serve budget.
    const r3 = await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope({ now }) });
    expect(runs).toBe(2);
    expect(r3.status).toBe('pass');
    const fresh = getBaseGateVerdict(vkey);
    expect(fresh?.status).toBe('pass');
    expect(fresh?.failServeCount).toBe(0);
  });

  test('a stored FAIL past the 15-minute TTL is never served, even with budget remaining', async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    let t = 1_000_000;
    const now = () => t;
    let runs = 0;

    await runBaseGateShared(key, async () => { runs++; return FAIL; }, { project: '/proj', verdict: scope({ now }) });
    expect(runs).toBe(1);

    t += BASE_GATE_FAIL_VERDICT_TTL_MS + 1;
    const r = await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope({ now }) });
    expect(runs).toBe(2);
    expect(r.status).toBe('pass');
  });
});

describe('ledger helpers (base_gate_verdict)', () => {
  test('record → get roundtrip, and a re-record resets failServeCount', () => {
    const ok = recordBaseGateVerdict({
      key: 'k1', project: '/p', baseSha: 'sha1', status: 'fail',
      resultJson: JSON.stringify(FAIL), quarantineHash: 'qh',
    }, 111);
    expect(ok).toBe(true);
    expect(takeBaseGateFailServe('k1', 2)).toBe(true);
    expect(getBaseGateVerdict('k1')?.failServeCount).toBe(1);

    // Fresh measurement over the same key ⇒ fresh budget.
    expect(recordBaseGateVerdict({
      key: 'k1', project: '/p', baseSha: 'sha1', status: 'fail',
      resultJson: JSON.stringify(FAIL), quarantineHash: 'qh',
    }, 222)).toBe(true);
    const row = getBaseGateVerdict('k1');
    expect(row?.measuredAt).toBe(222);
    expect(row?.failServeCount).toBe(0);
  });

  test('the write helper is best-effort but NOT silent: a schema mismatch returns false', () => {
    // Force a write first so the DB file and handle exist, then break the schema out from
    // under the cached handle — the exact silent-no-op failure mode this ledger has bitten
    // with before must surface as `false`, never as a believed write.
    expect(recordBaseGateVerdict({ key: 'k1', project: '/p', baseSha: 's', status: 'pass', resultJson: '{}', quarantineHash: 'q' })).toBe(true);
    new Database(join(dir, 'worker-ledger.db')).exec('DROP TABLE base_gate_verdict');
    expect(recordBaseGateVerdict({ key: 'k2', project: '/p', baseSha: 's', status: 'pass', resultJson: '{}', quarantineHash: 'q' })).toBe(false);
    expect(getBaseGateVerdict('k2')).toBeNull();
  });

  test('takeBaseGateFailServe is a CAS: exactly maxServes slots, none on a pass row or a miss', () => {
    recordBaseGateVerdict({ key: 'kf', project: '/p', baseSha: 's', status: 'fail', resultJson: JSON.stringify(FAIL), quarantineHash: 'q' });
    expect(takeBaseGateFailServe('kf', 2)).toBe(true);
    expect(takeBaseGateFailServe('kf', 2)).toBe(true);
    expect(takeBaseGateFailServe('kf', 2)).toBe(false);

    recordBaseGateVerdict({ key: 'kp', project: '/p', baseSha: 's', status: 'pass', resultJson: JSON.stringify(PASS), quarantineHash: 'q' });
    expect(takeBaseGateFailServe('kp', 2)).toBe(false);
    expect(takeBaseGateFailServe('missing', 2)).toBe(false);
  });

  test('deleteBaseGateVerdictsForBase clears every row at that sha and no others', () => {
    recordBaseGateVerdict({ key: 'a', project: '/p', baseSha: 'shaX', status: 'pass', resultJson: '{}', quarantineHash: 'q1' });
    recordBaseGateVerdict({ key: 'b', project: '/p', baseSha: 'shaX', status: 'fail', resultJson: '{}', quarantineHash: 'q2' });
    recordBaseGateVerdict({ key: 'c', project: '/p', baseSha: 'shaY', status: 'pass', resultJson: '{}', quarantineHash: 'q1' });
    expect(deleteBaseGateVerdictsForBase('shaX')).toBe(2);
    expect(getBaseGateVerdict('a')).toBeNull();
    expect(getBaseGateVerdict('b')).toBeNull();
    expect(getBaseGateVerdict('c')).not.toBeNull();
  });

  test('corrupt stored resultJson reads as a MISS at the consult site ⇒ re-measure', async () => {
    const key = baseGateKey('/proj', 'sha1', CFG);
    recordBaseGateVerdict({
      key: sharedVerdictKey(key, quarantineSetHash([])), project: '/proj', baseSha: 'sha1',
      status: 'pass', resultJson: '{"truncated', quarantineHash: quarantineSetHash([]),
    });
    let runs = 0;
    const r = await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope() });
    expect(runs).toBe(1);
    expect(r.status).toBe('pass');
  });
});

describe('invalidate_base_gate clears the shared layer too', () => {
  test('the verb deletes shared verdict rows for the cleared baseSha; the next asker re-measures', async () => {
    const epicId = 'epic-shared-inv';
    const baseSha = 'sha-inv';
    const key = baseGateKey('/proj', baseSha, CFG);
    const vkey = sharedVerdictKey(key, quarantineSetHash([]));

    recordEpicBaseGate({ epicId, project: dir, baseSha, status: 'fail', command: 'x', output: 'red' });
    recordBaseGateVerdict({ key: vkey, project: '/proj', baseSha, status: 'fail', resultJson: JSON.stringify(FAIL), quarantineHash: quarantineSetHash([]) });

    const res = await handleEpicTool('invalidate_base_gate', {
      project: dir, session: 's1', epicId, reason: 'false red',
    });
    const parsed = JSON.parse(res!);
    expect(parsed.ok).toBe(true);
    expect(parsed.clearedSharedVerdicts).toBe(1);
    expect(getEpicBaseGate(epicId, baseSha)).toBeNull();
    expect(getBaseGateVerdict(vkey)).toBeNull();

    let runs = 0;
    await runBaseGateShared(key, async () => { runs++; return PASS; }, { project: '/proj', verdict: scope({ baseSha }) });
    expect(runs).toBe(1);
  });
});

describe('resolveBaseGreen end-to-end (the per-epic layer keeps working)', () => {
  test('epic B consumes epic A measurement with zero runGate calls AND still writes its own epic_base_gate row', async () => {
    const targetProject = '/target-e2e';
    const sha = 'sha-e2e';
    const ensureEpicWorktree = async () => ({ path: '/tmp/x' });
    const now = () => 5_000_000;

    let runsA = 0;
    const rA = await resolveBaseGreen({
      epicId: 'epic-A', project: '/track', targetProject, epicBaseSha: sha, gateCfg: CFG,
      ensureEpicWorktree, runGate: async () => { runsA++; return PASS; }, now,
    });
    expect(runsA).toBe(1);
    expect(rA?.status).toBe('pass');

    let runsB = 0;
    const rB = await resolveBaseGreen({
      epicId: 'epic-B', project: '/track', targetProject, epicBaseSha: sha, gateCfg: CFG,
      ensureEpicWorktree, runGate: async () => { runsB++; return PASS; }, now,
    });
    expect(runsB).toBe(0); // ZERO suite spawns — the whole point
    expect(rB?.status).toBe('pass');

    // The per-epic bookkeeping layer is fed from the served verdict, unchanged.
    expect(getEpicBaseGate('epic-A', sha)?.status).toBe('pass');
    expect(getEpicBaseGate('epic-B', sha)?.status).toBe('pass');
  });
});
