import { create } from 'zustand';
import { evictSessionItemsCache } from '@/lib/sessionItemsCache';

interface SubscribedSession {
  serverId: string;
  project: string;
  session: string;
  claudeSessionId?: string;
  claudePid?: number;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
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

const compositeKey = (serverId: string, project: string, session: string) => `${serverId}:${project}:${session}`;

/**
 * Hydrate raw localStorage payload. Legacy entries (pre-cross-server-watch)
 * were keyed by `${project}:${session}` and had no `serverId` field. We do NOT
 * drop them — they get silently tagged with the boot-time active server's id
 * via `migrateLegacyEntries`, called once from App.tsx after `mc.getActiveServer()`
 * resolves. Until then they sit in the map with empty `serverId` and the
 * old-style key; they don't crash but won't receive aggregator updates
 * (which now require a matching serverId).
 */
function hydrateSubscriptions(): Record<string, SubscribedSession> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, any>;
    const out: Record<string, SubscribedSession> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = {
        serverId: typeof v.serverId === 'string' ? v.serverId : '',
        project: v.project,
        session: v.session,
        claudeSessionId: v.claudeSessionId,
        claudePid: v.claudePid,
        status: v.status ?? 'unknown',
        lastUpdate: v.lastUpdate ?? Date.now(),
        contextPercent: v.contextPercent,
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
      const next = { ...state.subscriptions, [key]: { ...existing, claudeSessionId, status: newStatus, lastUpdate, ...pidUpdate } };
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
      const needsMigration = oldEntries.some(([key, entry]) => !entry.serverId || !key.startsWith(`${entry.serverId}:`));
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
        const serverId = entry.serverId || defaultServerId;
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
