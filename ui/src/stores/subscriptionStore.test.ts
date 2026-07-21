// migrateLegacyEntries — the 'local' self-heal.
//
// A subscription minted under the literal 'local' default (serverId-less paths)
// can never reconcile against real-id claude_session events, because updateStatus
// is update-only and keys strictly by serverId. The migration re-keys 'local' (and
// empty) entries onto the real active server id — but ONLY when a real id is known
// (not browser/single-server mode, where 'local' is legitimate).
import { describe, it, expect, beforeEach } from 'vitest';
import { useSubscriptionStore, type SubscribedSession } from './subscriptionStore';

const REAL = '4b63dc90-1386-4a75-8316-6d7d5aeec7a3';

const entry = (serverId: string, project: string, session: string, extra?: Partial<SubscribedSession>): SubscribedSession => ({
  serverId, project, session, status: 'unknown', lastUpdate: 0, ...extra,
});

function seed(subs: Record<string, SubscribedSession>) {
  useSubscriptionStore.setState({ subscriptions: subs, order: Object.keys(subs) });
}

describe('subscriptionStore.migrateLegacyEntries — local self-heal', () => {
  beforeEach(() => useSubscriptionStore.setState({ subscriptions: {}, order: [] }));

  it("re-keys a 'local' entry onto the real server id", () => {
    seed({ 'local:/p:design': entry('local', '/p', 'design') });
    useSubscriptionStore.getState().migrateLegacyEntries(REAL);
    const subs = useSubscriptionStore.getState().subscriptions;
    expect(Object.keys(subs)).toEqual([`${REAL}:/p:design`]);
    expect(subs[`${REAL}:/p:design`].serverId).toBe(REAL);
    expect(useSubscriptionStore.getState().order).toEqual([`${REAL}:/p:design`]);
  });

  it('re-keys an empty-serverId legacy entry too', () => {
    seed({ ':/p:design': entry('', '/p', 'design') });
    useSubscriptionStore.getState().migrateLegacyEntries(REAL);
    expect(Object.keys(useSubscriptionStore.getState().subscriptions)).toEqual([`${REAL}:/p:design`]);
  });

  it("collapses a 'local' dup onto an existing real-id twin (no duplicate row)", () => {
    seed({
      'local:/p:design': entry('local', '/p', 'design', { status: 'unknown' }),
      [`${REAL}:/p:design`]: entry(REAL, '/p', 'design', { status: 'active' }),
    });
    useSubscriptionStore.getState().migrateLegacyEntries(REAL);
    const subs = useSubscriptionStore.getState().subscriptions;
    expect(Object.keys(subs)).toEqual([`${REAL}:/p:design`]);
  });

  it("leaves 'local' untouched in browser/single-server mode (defaultServerId === 'local')", () => {
    seed({ 'local:/p:design': entry('local', '/p', 'design') });
    useSubscriptionStore.getState().migrateLegacyEntries('local');
    expect(Object.keys(useSubscriptionStore.getState().subscriptions)).toEqual(['local:/p:design']);
  });

  it('does not re-key entries that already carry a real server id', () => {
    seed({ [`${REAL}:/p:design`]: entry(REAL, '/p', 'design', { status: 'active' }) });
    useSubscriptionStore.getState().migrateLegacyEntries(REAL);
    const subs = useSubscriptionStore.getState().subscriptions;
    expect(Object.keys(subs)).toEqual([`${REAL}:/p:design`]);
    expect(subs[`${REAL}:/p:design`].status).toBe('active');
  });
});

describe('subscriptionStore.ensureSubscribed', () => {
  beforeEach(() => useSubscriptionStore.setState({ subscriptions: {}, order: [] }));

  it('creates a single entry on an empty store', () => {
    useSubscriptionStore.getState().ensureSubscribed('srv1:/p:s1', { serverId: 'srv1', project: '/p', session: 's1', status: 'active' });
    const subs = useSubscriptionStore.getState().subscriptions;
    const order = useSubscriptionStore.getState().order;
    expect(Object.keys(subs)).toEqual(['srv1:/p:s1']);
    expect(order).toEqual(['srv1:/p:s1']);
    expect(subs['srv1:/p:s1']).toEqual({ serverId: 'srv1', project: '/p', session: 's1', status: 'active', lastUpdate: expect.any(Number) });
  });

  it('is idempotent — a second call with the same args is a no-op', () => {
    useSubscriptionStore.getState().ensureSubscribed('srv1:/p:s1', { serverId: 'srv1', project: '/p', session: 's1', status: 'active' });
    const firstEntry = useSubscriptionStore.getState().subscriptions['srv1:/p:s1'];
    useSubscriptionStore.getState().updateStatus('srv1', 'cs1', 'waiting', '/p', 's1');
    const mutatedEntry = useSubscriptionStore.getState().subscriptions['srv1:/p:s1'];
    expect(mutatedEntry.status).toBe('waiting');
    useSubscriptionStore.getState().ensureSubscribed('srv1:/p:s1', { serverId: 'srv1', project: '/p', session: 's1', status: 'active' });
    const afterSecondEnsure = useSubscriptionStore.getState().subscriptions['srv1:/p:s1'];
    expect(Object.keys(useSubscriptionStore.getState().subscriptions)).toEqual(['srv1:/p:s1']);
    expect(afterSecondEnsure.status).toBe('waiting');
  });
});
