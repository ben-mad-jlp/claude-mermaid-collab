import { describe, it, expect } from 'bun:test';
import { selectWatchdogActions, DEFAULT_WATCHDOG_CONFIG } from '../context-watchdog';
import type { SessionStatusRow } from '../session-status-store';

const NOW = 1_000_000_000_000;
function row(p: Partial<SessionStatusRow>): SessionStatusRow {
  return {
    project: '/p', session: 's', status: 'waiting', updatedAt: NOW,
    contextPercent: null, contextUpdatedAt: null, checkpointReadyAt: null, ...p,
  };
}
const actions = (rows: SessionStatusRow[], cfg = DEFAULT_WATCHDOG_CONFIG) => selectWatchdogActions(rows, NOW, cfg);

describe('selectWatchdogActions', () => {
  it('checkpoints an idle session over threshold with a fresh reading', () => {
    const a = actions([row({ session: 'hot', status: 'waiting', contextPercent: 82, contextUpdatedAt: NOW - 1000 })]);
    expect(a).toEqual([{ session: 'hot', action: 'checkpoint', contextPercent: 82, reason: 'context>=80@idle' }]);
  });

  it('does NOT checkpoint an ACTIVE session (unsafe boundary), even over threshold', () => {
    const a = actions([row({ status: 'active', contextPercent: 95, contextUpdatedAt: NOW })]);
    expect(a).toEqual([]);
  });

  it('does NOT checkpoint while awaiting a permission decision', () => {
    const a = actions([row({ status: 'permission', contextPercent: 95, contextUpdatedAt: NOW })]);
    expect(a).toEqual([]);
  });

  it('ignores a STALE contextPercent reading', () => {
    const stale = NOW - (DEFAULT_WATCHDOG_CONFIG.contextMaxAgeMs + 1);
    const a = actions([row({ status: 'waiting', contextPercent: 90, contextUpdatedAt: stale })]);
    expect(a).toEqual([]);
  });

  it('does not act below threshold', () => {
    expect(actions([row({ status: 'waiting', contextPercent: 79, contextUpdatedAt: NOW })])).toEqual([]);
  });

  it('respects a custom threshold', () => {
    const cfg = { ...DEFAULT_WATCHDOG_CONFIG, thresholdPercent: 60 };
    const a = actions([row({ status: 'waiting', contextPercent: 65, contextUpdatedAt: NOW })], cfg);
    expect(a[0]?.action).toBe('checkpoint');
  });

  it('a recent persisted checkpoint → clear, regardless of activity status', () => {
    const a = actions([row({ status: 'active', checkpointReadyAt: NOW - 1000, contextPercent: 90, contextUpdatedAt: NOW })]);
    expect(a).toEqual([{ session: 's', action: 'clear', contextPercent: 90, reason: 'checkpoint-persisted' }]);
  });

  it('a STALE checkpoint marker does not authorize a clear', () => {
    const old = NOW - (DEFAULT_WATCHDOG_CONFIG.checkpointMaxAgeMs + 1);
    // also under threshold so it doesn't fall through to checkpoint
    const a = actions([row({ status: 'waiting', checkpointReadyAt: old, contextPercent: 10, contextUpdatedAt: NOW })]);
    expect(a).toEqual([]);
  });

  it('tags ONLY the supervisor own-session candidate with self=true', () => {
    const a = selectWatchdogActions(
      [
        row({ session: 'worker-hot', status: 'waiting', contextPercent: 90, contextUpdatedAt: NOW }),
        row({ session: 'the-supervisor', status: 'waiting', contextPercent: 88, contextUpdatedAt: NOW }),
      ],
      NOW,
      DEFAULT_WATCHDOG_CONFIG,
      'the-supervisor',
    );
    expect(a.find((x) => x.session === 'worker-hot')!.self).toBeUndefined();
    expect(a.find((x) => x.session === 'the-supervisor')!.self).toBe(true);
  });

  it('tags a self CLEAR candidate too', () => {
    const a = selectWatchdogActions(
      [row({ session: 'sup', status: 'active', checkpointReadyAt: NOW - 500, contextPercent: 91, contextUpdatedAt: NOW })],
      NOW,
      DEFAULT_WATCHDOG_CONFIG,
      'sup',
    );
    expect(a).toEqual([{ session: 'sup', action: 'clear', contextPercent: 91, reason: 'checkpoint-persisted', self: true }]);
  });

  it('handles a mixed fleet deterministically', () => {
    const a = actions([
      row({ session: 'idle-cold', status: 'waiting', contextPercent: 20, contextUpdatedAt: NOW }),
      row({ session: 'idle-hot', status: 'waiting', contextPercent: 85, contextUpdatedAt: NOW }),
      row({ session: 'busy-hot', status: 'active', contextPercent: 99, contextUpdatedAt: NOW }),
      row({ session: 'ready', status: 'checkpoint_ready', checkpointReadyAt: NOW - 500 }),
    ]);
    expect(a.map((x) => `${x.session}:${x.action}`)).toEqual(['idle-hot:checkpoint', 'ready:clear']);
  });
});
