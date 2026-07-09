import { describe, it, expect } from 'vitest';
import {
  pulseStage, isArmed, isPulsing, nextReadyTodo, nextUp, id8, startLeafDirective,
  PAUSE_MS, WARM_MS, GLOW_MS,
} from './zenPulse';
import type { SessionTodo } from '@/types/sessionTodo';
import type { TodoKind } from '@/lib/todoKind';

/** Every non-`kind` field of SessionTodo at its inert default. */
function base(): Omit<SessionTodo, 'kind'> {
  return {
    ownerSession: 's', assigneeSession: null, title: 't', description: null,
    status: 'planned' as SessionTodo['status'], completed: false, priority: null,
    dueDate: null, parentId: null, dependsOn: [], order: 0, link: null,
    createdAt: '', updatedAt: '', completedAt: null, asanaGid: null,
    approvedAt: '2026-01-01T00:00:00Z', // approved by default so claimable unless deps/etc.
    claim: null, acceptanceStatus: null, assigneeKind: 'agent',
  };
}

/** `kind` is REQUIRED and has NO default: a missing kind is a producer bug
 *  (todoKind.ts throws MissingKindError), and a defaulting factory re-hides it. */
function todo(over: Partial<SessionTodo> & { kind: TodoKind }): SessionTodo {
  return { ...base(), id: Math.random().toString(36).slice(2), ...over };
}

const NOW = 1_000_000_000;

describe('pulseStage — temporal gradient', () => {
  const pane = NOW;
  it('paused under 45s', () => {
    expect(pulseStage(pane, pane, 0)).toBe('paused');
    expect(pulseStage(pane, pane + PAUSE_MS - 1, 0)).toBe('paused');
  });
  it('settled 45s–4m', () => {
    expect(pulseStage(pane, pane + PAUSE_MS, 0)).toBe('settled');
    expect(pulseStage(pane, pane + WARM_MS - 1, 0)).toBe('settled');
  });
  it('warm 4m–15m', () => {
    expect(pulseStage(pane, pane + WARM_MS, 0)).toBe('warm');
    expect(pulseStage(pane, pane + GLOW_MS - 1, 0)).toBe('warm');
  });
  it('glowing 15m+ is the terminal ceiling', () => {
    expect(pulseStage(pane, pane + GLOW_MS, 0)).toBe('glowing');
    expect(pulseStage(pane, pane + GLOW_MS * 100, 0)).toBe('glowing'); // never brighter
  });
  it('off with no paneSeenAt', () => {
    expect(pulseStage(undefined, NOW, 0)).toBe('off');
  });
});

describe('anti-nag invariant — dismiss + re-arm', () => {
  it('dismiss sleeps the lane for the whole episode (off until paneSeenAt advances)', () => {
    const pane = NOW;
    // Long idle would be glowing, but dismissed === paneSeenAt → off.
    expect(pulseStage(pane, pane + GLOW_MS * 2, pane)).toBe('off');
  });
  it('re-arms on a real activity burst (paneSeenAt advances past the dismissal)', () => {
    const dismissedAt = NOW;
    const newPane = NOW + 10_000; // pane moved = real activity
    // Fresh episode: clock resets, dismissal no longer matches → warms again from paused.
    expect(pulseStage(newPane, newPane, dismissedAt)).toBe('paused');
    expect(pulseStage(newPane, newPane + WARM_MS, dismissedAt)).toBe('warm');
  });
  it('a stale dismissal from a prior episode does not suppress the new one', () => {
    const oldDismiss = NOW;
    const newPane = NOW + 60_000;
    expect(pulseStage(newPane, newPane + WARM_MS, oldDismiss)).toBe('warm');
  });
});

describe('stage helpers', () => {
  it('isArmed only warm/glowing', () => {
    expect(['off', 'paused', 'settled'].map(isArmed as (s: string) => boolean)).toEqual([false, false, false]);
    expect([isArmed('warm'), isArmed('glowing')]).toEqual([true, true]);
  });
  it('isPulsing settled/warm/glowing', () => {
    expect([isPulsing('off'), isPulsing('paused')]).toEqual([false, false]);
    expect([isPulsing('settled'), isPulsing('warm'), isPulsing('glowing')]).toEqual([true, true, true]);
  });
});

describe('nextReadyTodo / nextUp — grounded in the work graph', () => {
  it('picks the lowest-priority then lowest-order claimable leaf', () => {
    const todos = [
      todo({ id: 'a', title: 'A', priority: 2, order: 1, kind: 'leaf' }),
      todo({ id: 'b', title: 'B', priority: 0, order: 5, kind: 'leaf' }), // higher urgency (lower number) wins
      todo({ id: 'c', title: 'C', priority: 2, order: 0, kind: 'leaf' }),
    ];
    expect(nextReadyTodo(todos)?.title).toBe('B');
  });
  it('skips epics, done/dropped, unapproved, and dep-blocked', () => {
    const todos = [
      todo({ id: 'e', title: '[EPIC] Big', priority: 0, kind: 'epic' }),
      todo({ id: 'd', title: 'Done', status: 'done' as SessionTodo['status'], kind: 'leaf' }),
      todo({ id: 'u', title: 'Unapproved', approvedAt: null, kind: 'leaf' }),
      todo({ id: 'ok', title: 'Real', priority: 1, kind: 'leaf' }),
    ];
    expect(nextReadyTodo(todos)?.title).toBe('Real');
  });
  it('nextUp → blocked names the unmet dependency', () => {
    // dep is not itself ready (unapproved) so there's no ready leaf — the blocked path runs.
    const dep = todo({ id: 'dep', title: 'Land epic', status: 'planned' as SessionTodo['status'], approvedAt: null, kind: 'land' });
    const blocked = todo({ id: 'x', title: 'Ship it', dependsOn: ['dep'], kind: 'leaf' });
    const r = nextUp([dep, blocked]);
    expect(r.mode).toBe('blocked');
    expect(r.blockedBy).toBe('Land epic');
  });
  it('nextUp → empty when nothing real exists', () => {
    expect(nextUp([todo({ id: 'd', title: 'Done', status: 'done' as SessionTodo['status'], kind: 'leaf' })]).mode).toBe('empty');
  });
  it('nextUp → ready when a claimable leaf exists', () => {
    expect(nextUp([todo({ id: 'r', title: 'Go', kind: 'leaf' })]).mode).toBe('ready');
  });
});

describe('directive + id8', () => {
  it('id8 is the leading 8', () => {
    expect(id8('abcdef0123456789')).toBe('abcdef01');
  });
  it('startLeafDirective is a grounded nudge with the id8', () => {
    const d = startLeafDirective(todo({ id: 'abcdef0123', title: 'Wire selector', kind: 'leaf' }));
    expect(d).toContain('Wire selector');
    expect(d).toContain('abcdef01'); // id8 of 'abcdef0123'
    expect(d).toMatch(/Start now/);
  });
});
