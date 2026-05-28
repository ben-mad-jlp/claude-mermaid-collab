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

export interface ServerInfo {
  id: string;
  label: string;
  host: string;
  port: number;
  status: 'online' | 'offline' | 'connecting';
  source: 'local' | 'manual';
  lastProject?: string;
  lastSession?: string;
  icon?: string;
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
  probeServer?(host: string, port: number): Promise<boolean>;
  setWatchedServers?(ids: string[]): Promise<void>;
  onWatchEvent?(cb: (e: WatchEvent) => void): () => void;
  /** Fetch a server's session list directly from main (no proxy / no active-server switch). */
  listSessionsForServer?(serverId: string): Promise<Array<{ project: string; name: string; displayName?: string }>>;
  /** Invoke an HTTP endpoint on a specific server (token resolved in main). */
  invokeOnServer?(
    serverId: string,
    opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> }
  ): Promise<{ ok: boolean; status: number; body: unknown }>;
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
  addServer: (opts: { label: string; host: string; port: number; token?: string }) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const mc = typeof window !== 'undefined' ? window.mc : undefined;
  const available = !!mc;
  const [servers, setServers] = useState<ServerInfo[]>([]);

  // Probe each server's reachability (main-process fetch — the renderer can't
  // cross-origin probe other servers) and update the status dots.
  const probe = useCallback(
    async (list: ServerInfo[]) => {
      if (!mc?.probeServer) return;
      const results = await Promise.all(
        list.map((s) => mc.probeServer!(s.host, s.port).catch(() => false))
      );
      setServers((prev) =>
        prev.map((s) => {
          const i = list.findIndex((x) => x.id === s.id);
          return i >= 0 ? { ...s, status: results[i] ? 'online' : 'offline' } : s;
        })
      );
    },
    [mc]
  );

  const refresh = useCallback(async () => {
    if (!mc) return;
    const list = await mc.listServers();
    setServers(list.map((s) => ({ ...s, status: 'connecting' })));
    void probe(list);
  }, [mc, probe]);

  useEffect(() => {
    void refresh();
    if (!mc?.probeServer) return;
    // Re-probe periodically so the dots stay accurate as servers come and go.
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [refresh, mc]);

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
      await refresh();
    },
    [mc, refresh]
  );

  const removeServer = useCallback(
    async (id: string) => {
      if (!mc) return;
      await mc.removeServer(id);
      await refresh();
    },
    [mc, refresh]
  );

  const value = useMemo<ServerContextValue>(
    () => ({ available, servers, refresh, addServer, removeServer }),
    [available, servers, refresh, addServer, removeServer]
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

const NO_PROVIDER: ServerContextValue = {
  available: false,
  servers: [],
  refresh: async () => {},
  addServer: async () => {},
  removeServer: async () => {},
};

/**
 * Returns the servers context. Falls back to an inert "unavailable"
 * value when no provider is mounted (e.g. routes that render the shared Header
 * outside the collab app), so consumers simply render nothing rather than throwing.
 */
export function useServers(): ServerContextValue {
  return useContext(ServerContext) ?? NO_PROVIDER;
}
