import { create } from 'zustand';

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
  activateSession: (session: string) => Promise<void>;
}

const bridge = () => (window as any).mc?.browser;

export const useBrowserStore = create<BrowserState>((set, get) => ({
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
    await bridge()?.navigate?.(id, url);
  },

  activateSession: async (session) => {
    if (!bridge()) return;
    await get().refresh();
    const t = get().tabs.find((x) => x.session === session);
    if (t) get().activateTab(t.id);
  },
}));
