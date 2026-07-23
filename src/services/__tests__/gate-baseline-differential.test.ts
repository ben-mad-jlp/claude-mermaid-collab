/**
 * Composed regression coverage for the three base-differential acceptance scenarios
 * (mission af97cb19). Unit-level coverage of `runLeafGate`'s baseline diff already
 * lives in `leaf-gate.test.ts:507`; this file proves the COMPOSED path — a real
 * `runBaseGate` result, round-tripped through JSON the same way the ledger persists
 * it (`worker-ledger.ts:806`), then fed into `runLeafGate` — plus the bounded-refund
 * seam that stops that same red base from looping the leaf forever.
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

describe('base-differential — composed runBaseGate → ledger round-trip → runLeafGate', () => {
  it('SCENARIO 1 — baseline-only: a leaf reproducing exactly the base\'s red spec files passes', async () => {
    const { spawn: baseSpawn } = stubSpawn({ 'bun test': { ran: true, code: 1, output: BASELINE_OUTPUT } });
    const baseResult = await runBaseGate('/wt', CFG, baseSpawn);
    expect(baseResult.status).toBe('fail');
    expect(baseResult.baselineFailures).toBeDefined();

    // The ledger round-trip: worker-ledger.ts:806 persists baselineFailures as JSON text
    // and safeParse's it back out on read.
    const roundTripped = JSON.parse(JSON.stringify(baseResult.baselineFailures));

    const { spawn: leafSpawn } = stubSpawn({ 'bun test': { ran: true, code: 1, output: BASELINE_OUTPUT } });
    const leafResult = await runLeafGate('/wt', CFG, ['src/one.test.ts'], leafSpawn, roundTripped);

    expect(leafResult.status).toBe('pass');
    expect(leafResult.baselineOnly).toBeDefined();
    for (const f of BASELINE_SPECS) expect(leafResult.baselineOnly).toContain(f);
    expect(leafResult.reasons).toEqual([]);
  });

  it('SCENARIO 2 — net-new: a leaf adding a NEW failing spec on top of the baseline fails, naming only the new one', async () => {
    const { spawn: baseSpawn } = stubSpawn({ 'bun test': { ran: true, code: 1, output: BASELINE_OUTPUT } });
    const baseResult = await runBaseGate('/wt', CFG, baseSpawn);
    const roundTripped = JSON.parse(JSON.stringify(baseResult.baselineFailures));

    const netNewOutput = `${BASELINE_OUTPUT}\nFAIL src/new_thing.test.ts`;
    const { spawn: leafSpawn } = stubSpawn({ 'bun test': { ran: true, code: 1, output: netNewOutput } });
    const leafResult = await runLeafGate('/wt', CFG, ['src/new_thing.test.ts'], leafSpawn, roundTripped);

    expect(leafResult.status).toBe('fail');
    const reasonText = leafResult.reasons.join('\n');
    expect(reasonText).toContain('src/new_thing.test.ts');
    for (const f of BASELINE_SPECS) expect(reasonText).not.toContain(f);
  });

  it('FAIL-CLOSED — a red lane whose output yields no extractable fingerprints never passes silently', async () => {
    const { spawn: baseSpawn } = stubSpawn({ 'bun test': { ran: true, code: 1, output: BASELINE_OUTPUT } });
    const baseResult = await runBaseGate('/wt', CFG, baseSpawn);
    const roundTripped = JSON.parse(JSON.stringify(baseResult.baselineFailures));

    const { spawn: leafSpawn } = stubSpawn({ 'bun test': { ran: true, code: 1, output: 'segmentation fault (core dumped)' } });
    const leafResult = await runLeafGate('/wt', CFG, ['src/one.test.ts'], leafSpawn, roundTripped);

    expect(leafResult.status).toBe('fail');
  });

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
