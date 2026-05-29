import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TerminalTab {
  id: string;
  title: string;
  tmuxName: string;
  serverId: string;
  serverLabel: string;
}

interface TerminalState {
  open: boolean;
  tabs: TerminalTab[];
  activeTabId: string | null;
  width: number;
  toggle: () => void;
  openDrawer: () => void;
  close: () => void;
  setWidth: (w: number) => void;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  openFor: (
    project: string,
    session: string,
    opts: { serverId: string; serverLabel?: string }
  ) => Promise<void>;
}

// Sessions currently being created via openFor — guards against duplicate PTYs
// when openFor is called twice in quick succession (the dedup-by-title check
// happens before the awaited fetch resolves). Keyed by serverId|project|session
// so the same session name on different servers doesn't collide.
const openingSessions = new Set<string>();

interface McBridge {
  invokeOnServer?: (
    serverId: string,
    opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> }
  ) => Promise<{ ok: boolean; status: number; body: unknown }>;
}

function getMc(): McBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { mc?: McBridge }).mc ?? null;
}

export const useTerminalStore = create<TerminalState>()(persist((set, get) => ({
  open: false,
  tabs: [],
  activeTabId: null,
  width: 480,

  toggle: () => set((s) => ({ open: !s.open })),
  openDrawer: () => set({ open: true }),
  close: () => set({ open: false }),
  setWidth: (w) => set({ width: w }),

  setActive: (id) => set({ activeTabId: id }),

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const closing = tabs.find((t) => t.id === id);
    const remaining = tabs.filter((t) => t.id !== id);
    let nextActiveId = activeTabId;
    if (activeTabId === id) {
      nextActiveId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }
    set({
      tabs: remaining,
      activeTabId: nextActiveId,
      open: remaining.length > 0 ? get().open : false,
    });
    // Best-effort upstream cleanup — don't block UI on it.
    if (closing) {
      const mc = getMc();
      if (mc?.invokeOnServer) {
        void mc
          .invokeOnServer(closing.serverId, {
            path: `/api/terminal/sessions/${encodeURIComponent(closing.id)}`,
            method: 'DELETE',
          })
          .catch(() => { /* ignore */ });
      } else if (typeof fetch !== 'undefined') {
        void fetch(`/api/terminal/sessions/${encodeURIComponent(closing.id)}`, { method: 'DELETE' }).catch(
          () => { /* ignore */ }
        );
      }
    }
  },

  openFor: async (project, session, opts) => {
    const serverId = opts.serverId;
    const serverLabel = opts.serverLabel ?? '(unknown)';
    // Dedup against (serverId, title) — same session name on a different
    // server is a distinct tab.
    const existing = get().tabs.find((t) => t.title === session && t.serverId === serverId);
    if (existing) {
      set({ activeTabId: existing.id, open: true });
      return;
    }
    const key = `${serverId}|${project}|${session}`;
    if (openingSessions.has(key)) {
      set({ open: true });
      return;
    }
    openingSessions.add(key);
    try {
      const mc = getMc();
      let data: { id: string; tmuxSession: string };
      if (mc?.invokeOnServer) {
        const env = await mc.invokeOnServer(serverId, {
          path: '/api/terminal/sessions',
          method: 'POST',
          body: { project, session },
        });
        if (!env.ok || !env.body) {
          throw new Error(
            typeof env.body === 'string' ? env.body : JSON.stringify(env.body ?? { status: env.status })
          );
        }
        data = env.body as { id: string; tmuxSession: string };
      } else {
        // Plain-browser fallback (dev / tests): legacy relative URL.
        const res = await fetch('/api/terminal/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project, session }),
        });
        data = await res.json();
      }
      const newTab: TerminalTab = {
        id: data.id,
        title: session,
        tmuxName: data.tmuxSession,
        serverId,
        serverLabel,
      };
      set((s) => ({
        tabs: [...s.tabs, newTab],
        activeTabId: data.id,
        open: true,
      }));
    } catch (err) {
      // Swallow after logging — callers fire-and-forget (`void openFor(...)`),
      // so rethrowing would surface as an unhandledrejection. The console
      // trace is the diagnostic path.
      console.error('[terminalStore.openFor] failed', err);
    } finally {
      openingSessions.delete(key);
    }
  },
}), {
  name: 'terminal-pane',
  // Persist only durable layout prefs; tabs are tmux-backed and rebuilt on
  // demand, so persisting them would be stale after a reload.
  partialize: (s) => ({ open: s.open, width: s.width }),
}));
