/**
 * Unit tests for the poison-probe guard wired into runBaseGate (leaf-gate.ts).
 * No real spawn/git — GateSpawn and the checkout.probe/restore deps are stubs. No live
 * worktree/git is touched.
 *
 * MUTATION-PROBE CLAIM (case 5, prose only — no separate runtime assertion beyond 1/2):
 * deleting the guard block from runBaseGate (the `if (checkout) { ... }` block inserted
 * right after the `if (!cfg) return ...` abstention) turns cases 1 and 2 below from
 * `status:'error'` into `status:'fail'`: the scripted spawn (which would exit 1 if called)
 * DOES get called and its RAN-but-failed result becomes the reported status. This was
 * verified by manually reverting the guard block during implementation, not merely
 * asserted here — observed before/after: WITH the guard, `calls.length === 0` and
 * `result.status === 'error'`; with the guard reverted/removed, `calls.length === 1` and
 * `result.status === 'fail'` (the stubbed lane runs and reports its scripted failure).
 */
import { describe, it, expect } from 'bun:test';
import { runBaseGate, isCacheableBaseGateStatus, type GateSpawn, type LeafGateConfig } from '../leaf-gate';
import { parsePoisonedStatus, type PoisonedCheckout } from '../checkout-poison-guard.js';

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

const CFG: LeafGateConfig = { typecheck: 'tsc' };

describe('runBaseGate — poison-probe guard', () => {
  it('staged-revert case: poisoned + no restore dep ⇒ error, spawn never called', async () => {
    const { spawn, calls } = stubSpawn({ tsc: { ran: true, code: 1, output: 'boom' } });
    const probed: PoisonedCheckout = { poisoned: true, paths: ['src/a.ts'], detail: ['modified'] };
    const result = await runBaseGate('/wt', CFG, spawn, undefined, {
      probe: async () => probed,
    });
    expect(calls.length).toBe(0);
    expect(result.status).toBe('error');
    expect(result.reasons[0]).toBe('poisoned-checkout');
    expect(result.baselineFailures).toBeUndefined();
  });

  it('staged-deletion case: parsePoisonedStatus feeds the probe ⇒ error, spawn never called', async () => {
    const { spawn, calls } = stubSpawn({ tsc: { ran: true, code: 1, output: 'boom' } });
    const { paths, kinds } = parsePoisonedStatus('D  src/a.ts');
    const probed: PoisonedCheckout = { poisoned: true, paths, detail: kinds };
    const result = await runBaseGate('/wt', CFG, spawn, undefined, {
      probe: async () => probed,
    });
    expect(calls.length).toBe(0);
    expect(result.status).toBe('error');
    expect(result.reasons[0]).toBe('poisoned-checkout');
    expect(result.baselineFailures).toBeUndefined();
  });

  it('restore case: poisoned then restored and re-probed clean ⇒ lanes run, pass, restored reported', async () => {
    const { spawn, calls } = stubSpawn({ tsc: { ran: true, code: 0 } });
    let probeCalls = 0;
    const probe = async (): Promise<PoisonedCheckout> => {
      probeCalls += 1;
      return probeCalls === 1
        ? { poisoned: true, paths: ['src/a.ts'], detail: ['modified'] }
        : { poisoned: false, paths: [], detail: [] };
    };
    const restore = async (_cwd: string, paths: string[]) => ({ restored: [...paths], failed: [] });
    const result = await runBaseGate('/wt', CFG, spawn, undefined, { probe, restore });
    expect(calls.length).toBeGreaterThan(0);
    expect(result.status).toBe('pass');
    expect(result.poisonedCheckout?.restored).toContain('src/a.ts');
  });

  it('a poisoned-checkout error result is never cacheable', async () => {
    const { spawn } = stubSpawn({ tsc: { ran: true, code: 1, output: 'boom' } });
    const probed: PoisonedCheckout = { poisoned: true, paths: ['src/a.ts'], detail: ['modified'] };
    const result = await runBaseGate('/wt', CFG, spawn, undefined, {
      probe: async () => probed,
    });
    expect(isCacheableBaseGateStatus(result.status)).toBe(false);
  });

  it('clean-tree no-op: with vs. without a checkout dep produces the same status/baselineFailures', async () => {
    const { spawn: spawnA } = stubSpawn({ tsc: { ran: true, code: 0 } });
    const resultNoDep = await runBaseGate('/wt', CFG, spawnA);

    const { spawn: spawnB } = stubSpawn({ tsc: { ran: true, code: 0 } });
    const cleanProbe = async (): Promise<PoisonedCheckout> => ({ poisoned: false, paths: [], detail: [] });
    const resultWithDep = await runBaseGate('/wt', CFG, spawnB, undefined, { probe: cleanProbe });

    expect(resultWithDep.status).toBe(resultNoDep.status);
    expect(resultWithDep.baselineFailures).toEqual(resultNoDep.baselineFailures);
  });
});
