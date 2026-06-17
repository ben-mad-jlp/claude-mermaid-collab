/**
 * parsePoolSessionName (inverse of poolSessionName) — the pure pool-lane name parser.
 * (restoreBusySlot + the restart-reconcile were retired with the tmux worker lane, P7.)
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  parsePoolSessionName,
  poolSessionName,
} from '../worker-pool.ts';

describe('parsePoolSessionName (inverse of poolSessionName)', () => {
  it('round-trips a default claude lane', () => {
    expect(parsePoolSessionName('backend-claude-1')).toEqual({ type: 'backend', provider: 'claude', slot: 1 });
    expect(parsePoolSessionName(poolSessionName('frontend', 'claude', 3))).toEqual({ type: 'frontend', provider: 'claude', slot: 3 });
  });

  it('handles a hyphenated provider (grok-build)', () => {
    expect(parsePoolSessionName('backend-grok-build-1')).toEqual({ type: 'backend', provider: 'grok-build', slot: 1 });
    expect(parsePoolSessionName(poolSessionName('cad', 'grok-build' as any, 2))).toEqual({ type: 'cad', provider: 'grok-build', slot: 2 });
  });

  it('rejects non-pool names (unknown type, no slot, too few parts)', () => {
    expect(parsePoolSessionName('planner')).toBeNull();
    expect(parsePoolSessionName('steward-claude')).toBeNull(); // unknown type 'steward' + no numeric slot
    expect(parsePoolSessionName('backend-claude-x')).toBeNull(); // non-numeric slot
    expect(parsePoolSessionName('backend-claude-0')).toBeNull(); // slot must be >= 1
  });
});
