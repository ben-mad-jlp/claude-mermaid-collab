import { describe, it, expect } from 'bun:test';
import {
  selectBudgetTrips,
  DEFAULT_BUDGET_CONFIG,
  type LaneBudgetRow,
  type ConvergenceBudgetConfig,
} from '../convergence-breaker';

const NOW = 1_000_000_000_000;
function lane(p: Partial<LaneBudgetRow>): LaneBudgetRow {
  return { todoId: 't1', title: 'T1', session: 's1', ...p };
}
const trips = (rows: LaneBudgetRow[], cfg: ConvergenceBudgetConfig = DEFAULT_BUDGET_CONFIG) =>
  selectBudgetTrips(rows, NOW, cfg);

describe('selectBudgetTrips (P1 budget caps)', () => {
  it('no telemetry → no trip', () => {
    expect(trips([lane({})])).toEqual([]);
  });

  it('under all caps → no trip', () => {
    expect(trips([lane({ iterations: 3, claimedAtMs: NOW - 60_000, tokensSpent: 100_000 })])).toEqual([]);
  });

  it('skips a lane with no session (not a real worker → reaper handles it)', () => {
    expect(trips([lane({ session: null, iterations: 999 })])).toEqual([]);
    expect(trips([lane({ session: undefined, iterations: 999 })])).toEqual([]);
  });

  it('HARD iteration cap trips alone', () => {
    const out = trips([lane({ iterations: 15 })]);
    expect(out.length).toBe(1);
    expect(out[0].tier).toBe('hard');
    expect(out[0].breaches).toEqual([{ cap: 'iterations', tier: 'hard', value: 15, limit: 15 }]);
  });

  it('SOFT iteration cap warns (not hard) between soft and hard', () => {
    const out = trips([lane({ iterations: 8 })]);
    expect(out.length).toBe(1);
    expect(out[0].tier).toBe('soft');
    expect(out[0].breaches[0]).toMatchObject({ cap: 'iterations', tier: 'soft' });
  });

  it('HARD wall-clock cap trips (computed from claimedAt + now)', () => {
    const out = trips([lane({ claimedAtMs: NOW - DEFAULT_BUDGET_CONFIG.wallClockMs.hard! })]);
    expect(out[0].tier).toBe('hard');
    expect(out[0].breaches[0].cap).toBe('wallClockMs');
  });

  it('HARD token cap trips', () => {
    const out = trips([lane({ tokensSpent: 4_000_000 })]);
    expect(out[0].tier).toBe('hard');
    expect(out[0].breaches[0].cap).toBe('tokens');
  });

  it('worst tier wins when multiple axes breach (soft iters + hard tokens → hard)', () => {
    const out = trips([lane({ iterations: 8, tokensSpent: 5_000_000 })]);
    expect(out[0].tier).toBe('hard');
    expect(out[0].breaches.map((b) => b.cap).sort()).toEqual(['iterations', 'tokens']);
  });

  it('a disabled tier (null) is ignored', () => {
    const cfg: ConvergenceBudgetConfig = {
      iterations: { soft: null, hard: null },
      wallClockMs: { soft: null, hard: null },
      tokens: { soft: null, hard: null },
    };
    expect(trips([lane({ iterations: 9999, tokensSpent: 9e9 })], cfg)).toEqual([]);
  });

  it('missing claimedAt → wall-clock axis skipped, others still evaluated', () => {
    const out = trips([lane({ claimedAtMs: NaN, iterations: 15 })]);
    expect(out[0].breaches.every((b) => b.cap !== 'wallClockMs')).toBe(true);
    expect(out[0].tier).toBe('hard');
  });

  it('reason string is human-readable for the escalation payload', () => {
    const out = trips([lane({ iterations: 15 })]);
    expect(out[0].reason).toContain('HARD cap');
    expect(out[0].reason).toContain('iterations 15 ≥ 15');
  });

  it('only breaching lanes are returned from a mixed set', () => {
    const out = trips([
      lane({ todoId: 'ok', iterations: 2 }),
      lane({ todoId: 'bad', iterations: 20 }),
    ]);
    expect(out.map((t) => t.todoId)).toEqual(['bad']);
  });
});
