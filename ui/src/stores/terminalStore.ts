import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useNotificationStore } from './notificationStore';

export interface TerminalTab {
  id: string;
  /** Display label (defaults to the session name; may be overridden). */
  title: string;
  /** The collab session name — stable identity for dedup, distinct from title. */
  session: string;
  project: string;
  tmuxName: string;
  serverId: string;
  serverLabel: string;
  /** Hide the per-server icon chip on this tab. */
  hideServerIcon?: boolean;
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
  /** Reorder tabs by moving the dragged tab to the dropped tab's position. */
  moveTab: (dragId: string, dropId: string) => void;
  openFor: (
    project: string,
    session: string,
    opts: { serverId: string; serverLabel?: string; title?: string; hideServerIcon?: boolean }
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

  moveTab: (dragId, dropId) => {
    if (dragId === dropId) return;
    set((s) => {
      const from = s.tabs.findIndex((t) => t.id === dragId);
      const to = s.tabs.findIndex((t) => t.id === dropId);
      if (from === -1 || to === -1) return s;
      const next = [...s.tabs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { tabs: next };
    });
  },

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
    // Dedup against (serverId, project, session) — the same session NAME under
    // a different project (e.g. a supervised "supervisor" worker vs the actual
    // supervisor session) or on a different server is a distinct tab. Match on
    // the stable session identity, not the (possibly overridden) display title.
    const existing = get().tabs.find(
      (t) => t.session === session && t.serverId === serverId && t.project === project,
    );
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
      let data: { id?: string; tmuxSession?: string; error?: string; code?: string };
      let ok: boolean;
      if (mc?.invokeOnServer) {
        const env = await mc.invokeOnServer(serverId, {
          path: '/api/terminal/sessions',
          method: 'POST',
          body: { project, session },
        });
        ok = !!env.ok;
        data = (typeof env.body === 'object' && env.body ? env.body : { error: String(env.body ?? env.status) }) as typeof data;
      } else {
        // Plain-browser fallback (dev / tests): legacy relative URL.
        const res = await fetch('/api/terminal/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project, session }),
        });
        ok = res.ok;
        data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      }
      if (!ok || !data.id) {
        // Surface server-side failures (notably tmux-unavailable) instead of
        // opening a dead pane. The terminal needs tmux on the server; a missing
        // binary used to fail silently and leave the user staring at nothing.
        const isTmux = data.code === 'tmux-unavailable';
        useNotificationStore.getState().addToast({
          type: 'error',
          title: isTmux ? 'Terminal unavailable' : 'Could not open terminal',
          message: data.error ?? 'The server could not start a terminal session.',
          duration: isTmux ? 10000 : 6000,
        });
        return;
      }
      const newTab: TerminalTab = {
        id: data.id,
        title: opts.title ?? session,
        session,
        project,
        tmuxName: data.tmuxSession ?? '',
        serverId,
        serverLabel,
        hideServerIcon: opts.hideServerIcon,
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
