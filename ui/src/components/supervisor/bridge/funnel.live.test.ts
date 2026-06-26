import type { SessionTodo } from '@/types/sessionTodo';
import { describe, it, expect } from 'vitest';
import { liveBucketTodo, liveStatusStyle, bucketTodo } from './funnel';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    status: 'backlog',
    label: p.label ?? p.id,
    ...p,
  } as SessionTodo;
}

describe('liveBucketTodo — inflight override wins', () => {
  it('returns inflight when id is in inflightLeafIds, regardless of stored status', () => {
    const ids = new Set(['t1']);
    expect(liveBucketTodo(todo({ id: 't1', status: 'backlog' }), undefined, ids)).toBe('inflight');
    expect(liveBucketTodo(todo({ id: 't1', status: 'done' }), undefined, ids)).toBe('inflight');
    expect(liveBucketTodo(todo({ id: 't1', status: 'planned' }), undefined, ids)).toBe('inflight');
  });

  it('does NOT apply inflight override when id is absent from the set', () => {
    const ids = new Set(['other']);
    expect(liveBucketTodo(todo({ id: 't1', status: 'done' }), undefined, ids)).toBe('done');
  });
});

describe('liveBucketTodo — fallback equals bucketTodo', () => {
  it('when id is absent from inflightLeafIds, result equals bucketTodo(t, byId)', () => {
    const t = todo({ id: 't2', status: 'done' });
    const byId = new Map<string, SessionTodo>([['t2', t]]);
    const ids = new Set(['other-id']);
    expect(liveBucketTodo(t, byId, ids)).toBe(bucketTodo(t, byId));
  });

  it('without inflightLeafIds arg, result equals bucketTodo(t, byId)', () => {
    const t = todo({ id: 't3', status: 'in_progress' });
    const byId = new Map<string, SessionTodo>([['t3', t]]);
    expect(liveBucketTodo(t, byId)).toBe(bucketTodo(t, byId));
    expect(liveBucketTodo(t, byId)).toBe('inflight');
  });
});

describe('liveBucketTodo — in_progress → done transition (headless leaf run)', () => {
  it('headless leaf in inflightLeafIds with unchanged stored status → inflight', () => {
    const t = todo({ id: 'leaf1', status: 'planned', approvedAt: '2026-01-01T00:00:00.000Z' });
    const byId = new Map<string, SessionTodo>([['leaf1', t]]);
    expect(liveBucketTodo(t, byId, new Set(['leaf1']))).toBe('inflight');
  });

  it('same todo flipped to done and absent from inflightLeafIds → done', () => {
    const t = todo({ id: 'leaf1', status: 'done', completedAt: '2026-01-01T01:00:00.000Z' });
    const byId = new Map<string, SessionTodo>([['leaf1', t]]);
    expect(liveBucketTodo(t, byId, new Set<string>())).toBe('done');
  });
});

describe('liveBucketTodo — byId ready/blocked guard', () => {
  it('claimable todo: resolves to ready WITH byId, collapses to backlog WITHOUT byId', () => {
    const t = todo({
      id: 'work1',
      status: 'planned',
      approvedAt: '2026-01-01T00:00:00.000Z',
    });
    const byId = new Map<string, SessionTodo>([['work1', t]]);

    expect(liveBucketTodo(t, byId)).toBe('ready');
    expect(liveBucketTodo(t)).toBe('backlog');
    expect(liveBucketTodo(t, byId)).not.toBe(liveBucketTodo(t));
  });
});

describe('liveStatusStyle', () => {
  it('returns inflight-colored style when id is in inflightLeafIds', () => {
    const style = liveStatusStyle(todo({ id: 'x', status: 'backlog' }), undefined, new Set(['x']));
    expect(style).not.toBeNull();
    expect(style?.dot).toContain('info'); // bg-info-500
  });

  it('returns done-colored style when done and not in inflightLeafIds', () => {
    const style = liveStatusStyle(todo({ id: 'y', status: 'done' }), undefined, new Set());
    expect(style?.dot).toContain('success'); // bg-success-500
  });
});
