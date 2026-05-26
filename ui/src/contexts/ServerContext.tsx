/**
 * Thin active-server context for the native app's server switcher.
 *
 * The renderer always talks to a single origin (the Electron main-process proxy),
 * so switching servers is just: tell main to repoint the proxy, reset the WS
 * singleton, and remount the app subtree so it refetches against the new upstream.
 * All `window.mc` access is guarded — in a plain browser tab (no Electron) the
 * provider is a no-op pass-through with no servers.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { resetWebSocketClient } from '@/lib/websocket';

export interface ServerInfo {
  id: string;
  label: string;
  host: string;
  port: number;
  status: 'online' | 'offline' | 'connecting';
  source: 'local' | 'manual';
  lastProject?: string;
  lastSession?: string;
}

export interface McBridge {
  listServers(): Promise<ServerInfo[]>;
  getActiveServer(): Promise<string | null>;
  switchServer(id: string): Promise<{ ok: boolean }>;
  addServer(opts: { label: string; host: string; port: number; token?: string }): Promise<string>;
  removeServer(id: string): Promise<void>;
}

declare global {
  interface Window {
    mc?: McBridge;
  }
}

interface ServerContextValue {
  available: boolean; // true only in the Electron app (window.mc present)
  servers: ServerInfo[];
  activeId: string | null;
  refresh: () => Promise<void>;
  switchServer: (id: string) => Promise<void>;
  addServer: (opts: { label: string; host: string; port: number; token?: string }) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const mc = typeof window !== 'undefined' ? window.mc : undefined;
  const available = !!mc;
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to remount the subtree

  const refresh = useCallback(async () => {
    if (!mc) return;
    const [list, active] = await Promise.all([mc.listServers(), mc.getActiveServer()]);
    setServers(list);
    setActiveId(active);
  }, [mc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchServer = useCallback(
    async (id: string) => {
      if (!mc) return;
      const res = await mc.switchServer(id);
      if (!res.ok) return;
      resetWebSocketClient(); // next getWebSocketClient() reconnects through the repointed proxy
      setActiveId(id);
      setVersion((v) => v + 1); // remount so collab views refetch against the new upstream
    },
    [mc]
  );

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
    () => ({ available, servers, activeId, refresh, switchServer, addServer, removeServer }),
    [available, servers, activeId, refresh, switchServer, addServer, removeServer]
  );

  return (
    <ServerContext.Provider value={value}>
      <React.Fragment key={version}>{children}</React.Fragment>
    </ServerContext.Provider>
  );
}

const NO_PROVIDER: ServerContextValue = {
  available: false,
  servers: [],
  activeId: null,
  refresh: async () => {},
  switchServer: async () => {},
  addServer: async () => {},
  removeServer: async () => {},
};

/**
 * Returns the active-server context. Falls back to an inert "unavailable"
 * value when no provider is mounted (e.g. routes that render the shared Header
 * outside the collab app), so consumers like ServerSwitcher simply render
 * nothing rather than throwing.
 */
export function useServer(): ServerContextValue {
  return useContext(ServerContext) ?? NO_PROVIDER;
}
