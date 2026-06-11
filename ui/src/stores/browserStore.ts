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
  /** Per-tab page zoom factor (1 = 100%), independent of the app/renderer zoom. */
  zoomByTab: Record<string, number>;
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
  toggleDevTools: (id: string) => void;
  /** Set the active tab's page zoom (independent of app zoom). Clamped in main. */
  setZoom: (id: string, factor: number) => Promise<void>;
  zoomIn: (id: string) => Promise<void>;
  zoomOut: (id: string) => Promise<void>;
  resetZoom: (id: string) => Promise<void>;
  activateSession: (session: string) => Promise<void>;
}

/** Page-zoom step + bounds for the embedded browser (mirrors the main-process clamp). */
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));

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
  zoomByTab: {},

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
  toggleDevTools: (id) => { bridge()?.devtools?.(id); },

  setZoom: async (id, factor) => {
    const next = clampZoom(factor);
    // Optimistic local update so the % reflects immediately; main re-clamps and
    // returns the truth, which we then store.
    set((s) => ({ zoomByTab: { ...s.zoomByTab, [id]: next } }));
    const applied = (await bridge()?.setZoom?.(id, next)) as number | undefined;
    if (typeof applied === 'number') set((s) => ({ zoomByTab: { ...s.zoomByTab, [id]: applied } }));
  },
  zoomIn: async (id) => { await get().setZoom(id, (get().zoomByTab[id] ?? 1) + ZOOM_STEP); },
  zoomOut: async (id) => { await get().setZoom(id, (get().zoomByTab[id] ?? 1) - ZOOM_STEP); },
  resetZoom: async (id) => { await get().setZoom(id, 1); },

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
