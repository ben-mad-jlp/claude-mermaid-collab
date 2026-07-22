import { create } from 'zustand';
import { evictSessionItemsCache } from '@/lib/sessionItemsCache';

export interface SubscribedSession {
  serverId: string;
  /**
   * Host:port of the owning server, captured while `serverId` was valid. A
   * server's `serverId` is a random UUID minted on add, so removing and
   * re-adding the same machine yields a DIFFERENT id and orphans this
   * subscription (→ peer_not_paired). host:port is the stable identity we use to
   * retag the subscription onto the re-added server. Optional: legacy entries
   * (pre this field) have none and are retagged via the single-remote fallback.
   */
  serverHost?: string;
  serverPort?: number;
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
  ensureSubscribed: (key: string, opts: { serverId: string; project: string; session: string; status?: SubscribedSession['status']; lastUpdate?: number }) => void;
  unsubscribe: (key: string) => void;
  reorder: (order: string[]) => void;
  updateStatus: (serverId: string, claudeSessionId: string, status: string, project: string, session: string, claudePid?: number) => void;
  updateContextPercent: (serverId: string, project: string, session: string, pct: number) => void;
  migrateLegacyEntries: (defaultServerId: string | null) => void;
  reconcileServerIds: (servers: Array<{ id: string; host: string; port: number; source?: string }>) => void;
}

const STORAGE_KEY = 'session-subscriptions';
const ORDER_KEY = 'session-subscriptions-order';

/** Past this age a persisted/last-heard status is too old to trust as live. */
export const GONE_MS = 15 * 60_000;

/** Boot-hydration retention: entries silent past THIS are dropped at startup.
 *  Deliberately much longer than GONE_MS — GONE_MS is about trusting a STATUS,
 *  this is about keeping the card at all. A quiet-but-live session (user stepped
 *  away, daemon idle) must survive an app restart; a genuinely dead one ages out
 *  within two days because nothing refreshes its lastUpdate anymore (the
 *  connect-replay resurrection paths are fixed). */
export const HYDRATE_RETENTION_MS = 48 * 60 * 60_000;

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
      // DEAD entries don't hydrate. An entry silent past the retention window
      // accumulated across restarts into a Watching list of every session ever
      // seen (observed: 66 dead cards). Quiet-but-LIVE sessions survive (48h
      // retention); their status still degrades to stale/unknown via GONE_MS below.
      if (age > HYDRATE_RETENTION_MS) continue;
      // Status TRUST stays on the short window: a card older than GONE_MS keeps
      // its place in the list but reads gray 'unknown' until a live event lands.
      const lastKnown = VALID.has(v.status) && age <= GONE_MS ? v.status : 'unknown';
      const coerced = lastKnown === 'active' ? 'waiting' : lastKnown;
      out[k] = {
        serverId: typeof v.serverId === 'string' ? v.serverId : '',
        serverHost: typeof v.serverHost === 'string' ? v.serverHost : undefined,
        serverPort: typeof v.serverPort === 'number' ? v.serverPort : undefined,
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

// Hydrate once, then write the PRUNED result straight back so localStorage stops
// accumulating dead entries across restarts (the flood compounds otherwise).
const bootSubscriptions = hydrateSubscriptions();
const bootOrder: string[] = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') as string[];
    return raw.filter((k) => k in bootSubscriptions);
  } catch { return []; }
})();
try {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bootSubscriptions));
  localStorage.setItem(ORDER_KEY, JSON.stringify(bootOrder));
} catch { /* quota/SSR — persistence is best-effort */ }

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: bootSubscriptions,

  order: bootOrder,

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

  ensureSubscribed: (key, opts) => {
    set((state) => {
      if (state.subscriptions[key]) return state;
      const next = {
        ...state.subscriptions,
        [key]: {
          serverId: opts.serverId,
          project: opts.project,
          session: opts.session,
          status: opts.status ?? 'unknown',
          lastUpdate: opts.lastUpdate ?? Date.now(),
        },
      };
      const nextOrder = [...state.order, key];
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
      const needsMigration = oldEntries.some(
        ([key, entry]) =>
          isPlaceholder(entry.serverId) ||
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
        // Re-key 'local' entries when a real server id is available.
        const serverId =
          !entry.serverId || (entry.serverId === 'local' && defaultServerId !== 'local')
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

  /**
   * Keep subscriptions bound to the right server across remove/re-add. A server
   * id is a random UUID minted on add, so re-adding the same machine yields a new
   * id and strands every subscription on the dead id (→ peer_not_paired when the
   * row is clicked). Run on each server-list change:
   *
   *  1. BACKFILL — for a subscription whose serverId IS a known server, capture
   *     that server's host:port (its stable identity) so a LATER re-add can find
   *     it. This is how new orphans become self-healing.
   *  2. RETAG — for a subscription whose serverId is NOT known but whose captured
   *     host:port matches a current server, adopt that server's id (and re-key).
   *  3. LEGACY FALLBACK — a stranded subscription with no captured host:port
   *     (created before step 1 existed) can't be matched precisely; if there is
   *     exactly ONE remote (non-local) server it's unambiguous, so adopt it.
   *     Otherwise leave it (harmless; the user can re-subscribe).
   */
  reconcileServerIds: (servers) => {
    set((state) => {
      const byId = new Map(servers.map((s) => [s.id, s]));
      const byHostPort = new Map(servers.map((s) => [`${s.host}:${s.port}`, s]));
      const remotes = servers.filter((s) => s.source !== 'local');
      const soleRemote = remotes.length === 1 ? remotes[0] : null;

      let changed = false;
      const nextSubs: Record<string, SubscribedSession> = {};
      const oldToNewKey = new Map<string, string>();

      for (const [oldKey, entry] of Object.entries(state.subscriptions)) {
        let serverId = entry.serverId;
        let serverHost = entry.serverHost;
        let serverPort = entry.serverPort;

        const known = byId.get(serverId);
        if (known) {
          // (1) Backfill the stable identity while the id is valid.
          if (serverHost !== known.host || serverPort !== known.port) {
            serverHost = known.host;
            serverPort = known.port;
            changed = true;
          }
        } else if (serverId && serverId !== 'local') {
          // Stale id → try to resolve the current server.
          const match =
            // (2) precise: same host:port as captured.
            (serverHost != null && serverPort != null
              ? byHostPort.get(`${serverHost}:${serverPort}`)
              : undefined) ??
            // (3) legacy: no captured host:port + a single remote → adopt it.
            (serverHost == null ? soleRemote ?? undefined : undefined);
          if (match) {
            serverId = match.id;
            serverHost = match.host;
            serverPort = match.port;
            changed = true;
          }
        }

        const newKey = compositeKey(serverId, entry.project, entry.session);
        if (newKey !== oldKey) oldToNewKey.set(oldKey, newKey);
        // Last write wins if a retag collides with an existing key (same
        // project/session already on the new id) — acceptable dedupe.
        nextSubs[newKey] = { ...entry, serverId, serverHost, serverPort };
      }

      if (!changed) return state;
      const nextOrder = state.order.map((k) => oldToNewKey.get(k) ?? k);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSubs));
      localStorage.setItem(ORDER_KEY, JSON.stringify(nextOrder));
      return { subscriptions: nextSubs, order: nextOrder };
    });
  },
}));
