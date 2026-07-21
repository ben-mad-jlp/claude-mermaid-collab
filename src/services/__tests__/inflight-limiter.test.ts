import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import {
  reserveLeafSlot,
  releaseLeafSlot,
  inflightActive,
  reconcileInflight,
  maxWorkersTotal,
  totalWorkersActive,
  hasWorkerHeadroom,
  reportPoolSlotCount,
  _resetLeafSlots,
} from '../inflight-limiter';

// Deterministic caps regardless of local config.json / env drift.
process.env.MERMAID_MAX_INFLIGHT_GLOBAL = '4';
process.env.MERMAID_MAX_INFLIGHT_PROJECT = '2';

afterAll(() => {
  delete process.env.MERMAID_MAX_INFLIGHT_GLOBAL;
  delete process.env.MERMAID_MAX_INFLIGHT_PROJECT;
  delete process.env.MERMAID_MAX_WORKERS_TOTAL;
});

beforeEach(() => {
  _resetLeafSlots();
  delete process.env.MERMAID_MAX_WORKERS_TOTAL;
});

describe('reconcileInflight — FIX 1', () => {
  it('drift-up: a leaked release left the counter inflated with nothing really running — corrects down', () => {
    // Simulate a leak: reserve without ever releasing.
    reserveLeafSlot('/proj/a');
    reserveLeafSlot('/proj/a');
    expect(inflightActive()).toBe(2);
    expect(inflightActive('/proj/a')).toBe(2);

    const result = reconcileInflight({ global: 0, perProject: {} });

    expect(result.corrected).toBe(true);
    expect(result.before).toEqual({ global: 2, perProject: { '/proj/a': 2 } });
    expect(result.after).toEqual({ global: 0, perProject: {} });
    expect(inflightActive()).toBe(0);
    expect(inflightActive('/proj/a')).toBe(0);
  });

  it('drift-down: a restart reset the counters to 0 while leaves are still genuinely running — corrects up', () => {
    expect(inflightActive()).toBe(0);

    const result = reconcileInflight({ global: 3, perProject: { '/proj/a': 2, '/proj/b': 1 } });

    expect(result.corrected).toBe(true);
    expect(result.before).toEqual({ global: 0, perProject: {} });
    expect(result.after).toEqual({ global: 3, perProject: { '/proj/a': 2, '/proj/b': 1 } });
    expect(inflightActive()).toBe(3);
    expect(inflightActive('/proj/a')).toBe(2);
    expect(inflightActive('/proj/b')).toBe(1);
  });

  it('no-drift: observed truth matches the counters exactly — reports no-op', () => {
    reserveLeafSlot('/proj/a');
    const result = reconcileInflight({ global: 1, perProject: { '/proj/a': 1 } });

    expect(result.corrected).toBe(false);
    expect(result.before).toEqual(result.after);
    expect(inflightActive()).toBe(1);
  });

  it('reservation is still correctly enforced immediately after a reconcile', () => {
    // Observed truth says the project is already at its per-project cap (2).
    reconcileInflight({ global: 2, perProject: { '/proj/a': 2 } });

    // Per-project cap (2) is full ⇒ a new reservation for the SAME project must fail.
    expect(reserveLeafSlot('/proj/a')).toBe(false);
    expect(inflightActive('/proj/a')).toBe(2);

    // A different project still has global headroom (global cap 4, currently at 2).
    expect(reserveLeafSlot('/proj/b')).toBe(true);
    expect(inflightActive()).toBe(3);
  });
});

describe('machine-wide total-worker cap — FIX 2', () => {
  it('defaults to 12 and does not constrain a typical 4-leaf + 3-pool load', () => {
    expect(maxWorkersTotal()).toBe(12);
    reserveLeafSlot('/proj/a');
    reserveLeafSlot('/proj/b');
    reserveLeafSlot('/proj/c');
    reserveLeafSlot('/proj/d'); // 4 headless leaves (hits the global inflight cap too)
    reportPoolSlotCount(3); // 3 pool sessions
    expect(totalWorkersActive()).toBe(7);
    expect(hasWorkerHeadroom()).toBe(true);
  });

  it('combines both populations (headless in-flight + pool) when enforcing the cap', () => {
    process.env.MERMAID_MAX_WORKERS_TOTAL = '5';
    reportPoolSlotCount(4); // 4 pool workers already alive
    expect(totalWorkersActive()).toBe(4);
    expect(hasWorkerHeadroom()).toBe(true); // one more slot fits (4 < 5)

    expect(reserveLeafSlot('/proj/a')).toBe(true); // 4 pool + 1 headless = 5 = cap
    expect(totalWorkersActive()).toBe(5);

    // At the combined cap now — a second headless reservation must fail even though
    // the plain per-project/global inflight caps have headroom.
    expect(reserveLeafSlot('/proj/b')).toBe(false);
    expect(inflightActive()).toBe(1);
  });

  it('env override MERMAID_MAX_WORKERS_TOTAL is respected', () => {
    process.env.MERMAID_MAX_WORKERS_TOTAL = '2';
    expect(maxWorkersTotal()).toBe(2);
    expect(reserveLeafSlot('/proj/a')).toBe(true);
    expect(reserveLeafSlot('/proj/b')).toBe(true);
    // Combined total now at 2 = cap ⇒ refused, fail-closed.
    expect(reserveLeafSlot('/proj/c')).toBe(false);
  });

  it('releasing a slot frees total-worker headroom for a new reservation', () => {
    process.env.MERMAID_MAX_WORKERS_TOTAL = '1';
    expect(reserveLeafSlot('/proj/a')).toBe(true);
    expect(reserveLeafSlot('/proj/b')).toBe(false);
    releaseLeafSlot('/proj/a');
    expect(reserveLeafSlot('/proj/b')).toBe(true);
  });
});
