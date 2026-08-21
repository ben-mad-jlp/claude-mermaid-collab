/**
 * Thin multi-server context for the native app.
 *
 * The renderer enumerates known servers and probes their reachability via the
 * Electron main-process bridge. There is no single "active" server here —
 * callers address servers by id (e.g. via invokeOnServer / listSessionsForServer).
 * All `window.mc` access is guarded — in a plain browser tab (no Electron) the
 * provider is a no-op pass-through with no servers.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

export interface ServerInfo {
  id: string;
  label: string;
  host: string;
  port: number;
  // 'unauthorized': reachable but an authed endpoint 401'd — the saved token is
  // missing/wrong/undecryptable. Surfaced distinctly so the UI prompts a token
  // re-entry instead of implying the server is down.
  status: 'online' | 'offline' | 'connecting' | 'unauthorized';
  source: 'local' | 'manual';
  lastProject?: string;
  lastSession?: string;
  icon?: string;
  /** Trust state (P4a). A discovered instance is 'pending' until the user pairs it. */
  pairing?: 'pending' | 'paired';
}

export interface WatchEvent {
  serverId: string;
  type: string;
  project: string;
  session: string;
  status?: string;
  contextPercent?: number;
  claudeSessionId?: string;
  claudePid?: number;
  [k: string]: unknown;
}

export interface McBridge {
  listServers(): Promise<ServerInfo[]>;
  addServer(opts: { label: string; host: string; port: number; token?: string }): Promise<string>;
  removeServer(id: string): Promise<void>;
  /** Pair a pending server / unpair (DELETE) a paired one — returns the updated list (P4a). */
  pairServer?(id: string): Promise<ServerInfo[]>;
  unpairServer?(id: string): Promise<ServerInfo[]>;
  /** Set/clear a connection's bearer token (e.g. after a remote launch mints one). */
  setServerToken?(id: string, token: string | undefined): Promise<void>;
  probeServer?(host: string, port: number): Promise<'online' | 'offline' | 'unauthorized'>;
  setWatchedServers?(ids: string[]): Promise<void>;
  onWatchEvent?(cb: (e: WatchEvent) => void): () => void;
  /** Fetch a server's session list directly from main (no proxy / no active-server switch). */
  listSessionsForServer?(serverId: string): Promise<Array<{ project: string; name: string; displayName?: string }>>;
  /** Invoke an HTTP endpoint on a specific server (token resolved in main). */
  invokeOnServer?(
    serverId: string,
    opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> }
  ): Promise<{ ok: boolean; status: number; body: unknown }>;
  /** Push project-vocab words into the desktop spellchecker's custom dictionary (Electron only). */
  addSpellCheckWords?: (words: string[]) => void;
}

declare global {
  interface Window {
    mc?: McBridge;
  }
}

interface ServerContextValue {
  available: boolean; // true only in the Electron app (window.mc present)
  servers: ServerInfo[];
  refresh: () => Promise<void>;
  recheckServer: (id: string) => Promise<void>;
  addServer: (opts: { label: string; host: string; port: number; token?: string }) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  /** Pair a pending discovered server (no-op outside Electron). */
  pairServer: (id: string) => Promise<void>;
  /** Unpair (revoke trust + drop) a paired server (no-op outside Electron). */
  unpairServer: (id: string) => Promise<void>;
  /** Persist a bearer token onto an existing connection (no-op outside Electron). */
  setServerToken: (id: string, token: string | undefined) => Promise<void>;
  /** Gracefully shut down a remote server (POST /api/server/shutdown). No-op outside Electron. */
  stopServer: (id: string) => Promise<void>;
}

const ServerContext = createContext<ServerContextValue | null>(null);

/**
 * In a plain browser tab (no Electron `window.mc`) there is no multi-server
 * registry, but the page is still served by a single local backend (directly,
 * or via the vite dev proxy). Seed a synthetic `local` server so the session/
 * project create dialogs have something to address; apiFetch routes its calls
 * to `/srv/local/...` against the page origin, which the backend (or the vite
 * `/srv` proxy in dev) resolves.
 */
function browserLocalServer(): ServerInfo {
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  return {
    id: 'local',
    label: 'Local',
    host: loc?.hostname || 'localhost',
    port: loc?.port ? Number(loc.port) : 9002,
    status: 'online',
    source: 'local',
  };
}

/**
 * After a server entry is deleted, find the entry in the post-delete list that
 * represents the SAME machine, so its watching-list subscriptions can move over
 * instead of stranding on the dead id. Same host:port is conclusive; otherwise a
 * label carried by exactly one survivor (the machine re-paired on another port)
 * is enough. Anything ambiguous yields undefined — no guessing.
 */
function findSurvivor(deleted: ServerInfo | undefined, fresh: ServerInfo[], removedId: string): ServerInfo | undefined {
  if (!deleted) return undefined;
  const precise = fresh.find((s) => s.host === deleted.host && s.port === deleted.port && s.id !== removedId);
  if (precise) return precise;
  const byLabel = fresh.filter((s) => s.label === deleted.label && s.id !== removedId);
  return byLabel.length === 1 ? byLabel[0] : undefined;
}

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const mc = typeof window !== 'undefined' ? window.mc : undefined;
  const available = !!mc;
  // Native shell: start empty and hydrate from the bridge. Browser: a single
  // synthetic local server (the bridge never populates the list).
  const [servers, setServers] = useState<ServerInfo[]>(() => (mc ? [] : [browserLocalServer()]));

  // Probe each server's reachability (main-process fetch — the renderer can't
  // cross-origin probe other servers) and update the status dots.
  const probe = useCallback(
    async (list: ServerInfo[]) => {
      if (!mc?.probeServer) return;
      const results = await Promise.all(
        list.map((s) => mc.probeServer!(s.host, s.port).catch(() => 'offline' as const))
      );
      setServers((prev) =>
        prev.map((s) => {
          const i = list.findIndex((x) => x.id === s.id);
          return i >= 0 ? { ...s, status: results[i] } : s;
        })
      );
    },
    [mc]
  );

  // Reload the registry AND hand the caller the fresh list. `servers` state is
  // not readable synchronously after setServers, and the delete-with-replacement
  // path has to inspect the post-delete list to find the survivor.
  const refreshList = useCallback(async (): Promise<ServerInfo[]> => {
    if (!mc) return [];
    const list = await mc.listServers();
    setServers(list.map((s) => ({ ...s, status: 'connecting' })));
    void probe(list);
    return list;
  }, [mc, probe]);

  const refresh = useCallback(async () => {
    await refreshList();
  }, [refreshList]);

  // Re-probe a SINGLE server on demand (per-server "recheck" button). Updates
  // only that server's dot in place — no global 'connecting' reset — so it can
  // never deselect the session the user is currently browsing.
  const recheckServer = useCallback(
    async (id: string) => {
      if (!mc?.probeServer) return;
      const target = servers.find((s) => s.id === id);
      if (!target) return;
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'connecting' } : s)));
      const status = await mc.probeServer(target.host, target.port).catch(() => 'offline' as const);
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    },
    [mc, servers]
  );

  // Probe once on load only. We intentionally do NOT poll on an interval:
  // a periodic re-probe flips a momentarily-unreachable server's dot to
  // 'offline', which deselects the session being browsed. Use recheckServer.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mc]);

  // Once the session store has rehydrated AND we've loaded the server list at
  // least once, validate the persisted currentSession against the known servers.
  // If its server is gone (or never existed), validateAgainstServers clears it
  // and the normal empty-session UI takes over. We track the last validated
  // snapshot by stringified ids so we don't re-run for identical lists.
  const lastValidatedRef = useRef<string | null>(null);
  const loadedOnceRef = useRef(false);
  useEffect(() => {
    if (servers.length > 0) loadedOnceRef.current = true;
  }, [servers]);
  useEffect(() => {
    if (!loadedOnceRef.current) return;
    const { hydrated, validateAgainstServers } = useSessionStore.getState();
    if (!hydrated) return;
    const key = servers.map((s) => `${s.id}:${s.status}`).sort().join('|');
    if (lastValidatedRef.current === key) return;
    lastValidatedRef.current = key;
    // Retag watching-list subscriptions onto the current server ids BEFORE
    // validating the session — a server removed and re-added gets a new id, and
    // without this the persisted subscription stays bound to the dead id and
    // clicking it 403s with peer_not_paired. This covers the re-add-LATER case
    // (match by captured host:port, else by an unambiguous label); the
    // delete-while-a-replacement-already-exists case is handled eagerly by
    // migrateServerId in removeServer/unpairServer.
    useSubscriptionStore.getState().reconcileServerIds(servers);
    validateAgainstServers(servers);
  }, [servers]);
  // Also re-check when hydration flips to true after the first server-list load.
  useEffect(() => {
    const unsub = useSessionStore.subscribe((state, prev) => {
      if (state.hydrated && !prev.hydrated && loadedOnceRef.current) {
        lastValidatedRef.current = null; // force re-validate on next servers tick
        state.validateAgainstServers(servers);
        lastValidatedRef.current = servers.map((s) => `${s.id}:${s.status}`).sort().join('|');
      }
    });
    return unsub;
  }, [servers]);

  const addServer = useCallback(
    async (opts: { label: string; host: string; port: number; token?: string }) => {
      if (!mc) return;
      await mc.addServer(opts);
      // The label-aware reconcileServerIds in the servers effect adopts any
      // subscription stranded by an earlier delete of this same machine.
      await refreshList();
    },
    [mc, refreshList]
  );

  const removeServer = useCallback(
    async (id: string) => {
      if (!mc) return;
      const deleted = servers.find((s) => s.id === id);
      await mc.removeServer(id);
      const fresh = await refreshList();
      const survivor = findSurvivor(deleted, fresh, id);
      if (survivor) {
        useSubscriptionStore
          .getState()
          .migrateServerId(id, survivor.id, { host: survivor.host, port: survivor.port, label: survivor.label });
      }
    },
    [mc, servers, refreshList]
  );

  const pairServer = useCallback(
    async (id: string) => {
      if (!mc?.pairServer) return;
      await mc.pairServer(id);
      await refresh();
    },
    [mc, refresh]
  );

  const unpairServer = useCallback(
    async (id: string) => {
      if (!mc?.unpairServer) return;
      const deleted = servers.find((s) => s.id === id);
      await mc.unpairServer(id);
      const fresh = await refreshList();
      const survivor = findSurvivor(deleted, fresh, id);
      if (survivor) {
        useSubscriptionStore
          .getState()
          .migrateServerId(id, survivor.id, { host: survivor.host, port: survivor.port, label: survivor.label });
      }
    },
    [mc, servers, refreshList]
  );

  const setServerToken = useCallback(
    async (id: string, token: string | undefined) => {
      if (!mc?.setServerToken) return;
      await mc.setServerToken(id, token);
    },
    [mc]
  );

  // Ask a server to shut itself down. The button is only shown when the dot is
  // green (so /api/health — and thus this authenticated call — is reachable);
  // invokeOnServer resolves the stored bearer token in main. We optimistically
  // flip the dot offline, then recheck once to confirm it actually went down.
  const stopServer = useCallback(
    async (id: string) => {
      if (!mc?.invokeOnServer) return;
      await mc.invokeOnServer(id, { path: '/api/server/shutdown', method: 'POST' });
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'offline' } : s)));
      setTimeout(() => { void recheckServer(id); }, 1500);
    },
    [mc, recheckServer]
  );

  const value = useMemo<ServerContextValue>(
    () => ({ available, servers, refresh, recheckServer, addServer, removeServer, pairServer, unpairServer, setServerToken, stopServer }),
    [available, servers, refresh, recheckServer, addServer, removeServer, pairServer, unpairServer, setServerToken, stopServer]
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

const NO_PROVIDER: ServerContextValue = {
  available: false,
  servers: [],
  refresh: async () => {},
  recheckServer: async () => {},
  addServer: async () => {},
  removeServer: async () => {},
  pairServer: async () => {},
  unpairServer: async () => {},
  setServerToken: async () => {},
  stopServer: async () => {},
};

/**
 * Returns the servers context. Falls back to an inert "unavailable"
 * value when no provider is mounted (e.g. routes that render the shared Header
 * outside the collab app), so consumers simply render nothing rather than throwing.
 */
export function useServers(): ServerContextValue {
  return useContext(ServerContext) ?? NO_PROVIDER;
}
