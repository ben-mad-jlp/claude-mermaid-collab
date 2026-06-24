import { create } from 'zustand';
import { evictSessionItemsCache } from '@/lib/sessionItemsCache';

export interface SubscribedSession {
  serverId: string;
  project: string;
  session: string;
  claudeSessionId?: string;
  claudePid?: number;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
  /** Last-known status carried across a reopen but not yet confirmed by a live
   *  event — the card dims (lighter) instead of going gray. Cleared on any event. */
  stale?: boolean;
}

interface SubscribeOpts {
  claudeSessionId?: string;
  claudePid?: number;
}

interface SubscriptionState {
  subscriptions: Record<string, SubscribedSession>;
  order: string[];
  subscribe: (serverId: string, project: string, session: string, opts?: SubscribeOpts) => void;
  unsubscribe: (key: string) => void;
  reorder: (order: string[]) => void;
  updateStatus: (serverId: string, claudeSessionId: string, status: string, project: string, session: string, claudePid?: number) => void;
  updateContextPercent: (serverId: string, project: string, session: string, pct: number) => void;
  migrateLegacyEntries: (defaultServerId: string | null) => void;
}

const STORAGE_KEY = 'session-subscriptions';
const ORDER_KEY = 'session-subscriptions-order';

/** Past this age a persisted/last-heard status is too old to trust as live. */
export const GONE_MS = 15 * 60_000;

const compositeKey = (serverId: string, project: string, session: string) => `${serverId}:${project}:${session}`;

/**
 * Hydrate raw localStorage payload. Legacy entries (pre-cross-server-watch)
 * were keyed by `${project}:${session}` and had no `serverId` field. We do NOT
 * drop them — they get silently tagged with the boot-time active server's id
 * via `migrateLegacyEntries`, called once from App.tsx after `currentSession.serverId`
 * resolves. Until then they sit in the map with empty `serverId` and the
 * old-style key; they don't crash but won't receive aggregator updates
 * (which now require a matching serverId).
 */
function hydrateSubscriptions(): Record<string, SubscribedSession> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, any>;
    const out: Record<string, SubscribedSession> = {};
    // On reopen we no longer have a live confirmation of each session's status,
    // but wiping to 'unknown' (gray) hides the useful last-known state. Instead
    // keep the LAST-KNOWN status and flag it `stale` so the card dims (lighter)
    // rather than going gray — the WatchAggregator's live events clear `stale` as
    // they arrive. Coerce a stale 'active' down to 'waiting' so a reopened card
    // never shows a fake "running now" amber pulse. contextPercent/pid stay reset
    // (no live source yet). Identity + user-set fields stay persisted.
    const now = Date.now();
    const VALID = new Set(['active', 'waiting', 'permission', 'unknown']);
    for (const [k, v] of Object.entries(raw)) {
      const age = typeof v.lastUpdate === 'number' ? now - v.lastUpdate : Infinity;
      const lastKnown = VALID.has(v.status) && age <= GONE_MS ? v.status : 'unknown';
      const coerced = lastKnown === 'active' ? 'waiting' : lastKnown;
      out[k] = {
        serverId: typeof v.serverId === 'string' ? v.serverId : '',
        project: v.project,
        session: v.session,
        status: coerced,
        lastUpdate: typeof v.lastUpdate === 'number' ? v.lastUpdate : now,
        // Only mark stale when there's a real last-known status to dim; a genuine
        // 'unknown' (or too-old) stays gray (nothing to fade).
        stale: coerced !== 'unknown',
      };
    }
    return out;
  } catch {
    return {};
  }
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: hydrateSubscriptions(),

  order: (() => {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); }
    catch { return []; }
  })(),

  subscribe: (serverId, project, session, opts) => {
    const key = compositeKey(serverId, project, session);
    set((state) => {
      const next = {
        ...state.subscriptions,
        [key]: {
          serverId,
          project,
          session,
          claudeSessionId: opts?.claudeSessionId,
          claudePid: opts?.claudePid,
          status: 'unknown' as const,
          lastUpdate: Date.now(),
        },
      };
      const nextOrder = state.order.includes(key) ? state.order : [...state.order, key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ORDER_KEY, JSON.stringify(nextOrder));
      return { subscriptions: next, order: nextOrder };
    });
  },

  unsubscribe: (key) => {
    set((state) => {
      const next = { ...state.subscriptions };
      const entry = state.subscriptions[key];
      if (entry) evictSessionItemsCache(entry.project, entry.session);
      delete next[key];
      const nextOrder = state.order.filter((k) => k !== key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ORDER_KEY, JSON.stringify(nextOrder));
      return { subscriptions: next, order: nextOrder };
    });
  },

  reorder: (newOrder) => {
    set(() => {
      localStorage.setItem(ORDER_KEY, JSON.stringify(newOrder));
      return { order: newOrder };
    });
  },

  updateContextPercent: (serverId, project, session, pct) => {
    const key = compositeKey(serverId, project, session);
    set((state) => {
      const existing = state.subscriptions[key];
      if (!existing) return state;
      const next = { ...state.subscriptions, [key]: { ...existing, contextPercent: pct } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { subscriptions: next };
    });
  },

  updateStatus: (serverId, claudeSessionId, status, project, session, claudePid?) => {
    const key = compositeKey(serverId, project, session);
    set((state) => {
      const existing = state.subscriptions[key];
      if (!existing) return state;
      const newStatus = status as 'active' | 'waiting' | 'permission' | 'unknown';
      // Only reset the timer when transitioning between active and non-active states
      const isActiveGroup = (s: string) => s === 'active' || s === 'permission';
      const statusGroupChanged = isActiveGroup(existing.status) !== isActiveGroup(newStatus);
      const lastUpdate = statusGroupChanged ? Date.now() : existing.lastUpdate;
      const pidUpdate = claudePid !== undefined ? { claudePid } : {};
      // A live event confirms the status — clear the hydrate `stale` dim.
      const next = { ...state.subscriptions, [key]: { ...existing, claudeSessionId, status: newStatus, lastUpdate, stale: false, ...pidUpdate } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { subscriptions: next };
    });
  },

  /**
   * One-shot self-heal for legacy localStorage entries that pre-date the
   * `serverId` field. Tags any entry whose `serverId` is empty with
   * `defaultServerId` and rewrites the composite key. If `defaultServerId`
   * is null (no active server known at boot) we leave them untagged — they
   * appear in the panel but won't receive updates; the user can unsubscribe
   * and re-add once a server becomes active.
   */
  migrateLegacyEntries: (defaultServerId) => {
    set((state) => {
      const oldEntries = Object.entries(state.subscriptions);
      const isPlaceholder = (id: string | null | undefined) => !id || id === 'local';
      // A full UUID is a PRE-deriveSessionId legacy serverId. The current scheme
      // only mints the 12-char deriveSessionId hash or the 'local' sentinel, so a
      // UUID matches no live/paired server — it stranded local sessions on a dead
      // id (clicking → 403 peer_not_paired). Treat it as a placeholder so it
      // re-keys onto the active server, exactly like an empty/'local' id.
      const isLegacyUuid = (id: string | null | undefined) =>
        !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const needsMigration = oldEntries.some(
        ([key, entry]) =>
          isPlaceholder(entry.serverId) ||
          isLegacyUuid(entry.serverId) ||
          (!isPlaceholder(defaultServerId) && entry.serverId === 'local') ||
          !key.startsWith(`${entry.serverId}:`),
      );
      if (!needsMigration) return state;
      if (!defaultServerId) {
        // Can't migrate without a default; log once and leave entries as-is.
        // eslint-disable-next-line no-console
        console.warn('[subscriptionStore] legacy entries found but no active server to tag with — leaving untagged');
        return state;
      }
      const nextSubs: Record<string, SubscribedSession> = {};
      const oldToNewKey = new Map<string, string>();
      for (const [oldKey, entry] of oldEntries) {
        // Re-key empty/'local'/legacy-UUID entries onto the active server. A
        // legacy UUID always re-keys (it matches no live server regardless of
        // whether the active id is 'local' or a real hash).
        const serverId =
          !entry.serverId ||
          isLegacyUuid(entry.serverId) ||
          (entry.serverId === 'local' && defaultServerId !== 'local')
            ? defaultServerId
            : entry.serverId;
        const newKey = compositeKey(serverId, entry.project, entry.session);
        nextSubs[newKey] = { ...entry, serverId };
        oldToNewKey.set(oldKey, newKey);
      }
      const nextOrder = state.order.map((k) => oldToNewKey.get(k) ?? k);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSubs));
      localStorage.setItem(ORDER_KEY, JSON.stringify(nextOrder));
      return { subscriptions: nextSubs, order: nextOrder };
    });
  },
}));
