import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

export interface UIState {
  // Theme state
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // Panel visibility states
  sidebarVisible: boolean;
  setSidebarVisible: (visible: boolean) => void;
  toggleSidebar: () => void;

  sessionPanelVisible: boolean;
  setSessionPanelVisible: (visible: boolean) => void;
  toggleSessionPanel: () => void;

  // Split pane positions (stored as percentages)
  sidebarSplitPosition: number;
  setSidebarSplitPosition: (position: number) => void;

  sessionPanelSplitPosition: number;
  setSessionPanelSplitPosition: (position: number) => void;

  // Reset to defaults
  reset: () => void;
}

const DEFAULT_SIDEBAR_POSITION = 20;
const DEFAULT_SESSION_PANEL_POSITION = 20;

const getDefaultTheme = (): Theme => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  // Check system preference
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
};

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Theme state
      theme: getDefaultTheme(),
      setTheme: (theme: Theme) => set({ theme }),
      toggleTheme: () => {
        const current = get().theme;
        set({ theme: current === 'light' ? 'dark' : 'light' });
      },

      // Panel visibility states
      sidebarVisible: true,
      setSidebarVisible: (visible: boolean) => set({ sidebarVisible: visible }),
      toggleSidebar: () => {
        const current = get().sidebarVisible;
        set({ sidebarVisible: !current });
      },

      sessionPanelVisible: true,
      setSessionPanelVisible: (visible: boolean) => set({ sessionPanelVisible: visible }),
      toggleSessionPanel: () => {
        const current = get().sessionPanelVisible;
        set({ sessionPanelVisible: !current });
      },

      // Split pane positions
      sidebarSplitPosition: DEFAULT_SIDEBAR_POSITION,
      setSidebarSplitPosition: (position: number) => {
        // Clamp position between 10 and 50 percent
        const clamped = Math.max(10, Math.min(50, position));
        set({ sidebarSplitPosition: clamped });
      },

      sessionPanelSplitPosition: DEFAULT_SESSION_PANEL_POSITION,
      setSessionPanelSplitPosition: (position: number) => {
        // Clamp position between 10 and 50 percent
        const clamped = Math.max(10, Math.min(50, position));
        set({ sessionPanelSplitPosition: clamped });
      },

      // Reset to defaults
      reset: () =>
        set({
          theme: getDefaultTheme(),
          sidebarVisible: true,
          sessionPanelVisible: true,
          sidebarSplitPosition: DEFAULT_SIDEBAR_POSITION,
          sessionPanelSplitPosition: DEFAULT_SESSION_PANEL_POSITION,
        }),
    }),
    {
      name: 'ui-preferences', // localStorage key
      version: 1,
    }
  )
);
