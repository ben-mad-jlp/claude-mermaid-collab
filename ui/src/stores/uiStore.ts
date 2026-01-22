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

  // Raw panel visibility
  rawVisible: boolean;
  setRawVisible: (visible: boolean) => void;
  toggleRaw: () => void;

  // Split pane positions (stored as percentages)
  sidebarSplitPosition: number;
  setSidebarSplitPosition: (position: number) => void;

  sessionPanelSplitPosition: number;
  setSessionPanelSplitPosition: (position: number) => void;

  // Editor split position
  editorSplitPosition: number;
  setEditorSplitPosition: (position: number) => void;

  // Zoom level
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;

  // Reset to defaults
  reset: () => void;
}

const DEFAULT_SIDEBAR_POSITION = 20;
const DEFAULT_SESSION_PANEL_POSITION = 20;
const DEFAULT_EDITOR_SPLIT_POSITION = 50;
const DEFAULT_ZOOM_LEVEL = 100;
const MIN_ZOOM_LEVEL = 25;
const MAX_ZOOM_LEVEL = 400;
const ZOOM_STEP = 25;

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

      // Raw panel visibility
      rawVisible: true,
      setRawVisible: (visible: boolean) => set({ rawVisible: visible }),
      toggleRaw: () => {
        const current = get().rawVisible;
        set({ rawVisible: !current });
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

      // Editor split position
      editorSplitPosition: DEFAULT_EDITOR_SPLIT_POSITION,
      setEditorSplitPosition: (position: number) => {
        // Clamp position between 10 and 90 percent
        const clamped = Math.max(10, Math.min(90, position));
        set({ editorSplitPosition: clamped });
      },

      // Zoom level
      zoomLevel: DEFAULT_ZOOM_LEVEL,
      setZoomLevel: (level: number) => {
        // Clamp level between MIN and MAX
        const clamped = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level));
        set({ zoomLevel: clamped });
      },
      zoomIn: () => {
        const current = get().zoomLevel;
        const newLevel = Math.min(MAX_ZOOM_LEVEL, current + ZOOM_STEP);
        set({ zoomLevel: newLevel });
      },
      zoomOut: () => {
        const current = get().zoomLevel;
        const newLevel = Math.max(MIN_ZOOM_LEVEL, current - ZOOM_STEP);
        set({ zoomLevel: newLevel });
      },

      // Reset to defaults
      reset: () =>
        set({
          theme: getDefaultTheme(),
          sidebarVisible: true,
          sessionPanelVisible: true,
          rawVisible: true,
          sidebarSplitPosition: DEFAULT_SIDEBAR_POSITION,
          sessionPanelSplitPosition: DEFAULT_SESSION_PANEL_POSITION,
          editorSplitPosition: DEFAULT_EDITOR_SPLIT_POSITION,
          zoomLevel: DEFAULT_ZOOM_LEVEL,
        }),
    }),
    {
      name: 'ui-preferences', // localStorage key
      version: 2,
    }
  )
);
