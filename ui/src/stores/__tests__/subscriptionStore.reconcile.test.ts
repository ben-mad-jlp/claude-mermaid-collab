/**
 * reconcileServerIds keeps watching-list subscriptions bound to the right server
 * across a remove/re-add (which mints a NEW server id and would otherwise strand
 * the subscription on a dead id → peer_not_paired when clicked).
 */
import { describe, it, expect, beforeEach } from 'vitest';

// subscriptionStore touches localStorage at import + in reconcile; jsdom here
// doesn't provide it, so back it with a minimal in-memory store BEFORE import.
const _ls: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in _ls ? _ls[k] : null),
  setItem: (k: string, v: string) => { _ls[k] = String(v); },
  removeItem: (k: string) => { delete _ls[k]; },
  clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; },
};

import { useSubscriptionStore, type SubscribedSession } from '../subscriptionStore';

function seed(subs: Record<string, Partial<SubscribedSession>>) {
  const full: Record<string, SubscribedSession> = {};
  for (const [k, v] of Object.entries(subs)) {
    full[k] = { serverId: '', project: 'p', session: 's', status: 'unknown', lastUpdate: 0, ...v };
  }
  useSubscriptionStore.setState({ subscriptions: full, order: Object.keys(full) });
}

const VD_OLD = 'old-virtualdev-uuid';
const VD_NEW = 'new-virtualdev-uuid';
const LOCAL = 'local-uuid';

describe('reconcileServerIds', () => {
  beforeEach(() => {
    localStorage.clear();
    useSubscriptionStore.setState({ subscriptions: {}, order: [] });
  });

  it('backfills host:port for a subscription whose server id is still valid', () => {
    seed({ [`${VD_OLD}:p:s`]: { serverId: VD_OLD, project: 'p', session: 's' } });
    useSubscriptionStore.getState().reconcileServerIds([
      { id: VD_OLD, host: 'virtualdev', port: 9002, source: 'manual' },
    ]);
    const sub = useSubscriptionStore.getState().subscriptions[`${VD_OLD}:p:s`];
    expect(sub.serverHost).toBe('virtualdev');
    expect(sub.serverPort).toBe(9002);
  });

  it('retags a stranded subscription by captured host:port and re-keys it', () => {
    // Captured host:port from a prior backfill; the id is now dead.
    seed({ [`${VD_OLD}:p:s`]: { serverId: VD_OLD, serverHost: 'virtualdev', serverPort: 9002, project: 'p', session: 's' } });
    useSubscriptionStore.getState().reconcileServerIds([
      { id: VD_NEW, host: 'virtualdev', port: 9002, source: 'manual' },
    ]);
    const { subscriptions, order } = useSubscriptionStore.getState();
    expect(subscriptions[`${VD_OLD}:p:s`]).toBeUndefined();
    expect(subscriptions[`${VD_NEW}:p:s`]?.serverId).toBe(VD_NEW);
    expect(order).toEqual([`${VD_NEW}:p:s`]);
  });

  it('legacy fallback: retags a host:port-less orphan when there is exactly one remote', () => {
    seed({ [`${VD_OLD}:p:s`]: { serverId: VD_OLD, project: 'p', session: 's' } });
    useSubscriptionStore.getState().reconcileServerIds([
      { id: LOCAL, host: '127.0.0.1', port: 9002, source: 'local' },
      { id: VD_NEW, host: 'virtualdev', port: 9002, source: 'manual' },
    ]);
    const { subscriptions } = useSubscriptionStore.getState();
    expect(subscriptions[`${VD_NEW}:p:s`]?.serverId).toBe(VD_NEW);
  });

  it('does NOT guess when an orphan lacks host:port and there are multiple remotes', () => {
    seed({ [`${VD_OLD}:p:s`]: { serverId: VD_OLD, project: 'p', session: 's' } });
    useSubscriptionStore.getState().reconcileServerIds([
      { id: 'a', host: 'hostA', port: 9002, source: 'manual' },
      { id: 'b', host: 'hostB', port: 9002, source: 'manual' },
    ]);
    // Ambiguous → left on the dead id rather than mis-bound.
    expect(useSubscriptionStore.getState().subscriptions[`${VD_OLD}:p:s`]?.serverId).toBe(VD_OLD);
  });

  it('is a no-op (no write) when every subscription already matches', () => {
    seed({ [`${VD_NEW}:p:s`]: { serverId: VD_NEW, serverHost: 'virtualdev', serverPort: 9002, project: 'p', session: 's' } });
    const before = JSON.stringify(useSubscriptionStore.getState().subscriptions);
    useSubscriptionStore.getState().reconcileServerIds([
      { id: VD_NEW, host: 'virtualdev', port: 9002, source: 'manual' },
    ]);
    expect(JSON.stringify(useSubscriptionStore.getState().subscriptions)).toBe(before);
  });

  it('delete-with-replacement migrates a subscription onto the surviving server id', () => {
    // Two entries for the same machine; the user deletes the stale one. The
    // survivor's id is known to the caller, so no heuristic is needed — but a
    // subscription owned by a DIFFERENT server must not be touched.
    seed({
      [`${VD_OLD}:p:s`]: { serverId: VD_OLD, serverHost: 'virtualdev', serverPort: 9002, serverLabel: 'virtualdev', project: 'p', session: 's' },
      [`${LOCAL}:p:other`]: { serverId: LOCAL, serverHost: '127.0.0.1', serverPort: 9002, project: 'p', session: 'other' },
    });
    useSubscriptionStore.getState().migrateServerId(VD_OLD, VD_NEW, { host: 'virtualdev', port: 9100, label: 'virtualdev' });

    const { subscriptions, order } = useSubscriptionStore.getState();
    expect(subscriptions[`${VD_OLD}:p:s`]).toBeUndefined();
    expect(subscriptions[`${VD_NEW}:p:s`]?.serverId).toBe(VD_NEW);
    expect(subscriptions[`${VD_NEW}:p:s`]?.serverPort).toBe(9100);
    expect(subscriptions[`${VD_NEW}:p:s`]?.serverLabel).toBe('virtualdev');
    // Foreign entry untouched, and the order list re-keyed in place.
    expect(subscriptions[`${LOCAL}:p:other`]?.serverId).toBe(LOCAL);
    expect(order).toEqual([`${VD_NEW}:p:s`, `${LOCAL}:p:other`]);
    // Persisted, not just in memory.
    expect(JSON.parse(localStorage.getItem('session-subscriptions')!)[`${VD_NEW}:p:s`].serverId).toBe(VD_NEW);
  });

  it('migrateServerId is a no-op (no write) when no subscription carries the dead id', () => {
    seed({ [`${VD_NEW}:p:s`]: { serverId: VD_NEW, project: 'p', session: 's' } });
    const before = JSON.stringify(useSubscriptionStore.getState().subscriptions);
    useSubscriptionStore.getState().migrateServerId(VD_OLD, LOCAL, { host: 'h', port: 1 });
    expect(JSON.stringify(useSubscriptionStore.getState().subscriptions)).toBe(before);
    expect(localStorage.getItem('session-subscriptions')).toBeNull();
  });

  it('label fallback: adopts the sole current server carrying the dead entry label on a different port', () => {
    seed({ [`${VD_OLD}:p:s`]: { serverId: VD_OLD, serverHost: 'virtualdev', serverPort: 9002, serverLabel: 'virtualdev', project: 'p', session: 's' } });
    useSubscriptionStore.getState().reconcileServerIds([
      { id: LOCAL, host: '127.0.0.1', port: 9002, source: 'local', label: 'Local' },
      { id: VD_NEW, host: 'virtualdev', port: 9100, source: 'manual', label: 'virtualdev' },
    ]);
    const { subscriptions } = useSubscriptionStore.getState();
    expect(subscriptions[`${VD_OLD}:p:s`]).toBeUndefined();
    expect(subscriptions[`${VD_NEW}:p:s`]?.serverId).toBe(VD_NEW);
    expect(subscriptions[`${VD_NEW}:p:s`]?.serverPort).toBe(9100);
  });

  it('does NOT adopt by label when two current servers share it', () => {
    seed({ [`${VD_OLD}:p:s`]: { serverId: VD_OLD, serverHost: 'virtualdev', serverPort: 9002, serverLabel: 'virtualdev', project: 'p', session: 's' } });
    useSubscriptionStore.getState().reconcileServerIds([
      { id: 'a', host: 'hostA', port: 9100, source: 'manual', label: 'virtualdev' },
      { id: 'b', host: 'hostB', port: 9200, source: 'manual', label: 'virtualdev' },
    ]);
    // Ambiguous → left on the dead id rather than mis-bound.
    expect(useSubscriptionStore.getState().subscriptions[`${VD_OLD}:p:s`]?.serverId).toBe(VD_OLD);
  });
});
