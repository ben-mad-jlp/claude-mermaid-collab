// Pure summarizeFrictionTrends tests — no DB needed.
import { describe, test, expect } from 'bun:test';
import type { FrictionNote } from '../friction-store';
import { summarizeFrictionTrends } from '../friction-trends';

let seq = 0;
function note(partial: Partial<FrictionNote> & { layer: FrictionNote['layer']; retryReason: string }): FrictionNote {
  return {
    id: `f${++seq}`,
    todoId: 't1',
    session: null,
    attempt: 1,
    detail: null,
    createdAt: partial.createdAt ?? '2026-06-11T00:00:00.000Z',
    ...partial,
  };
}

describe('summarizeFrictionTrends', () => {
  test('empty → zeroed rollup', () => {
    const r = summarizeFrictionTrends([]);
    expect(r.total).toBe(0);
    expect(r.byLayer).toEqual([]);
    expect(r.recurring).toEqual([]);
  });

  test('groups by layer with counts and ranks reasons by count', () => {
    const r = summarizeFrictionTrends([
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation', session: 'a', createdAt: '2026-06-11T03:00:00.000Z' }),
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation', session: 'b', createdAt: '2026-06-11T02:00:00.000Z' }),
      note({ layer: 'orchestration', retryReason: 'gate-format', session: 'a', createdAt: '2026-06-11T01:00:00.000Z' }),
      note({ layer: 'domain', retryReason: 'cad-api-rederived', createdAt: '2026-06-11T00:30:00.000Z' }),
    ]);
    expect(r.total).toBe(4);
    // orchestration (3) ranks before domain (1)
    expect(r.byLayer.map((l) => l.layer)).toEqual(['orchestration', 'domain']);
    const orch = r.byLayer[0];
    expect(orch.count).toBe(3);
    // tmux-accumulation (2) ranks before gate-format (1)
    expect(orch.reasons.map((x) => x.retryReason)).toEqual(['tmux-accumulation', 'gate-format']);
    const top = orch.reasons[0];
    expect(top.count).toBe(2);
    expect(top.sessions.sort()).toEqual(['a', 'b']);
    expect(top.lastAt).toBe('2026-06-11T03:00:00.000Z'); // max createdAt
  });

  test('recurring lists only reasons seen more than once, most-recurring first', () => {
    const r = summarizeFrictionTrends([
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation' }),
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation' }),
      note({ layer: 'orchestration', retryReason: 'tmux-accumulation' }),
      note({ layer: 'domain', retryReason: 'flaky-test' }),
      note({ layer: 'domain', retryReason: 'flaky-test' }),
      note({ layer: 'domain', retryReason: 'one-off' }),
    ]);
    expect(r.recurring).toEqual([
      { layer: 'orchestration', retryReason: 'tmux-accumulation', count: 3 },
      { layer: 'domain', retryReason: 'flaky-test', count: 2 },
    ]);
  });

  test('null sessions are excluded from a reason\'s session list', () => {
    const r = summarizeFrictionTrends([
      note({ layer: 'domain', retryReason: 'x', session: null }),
      note({ layer: 'domain', retryReason: 'x', session: 'w1' }),
    ]);
    expect(r.byLayer[0].reasons[0].sessions).toEqual(['w1']);
  });
});
