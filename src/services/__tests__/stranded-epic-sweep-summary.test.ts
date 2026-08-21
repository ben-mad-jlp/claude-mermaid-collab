import { describe, it, expect } from 'bun:test';
import { sweepStrandedEpics } from '../coordinator-land';
import { createCachedSweepState, runCachedSweep } from '../sweep-verdict-cache';

describe('stranded-epic sweep summary', () => {
  it('the throttled early return yields a zeroed SweepSummary, not an empty array', async () => {
    // lastStrandedEpicSweepAt is unset for this project, so the throttle compares
    // 1000 - 0 < 90000 → true → the early-return path, never reaching listTodos.
    const result = await sweepStrandedEpics('/tmp/nonexistent-project', { now: 1000 });
    expect(result).toEqual({
      sweepKind: 'stranded',
      candidates: 0,
      scanned: 0,
      checked: 0,
      cachedHits: 0,
      skippedUnchanged: 0,
      skippedMissingBranch: 0,
      errors: 0,
      cursorStart: 0,
      cursorEnd: 0,
      nextCursor: null,
      resurfaced: [],
    });
  });

  it('an item whose tip is unchanged reuses its stored verdict, counts a cachedHit and never calls check', async () => {
    const state = createCachedSweepState();
    const items = [{ id: 'a', tip: 'sha1' }];
    let checkCalls = 0;
    const hits: Array<{ id: string; verdict: boolean }> = [];

    const first = await runCachedSweep(state, {
      sweepKind: 'test',
      items,
      idOf: (i) => i.id,
      tipOf: (i) => i.tip,
      check: () => {
        checkCalls++;
        return true;
      },
    });
    expect(first.checked).toBe(1);
    expect(checkCalls).toBe(1);

    const second = await runCachedSweep(state, {
      sweepKind: 'test',
      items,
      idOf: (i) => i.id,
      tipOf: (i) => i.tip, // unchanged tip
      check: () => {
        checkCalls++;
        return true;
      },
      onHit: (i, verdict) => {
        hits.push({ id: i.id, verdict });
      },
    });

    expect(checkCalls).toBe(1); // check was NOT called again
    expect(second.cachedHits).toBe(1);
    expect(second.checked).toBe(0);
    expect(hits).toEqual([{ id: 'a', verdict: true }]);
  });

  it('a candidate list longer than pageSize returns a nextCursor and resumes after it on the next run', async () => {
    const state = createCachedSweepState();
    const items = [
      { id: 'a', tip: 't-a' },
      { id: 'b', tip: 't-b' },
      { id: 'c', tip: 't-c' },
    ];
    const seen: string[] = [];
    const check = (i: { id: string; tip: string }) => {
      seen.push(i.id);
      return false;
    };

    const first = await runCachedSweep(state, {
      sweepKind: 'test',
      items,
      idOf: (i) => i.id,
      tipOf: (i) => i.tip,
      check,
      pageSize: 2,
      cursor: null,
    });
    expect(seen).toEqual(['a', 'b']);
    expect(first.scanned).toBe(2);
    expect(first.nextCursor).toBe('b');

    const second = await runCachedSweep(state, {
      sweepKind: 'test',
      items,
      idOf: (i) => i.id,
      tipOf: (i) => i.tip,
      check,
      pageSize: 2,
      cursor: first.nextCursor,
    });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(second.scanned).toBe(1);
    expect(second.nextCursor).toBe(null); // reached the end → wraps to the head next run
  });
});
