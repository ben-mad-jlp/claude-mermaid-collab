// migrateLegacyEntries — the 'local' self-heal.
//
// A subscription minted under the literal 'local' default (serverId-less paths)
// can never reconcile against real-id claude_session events, because updateStatus
// is update-only and keys strictly by serverId. The migration re-keys 'local' (and
// empty) entries onto the real active server id — but ONLY when a real id is known
// (not browser/single-server mode, where 'local' is legitimate).
import { describe, it, expect, beforeEach } from 'vitest';
import { useSubscriptionStore, type SubscribedSession } from './subscriptionStore';

// Real server ids are the 12-char deriveSessionId hash, NOT a UUID. (A UUID is a
// pre-deriveSessionId legacy id — see LEGACY_UUID below.)
const REAL = 'c59bcb718337';
const LEGACY_UUID = '213dd243-6bce-4fff-87c6-ac1deda07d28';

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

  it('re-keys a stale legacy-UUID serverId onto the real server id', () => {
    // The bug behind peer_not_paired: a pre-deriveSessionId UUID matches no live
    // server, so the click hit the unpaired-peer gate. It must heal like 'local'.
    seed({ [`${LEGACY_UUID}:/srv/codebase/qbs:bidding`]: entry(LEGACY_UUID, '/srv/codebase/qbs', 'bidding') });
    useSubscriptionStore.getState().migrateLegacyEntries(REAL);
    const subs = useSubscriptionStore.getState().subscriptions;
    expect(Object.keys(subs)).toEqual([`${REAL}:/srv/codebase/qbs:bidding`]);
    expect(subs[`${REAL}:/srv/codebase/qbs:bidding`].serverId).toBe(REAL);
  });

  it("re-keys a legacy-UUID onto 'local' in single-server mode (defaultServerId === 'local')", () => {
    // Desktop case: the local server IS 'local'. A UUID still re-keys onto it
    // (unlike the 'local' literal, which is a no-op when default is 'local').
    seed({ [`${LEGACY_UUID}:/srv/codebase/qbs:bidding`]: entry(LEGACY_UUID, '/srv/codebase/qbs', 'bidding') });
    useSubscriptionStore.getState().migrateLegacyEntries('local');
    expect(Object.keys(useSubscriptionStore.getState().subscriptions)).toEqual(['local:/srv/codebase/qbs:bidding']);
  });
});
