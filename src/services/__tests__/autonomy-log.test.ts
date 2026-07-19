// Runs via `bun test` (deploySafetyGate transitively touches bun:sqlite via worker-ledger).
//
// B6 — the unified autonomous-mutation observability ring: record→read, project scoping,
// bounded eviction, and the FAIL-OPEN guarantee (a bad/throwing entry must never propagate
// into the mutation path that called the recorder).
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  recordAutonomousMutation,
  recentAutonomousMutations,
  _resetAutonomyLog,
  RING_CAP,
} from '../autonomy-log';
import { deploySafetyGate } from '../deploy-service';

beforeEach(() => {
  _resetAutonomyLog();
});

describe('recordAutonomousMutation / recentAutonomousMutations', () => {
  test('records then reads back the entry with actor + reason', () => {
    recordAutonomousMutation({ kind: 'terminal-deactivate', actor: 'self-heal', reason: 'terminal', project: 'P', detail: 't1', at: 100 });
    const all = recentAutonomousMutations();
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({ kind: 'terminal-deactivate', actor: 'self-heal', reason: 'terminal', project: 'P', detail: 't1' });
  });

  test('returns NEWEST-first', () => {
    recordAutonomousMutation({ kind: 'reserve-leaf', actor: 'a', reason: 'first', at: 1 });
    recordAutonomousMutation({ kind: 'reserve-leaf', actor: 'a', reason: 'second', at: 2 });
    const all = recentAutonomousMutations();
    expect(all.map((e) => e.reason)).toEqual(['second', 'first']);
  });

  test('project scoping: filters to the project, but global (no-project) entries always match', () => {
    recordAutonomousMutation({ kind: 'reserve-leaf', actor: 'a', reason: 'inA', project: 'A', at: 1 });
    recordAutonomousMutation({ kind: 'reserve-leaf', actor: 'a', reason: 'inB', project: 'B', at: 2 });
    recordAutonomousMutation({ kind: 'deploy-refusal', actor: 'deploy-gate', reason: 'global', at: 3 });

    const a = recentAutonomousMutations({ project: 'A' });
    expect(a.map((e) => e.reason).sort()).toEqual(['global', 'inA']);

    const b = recentAutonomousMutations({ project: 'B' });
    expect(b.map((e) => e.reason).sort()).toEqual(['global', 'inB']);

    // No scope → everything.
    expect(recentAutonomousMutations().length).toBe(3);
  });

  test('ring is BOUNDED at RING_CAP — recording past it evicts the OLDEST', () => {
    for (let i = 0; i < RING_CAP + 10; i++) {
      recordAutonomousMutation({ kind: 'reserve-leaf', actor: 'a', reason: `r${i}`, at: i });
    }
    const all = recentAutonomousMutations();
    expect(all.length).toBe(RING_CAP);
    // Newest-first: index 0 is the very last recorded; the oldest survivor is r10 (r0..r9 evicted).
    expect(all[0].reason).toBe(`r${RING_CAP + 9}`);
    expect(all[all.length - 1].reason).toBe('r10');
  });

  test('required fields: an entry missing actor or reason is DROPPED, never stored partial', () => {
    recordAutonomousMutation({ kind: 'reserve-leaf', actor: '', reason: 'x' } as never);
    recordAutonomousMutation({ kind: 'reserve-leaf', actor: 'a', reason: '' } as never);
    expect(recentAutonomousMutations().length).toBe(0);

    recordAutonomousMutation({ kind: 'reserve-leaf', actor: 'a', reason: 'ok' });
    expect(recentAutonomousMutations().length).toBe(1);
  });

  test('at defaults to now when omitted', () => {
    const before = Date.now();
    recordAutonomousMutation({ kind: 'reserve-leaf', actor: 'a', reason: 'r' });
    const [e] = recentAutonomousMutations();
    expect(e.at).toBeGreaterThanOrEqual(before);
  });
});

describe('FAIL-OPEN — the recorder never throws into its caller', () => {
  test('an entry whose field access THROWS is swallowed, not propagated', () => {
    // Simulate a caller-side landmine: reading `.reason` blows up. A naive recorder would
    // rethrow into the mutation path; ours must swallow it.
    const evil = {
      kind: 'reserve-leaf' as const,
      actor: 'a',
      get reason(): string { throw new Error('boom reading reason'); },
      at: 1,
    };
    expect(() => recordAutonomousMutation(evil as never)).not.toThrow();
    // And nothing partial was stored.
    expect(recentAutonomousMutations().length).toBe(0);
  });

  test('a conductor-pass-style caller survives even if it wraps a throwing read', () => {
    // Model the shipped call-site pattern: mutation happens, THEN we record inside try/catch.
    // Even a recorder that (hypothetically) threw must not break the mutation's return value.
    function conductorPassStyleMutation(): string {
      const result = 'mutated';
      try {
        // The real sites wrap the recorder exactly like this.
        recordAutonomousMutation({ kind: 'deploy-refusal', actor: 'deploy-gate', reason: 'epic-mid-land' });
      } catch { /* fail-open */ }
      return result;
    }
    expect(conductorPassStyleMutation()).toBe('mutated');
  });
});

describe('deploySafetyGate wiring', () => {
  test('a leaves-in-flight refusal records a deploy-refusal entry', () => {
    const res = deploySafetyGate(
      '/some/project',
      {
        reap: () => {},
        inflight: () => [{ leafId: 'leaf-1' }],
        tree: () => ({ resolved: true, match: true } as never),
        epicMidLand: () => false,
      },
    );
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe('leaves-in-flight');

    const entries = recentAutonomousMutations({ project: '/some/project' });
    const rec = entries.find((e) => e.kind === 'deploy-refusal');
    expect(rec).toBeTruthy();
    expect(rec!.actor).toBe('deploy-gate');
    expect(rec!.reason).toBe('leaves-in-flight');
  });

  test('an epic-mid-land refusal records a deploy-refusal entry', () => {
    const res = deploySafetyGate(
      '/proj2',
      {
        reap: () => {},
        inflight: () => [],
        tree: () => ({ resolved: true, match: true } as never),
        epicMidLand: () => true,
      },
      { force: true }, // skip the inflight check to reach the mid-land refusal
    );
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe('epic-mid-land');

    const rec = recentAutonomousMutations({ project: '/proj2' }).find((e) => e.kind === 'deploy-refusal');
    expect(rec).toBeTruthy();
    expect(rec!.reason).toBe('epic-mid-land');
  });
});
