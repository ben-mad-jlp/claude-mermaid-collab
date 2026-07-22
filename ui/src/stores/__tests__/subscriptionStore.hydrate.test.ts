/**
 * Boot hydration drops DEAD entries (silent past GONE_MS) instead of rendering
 * them as gray cards forever — the 66-ghost Watching-list flood. Live entries
 * survive with their last-known status dimmed. The pruned result is written
 * straight back to localStorage so the flood cannot compound across restarts.
 *
 * Hydration runs at module import, so this file seeds localStorage FIRST and
 * imports the store dynamically per test via vi.resetModules().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _ls: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in _ls ? _ls[k] : null),
  setItem: (k: string, v: string) => { _ls[k] = String(v); },
  removeItem: (k: string) => { delete _ls[k]; },
  clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; },
};

const KEY = 'session-subscriptions';
const ORDER = 'session-subscriptions-order';

async function importFresh() {
  vi.resetModules();
  return await import('../subscriptionStore');
}

describe('subscriptionStore boot hydration (dead-entry prune)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('drops entries silent past the retention window and keeps fresh ones', async () => {
    const now = Date.now();
    localStorage.setItem(KEY, JSON.stringify({
      'srv:p:ghost': { serverId: 'srv', project: 'p', session: 'ghost', status: 'waiting', lastUpdate: now - 72 * 60 * 60_000 },
      'srv:p:live': { serverId: 'srv', project: 'p', session: 'live', status: 'active', lastUpdate: now - 1000 },
    }));
    localStorage.setItem(ORDER, JSON.stringify(['srv:p:ghost', 'srv:p:live']));
    const { useSubscriptionStore } = await importFresh();
    const st = useSubscriptionStore.getState();
    expect(Object.keys(st.subscriptions)).toEqual(['srv:p:live']);
    expect(st.order).toEqual(['srv:p:live']);
    // stale 'active' is coerced down so a reopened card never fakes a live pulse
    expect(st.subscriptions['srv:p:live'].status).toBe('waiting');
    expect(st.subscriptions['srv:p:live'].stale).toBe(true);
  });

  it('entries with no lastUpdate at all are dead — dropped', async () => {
    localStorage.setItem(KEY, JSON.stringify({
      'srv:p:ancient': { serverId: 'srv', project: 'p', session: 'ancient', status: 'waiting' },
    }));
    const { useSubscriptionStore } = await importFresh();
    expect(Object.keys(useSubscriptionStore.getState().subscriptions)).toEqual([]);
  });

  it('writes the pruned map back so the flood cannot compound across restarts', async () => {
    const now = Date.now();
    localStorage.setItem(KEY, JSON.stringify({
      'srv:p:ghost': { serverId: 'srv', project: 'p', session: 'ghost', status: 'unknown', lastUpdate: now - 72 * 60 * 60_000 },
    }));
    localStorage.setItem(ORDER, JSON.stringify(['srv:p:ghost']));
    await importFresh();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({});
    expect(JSON.parse(localStorage.getItem(ORDER)!)).toEqual([]);
  });

  it('a quiet-but-live session inside retention survives with status degraded to unknown', async () => {
    const now = Date.now();
    localStorage.setItem(KEY, JSON.stringify({
      'srv:p:quiet': { serverId: 'srv', project: 'p', session: 'quiet', status: 'waiting', lastUpdate: now - 60 * 60_000 },
    }));
    const { useSubscriptionStore } = await importFresh();
    const st = useSubscriptionStore.getState();
    expect(Object.keys(st.subscriptions)).toEqual(['srv:p:quiet']);
    expect(st.subscriptions['srv:p:quiet'].status).toBe('unknown'); // past GONE_MS: keep the card, not the status
  });
});
