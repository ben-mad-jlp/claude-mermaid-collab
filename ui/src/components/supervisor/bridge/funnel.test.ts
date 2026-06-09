import { describe, it, expect } from 'vitest';
import { FUNNEL_SEGMENTS, FUNNEL_LABELS, bucketTodo, withRecentDoneOnly, DONE_RECENT_MS } from './funnel';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
    description: null,
    status: 'backlog',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    ...p,
  } as SessionTodo;
}

describe('withRecentDoneOnly', () => {
  const now = 1_000_000_000_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  it('keeps done todos completed within the window', () => {
    const t = todo({ id: 'a', status: 'done', completedAt: iso(now - DONE_RECENT_MS + 1000) });
    expect(withRecentDoneOnly([t], DONE_RECENT_MS, now)).toHaveLength(1);
  });

  it('drops done todos completed past the window', () => {
    const t = todo({ id: 'b', status: 'done', completedAt: iso(now - DONE_RECENT_MS - 1000) });
    expect(withRecentDoneOnly([t], DONE_RECENT_MS, now)).toHaveLength(0);
  });

  it('keeps non-done todos and done todos with no completedAt', () => {
    const ready = todo({ id: 'c', status: 'ready' });
    const doneNoTs = todo({ id: 'd', status: 'done', completedAt: null });
    expect(withRecentDoneOnly([ready, doneNoTs], DONE_RECENT_MS, now)).toHaveLength(2);
  });
});

describe('funnel segment colors (single source)', () => {
  it('every segment carries a non-empty bg fill', () => {
    for (const seg of FUNNEL_SEGMENTS) {
      expect(seg.bg, seg.key).toBeTruthy();
    }
  });

  it('inflight=info, done=success (matches the graph node palette)', () => {
    const inflight = FUNNEL_SEGMENTS.find((s) => s.key === 'inflight')!;
    const done = FUNNEL_SEGMENTS.find((s) => s.key === 'done')!;
    expect(inflight.bg).toContain('info');
    expect(done.bg).toContain('success');
  });

  it('one-red: blocked is amber/warning, never danger/red', () => {
    const blocked = FUNNEL_SEGMENTS.find((s) => s.key === 'blocked')!;
    expect(blocked.tint).toContain('warning');
    expect(blocked.tint).not.toContain('danger');
    expect(blocked.bg).toContain('warning');
    expect(blocked.bg).not.toContain('danger');
  });

  it('blocked is still the only loud segment', () => {
    expect(FUNNEL_SEGMENTS.filter((s) => s.loud).map((s) => s.key)).toEqual(['blocked']);
  });

  it('still buckets a blocked todo into blocked', () => {
    expect(bucketTodo(todo({ id: 'x', status: 'blocked' }))).toBe('blocked');
  });

  it('FUNNEL_LABELS is the single label vocabulary, mirroring the segments', () => {
    // Every bucket has exactly one label, sourced from the segments.
    for (const seg of FUNNEL_SEGMENTS) {
      expect(FUNNEL_LABELS[seg.key]).toBe(seg.label);
    }
    expect(FUNNEL_LABELS.inflight).toBe('In-flight');
    expect(FUNNEL_LABELS.ready).toBe('Ready');
  });
});
