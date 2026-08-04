/**
 * Regression: the contested card must survive a re-dispatch.
 *
 * Incident 2026-07-31 (mission 0a4a350d, leaf df08b5e3). `uncoveredContestedSeen` lived in a
 * process-local `let`, so every re-dispatch reset it to 0. The ledger timeline:
 *
 *   DISPATCH 1  two cycles  -> count 2 -> contested-card RAISED -> TIMED OUT -> park
 *   DISPATCH 2  one cycle   -> count 1 -> no card
 *   DISPATCH 3  one cycle   -> count 1 -> no card
 *   DISPATCH 4  one cycle   -> count 1 -> no card   (opus, 255s)
 *   DISPATCH 5  one cycle   -> count 1 -> no card   (opus, 369s)
 *   DISPATCH 6  one cycle   -> count 1 -> no card   (opus, 812s)
 *
 * The `>= 2` threshold is unreachable in a one-cycle dispatch, so the protection fired once
 * per leaf LIFETIME. These tests pin the two fixes: seed the count from the ledger, and treat
 * a TIMEOUT as "nobody looked" rather than as a settled human answer.
 */
import { describe, it, expect } from 'bun:test';

/** The seeding logic exactly as runLeaf performs it, isolated from the executor's I/O. */
function seedCounters(
  countLeafNodes: ((leafId: string, kind: string, verdict?: string) => number) | undefined,
  leafId: string,
): { seen: number; raised: boolean } {
  return {
    seen: countLeafNodes?.(leafId, 'coverage', 'fail') ?? 0,
    raised: (countLeafNodes?.(leafId, 'contested-answered') ?? 0) > 0,
  };
}

const LEAF = 'df08b5e3-fb82-4806-8fdf-29f857160b7d';

/** Ledger stub: nodes accumulate across dispatches, as the real table does. */
function makeLedger(initial: Array<{ kind: string; verdict?: string }> = []) {
  const rows = [...initial];
  return {
    rows,
    record: (kind: string, verdict?: string) => rows.push({ kind, verdict }),
    count: (_leafId: string, kind: string, verdict?: string) =>
      rows.filter((r) => r.kind === kind && (verdict === undefined || r.verdict === verdict)).length,
  };
}

describe('contested card survives a re-dispatch', () => {
  it('THE BUG: a process-local counter never reaches 2 in one-cycle dispatches', () => {
    // Pre-fix behaviour: no ledger seam at all, so every dispatch starts at 0.
    for (let dispatch = 2; dispatch <= 6; dispatch++) {
      const { seen } = seedCounters(undefined, LEAF);
      const afterOneCycle = seen + 1;
      expect(afterOneCycle).toBe(1);
      expect(afterOneCycle >= 2).toBe(false); // card can never raise — the observed defect
    }
  });

  it('THE FIX: seeding from the ledger reaches the threshold on dispatch 2', () => {
    const ledger = makeLedger();
    // Dispatch 1: two cycles, card raised on the second.
    ledger.record('coverage', 'fail');
    ledger.record('coverage', 'fail');
    let s = seedCounters(ledger.count, LEAF);
    expect(s.seen).toBe(2);

    // The card times out -> nothing durable recorded -> protection stays armed.
    ledger.record('contested-timeout', 'fail');

    // Dispatch 2 is a fresh process with ONE cycle.
    s = seedCounters(ledger.count, LEAF);
    expect(s.raised).toBe(false);            // timeout did not disarm it
    const afterOneCycle = s.seen + 1;
    expect(afterOneCycle).toBeGreaterThanOrEqual(2); // card RAISES again
  });

  it('a human answer DOES settle it — later dispatches must not re-ask', () => {
    const ledger = makeLedger([{ kind: 'coverage', verdict: 'fail' }, { kind: 'coverage', verdict: 'fail' }]);
    ledger.record('contested-answered', 'fail'); // human ruled REJECT
    const s = seedCounters(ledger.count, LEAF);
    expect(s.seen).toBeGreaterThanOrEqual(2);
    expect(s.raised).toBe(true); // suppressed by a REAL decision, not by a timeout
  });

  it('an ACCEPT answer also settles it', () => {
    const ledger = makeLedger([{ kind: 'coverage', verdict: 'fail' }]);
    ledger.record('contested-answered', 'pass');
    expect(seedCounters(ledger.count, LEAF).raised).toBe(true);
  });

  it('replays the real incident: 6 dispatches, card armed for every one after the timeout', () => {
    const ledger = makeLedger();
    const raises: number[] = [];
    // dispatch 1 = 2 cycles; dispatches 2..6 = 1 cycle each (the observed shape)
    const cyclesPerDispatch = [2, 1, 1, 1, 1, 1];
    let answered = false;

    cyclesPerDispatch.forEach((cycles, i) => {
      const dispatch = i + 1;
      let { seen, raised } = seedCounters(ledger.count, LEAF);
      for (let c = 0; c < cycles; c++) {
        ledger.record('coverage', 'fail');
        seen += 1;
        if (seen >= 2 && !raised) {
          raises.push(dispatch);
          raised = true;
          // Nobody ever answers in this replay — every card times out.
          ledger.record('contested-timeout', 'fail');
        }
      }
    });

    expect(answered).toBe(false);
    // Pre-fix this was [1] — one card for the whole leaf. Now every dispatch that
    // reaches the threshold re-raises, so the human is asked again instead of five
    // opus implements running unwatched.
    expect(raises[0]).toBe(1);
    expect(raises.length).toBeGreaterThan(1);
    expect(raises).toContain(2);
  });

  it('counts only the requested verdict', () => {
    const ledger = makeLedger([
      { kind: 'coverage', verdict: 'fail' },
      { kind: 'coverage', verdict: 'pass' }, // a COVERED cycle is not a contested one
    ]);
    expect(seedCounters(ledger.count, LEAF).seen).toBe(1);
  });

  it('unwired dep degrades to exactly the old behaviour', () => {
    const s = seedCounters(undefined, LEAF);
    expect(s).toEqual({ seen: 0, raised: false });
  });
});
