import { describe, it, expect } from 'vitest';
import { epicBucket, type FunnelKey } from './funnel';

const counts = (over: Partial<Record<FunnelKey, number>> = {}): Record<FunnelKey, number> => ({
  backlog: 0,
  ready: 0,
  inflight: 0,
  blocked: 0,
  done: 0,
  ...over,
});

describe('epicBucket — the epic node OWN status tint', () => {
  it('any in-flight child wins (WORKING dominates)', () => {
    expect(epicBucket(counts({ inflight: 1, blocked: 2, backlog: 3 }), 'ready')).toBe('inflight');
  });

  it('a blocked child beats own status when nothing is in-flight', () => {
    expect(epicBucket(counts({ blocked: 1, backlog: 2 }), 'ready')).toBe('blocked');
  });

  it("done keys off the epic's OWN status (graph hides done children → counts.done is 0)", () => {
    expect(epicBucket(counts(), 'done')).toBe('done');
  });

  it('all visible children done → done', () => {
    expect(epicBucket(counts({ done: 3 }), 'ready')).toBe('done');
  });

  it('approved epic with quiet children → ready', () => {
    expect(epicBucket(counts({ backlog: 2 }), 'ready')).toBe('ready');
  });

  it('unapproved / planned epic → backlog (preserves the prior gray look)', () => {
    expect(epicBucket(counts({ backlog: 2 }), 'planned')).toBe('backlog');
  });
});
