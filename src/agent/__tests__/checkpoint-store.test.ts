import { describe, expect, it } from 'bun:test';
import { CheckpointStore } from '../checkpoint-store.js';

function makeStore(): CheckpointStore {
  return new CheckpointStore(':memory:');
}

describe('CheckpointStore', () => {
  it('insert + get round trip', () => {
    const store = makeStore();
    store.insert({
      sessionId: 's1',
      turnId: 't1',
      firstSeq: 10,
      stashSha: 'abc123',
    });

    const got = store.get('s1', 't1');
    expect(got).toBeDefined();
    expect(got?.sessionId).toBe('s1');
    expect(got?.turnId).toBe('t1');
    expect(got?.firstSeq).toBe(10);
    expect(got?.stashSha).toBe('abc123');
    expect(typeof got?.createdAt).toBe('number');
    expect(got!.createdAt).toBeGreaterThan(0);

    expect(store.get('s1', 'missing')).toBeUndefined();
    expect(store.get('missing', 't1')).toBeUndefined();
    store.close();
  });

  it('listBySession orders by first_seq ascending', () => {
    const store = makeStore();
    store.insert({ sessionId: 's1', turnId: 'tC', firstSeq: 30, stashSha: 'c' });
    store.insert({ sessionId: 's1', turnId: 'tA', firstSeq: 10, stashSha: 'a' });
    store.insert({ sessionId: 's1', turnId: 'tB', firstSeq: 20, stashSha: 'b' });
    // Different session — should not appear.
    store.insert({ sessionId: 's2', turnId: 'tX', firstSeq: 5, stashSha: 'x' });

    const list = store.listBySession('s1');
    expect(list.map((c) => c.turnId)).toEqual(['tA', 'tB', 'tC']);
    expect(list.map((c) => c.firstSeq)).toEqual([10, 20, 30]);

    expect(store.listBySession('none')).toEqual([]);
    store.close();
  });

  it('deleteFromSeq removes rows >= threshold and returns count', () => {
    const store = makeStore();
    store.insert({ sessionId: 's1', turnId: 't1', firstSeq: 10, stashSha: 'a' });
    store.insert({ sessionId: 's1', turnId: 't2', firstSeq: 20, stashSha: 'b' });
    store.insert({ sessionId: 's1', turnId: 't3', firstSeq: 30, stashSha: 'c' });
    store.insert({ sessionId: 's2', turnId: 't4', firstSeq: 25, stashSha: 'd' });

    const deleted = store.deleteFromSeq('s1', 20);
    expect(deleted).toBe(2);

    const remaining = store.listBySession('s1');
    expect(remaining.map((c) => c.turnId)).toEqual(['t1']);

    // Other session unaffected.
    expect(store.listBySession('s2').map((c) => c.turnId)).toEqual(['t4']);

    // Nothing to delete case.
    expect(store.deleteFromSeq('s1', 9999)).toBe(0);
    store.close();
  });

  it('insert with same (session_id, turn_id) replaces existing row', () => {
    const store = makeStore();
    store.insert({ sessionId: 's1', turnId: 't1', firstSeq: 10, stashSha: 'orig' });
    const first = store.get('s1', 't1');
    expect(first?.stashSha).toBe('orig');
    expect(first?.firstSeq).toBe(10);

    store.insert({ sessionId: 's1', turnId: 't1', firstSeq: 15, stashSha: 'replaced' });
    const second = store.get('s1', 't1');
    expect(second?.stashSha).toBe('replaced');
    expect(second?.firstSeq).toBe(15);

    // Still only one row for this key.
    const list = store.listBySession('s1');
    expect(list).toHaveLength(1);
    store.close();
  });
});
