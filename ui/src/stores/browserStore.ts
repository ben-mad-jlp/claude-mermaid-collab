import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface BrowserTab {
  id: string;
  kind: 'session' | 'user';
  session?: string;
  url: string;
  title: string;
}

interface BrowserState {
  visible: boolean;
  tabs: BrowserTab[];
  activeId: string | null;
  width: number;
  toggle: () => void;
  show: () => void;
  hide: () => void;
  setWidth: (w: number) => void;
  refresh: () => Promise<void>;
  openUserTab: (url?: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  activateTab: (id: string) => void;
  navigate: (id: string, url: string) => Promise<void>;
  goBack: (id: string) => Promise<void>;
  goForward: (id: string) => Promise<void>;
  reload: (id: string) => Promise<void>;
  activateSession: (session: string) => Promise<void>;
}

const bridge = () => (window as any).mc?.browser;

/** Turn what the user typed into a navigable URL: pass through real URLs,
 *  prefix https:// for bare domains, else web-search the text. */
function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('about:') || s.startsWith('data:')) return s;
  if (/^[^\s.]+\.[^\s]{2,}/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

export const useBrowserStore = create<BrowserState>()(persist((set, get) => ({
  visible: false,
  tabs: [],
  activeId: null,
  width: 480,

  toggle: () => set((s) => ({ visible: !s.visible })),
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
  setWidth: (w) => set({ width: w }),

  refresh: async () => {
    if (!bridge()) return;
    const tabs = await bridge()?.listTabs?.() ?? [];
    set({ tabs });
  },

  openUserTab: async (url?) => {
    if (!bridge()) return;
    const r = await bridge()?.openTab?.({ url });
    await get().refresh();
    if (r?.id) get().activateTab(r.id);
  },

  closeTab: async (id) => {
    if (!bridge()) return;
    await bridge()?.closeTab?.(id);
    await get().refresh();
  },

  activateTab: (id) => {
    if (!bridge()) return;
    bridge()?.activateTab?.(id);
    set({ activeId: id, visible: true });
  },

  navigate: async (id, url) => {
    if (!bridge()) return;
    await bridge()?.navigate?.(id, normalizeUrl(url));
    await get().refresh(); // pick up the new url/title for the tab + address bar
  },

  goBack: async (id) => { if (!bridge()) return; await bridge()?.goBack?.(id); await get().refresh(); },
  goForward: async (id) => { if (!bridge()) return; await bridge()?.goForward?.(id); await get().refresh(); },
  reload: async (id) => { if (!bridge()) return; await bridge()?.reload?.(id); },

  activateSession: async (session) => {
    if (!bridge()) return;
    await get().refresh();
    const t = get().tabs.find((x) => x.session === session);
    if (t) get().activateTab(t.id);
  },
}), {
  name: 'browser-pane',
  // Persist only durable layout prefs; tabs are native views rebuilt via
  // refresh() on mount, so persisting them would be stale.
  partialize: (s) => ({ visible: s.visible, width: s.width }),
}));
