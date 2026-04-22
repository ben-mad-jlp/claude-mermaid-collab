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

  // Edit mode visibility
  editMode: boolean;
  setEditMode: (mode: boolean) => void;
  toggleEditMode: () => void;

  // Document inline edit toggle (guards against accidental edits during review).
  // When false: MilkdownEditor is read-only. When true: editable.
  documentEditable: boolean;
  setDocumentEditable: (editable: boolean) => void;
  toggleDocumentEditable: () => void;

  codeFirstView: boolean;
  setCodeFirstView: (v: boolean) => void;
  toggleCodeFirstView: () => void;

  // Agent chat panel visibility
  agentChatVisible: boolean;
  setAgentChatVisible: (visible: boolean) => void;
  toggleAgentChat: () => void;

  // Migration banner v5 dismissal flag
  seenMigrationBannerV5: boolean;
  setSeenMigrationBannerV5: (seen: boolean) => void;
  dismissMigrationBannerV5: () => void;

  pairMode: boolean;
  setPairMode: (on: boolean) => void;
  togglePairMode: () => void;
  proposedEditObserveMode: boolean;
  setProposedEditObserveMode: (on: boolean) => void;

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

      // Edit mode visibility
      editMode: true,
      setEditMode: (mode: boolean) => set({ editMode: mode }),
      toggleEditMode: () => {
        const current = get().editMode;
        set({ editMode: !current });
      },

      // Document inline edit — defaults to read-only (review mode)
      documentEditable: false,
      setDocumentEditable: (editable: boolean) => set({ documentEditable: editable }),
      toggleDocumentEditable: () => {
        const current = get().documentEditable;
        set({ documentEditable: !current });
      },

      codeFirstView: true,
      setCodeFirstView: (v: boolean) => set({ codeFirstView: v }),
      toggleCodeFirstView: () => {
        const current = get().codeFirstView;
        set({ codeFirstView: !current });
      },

      // Agent chat panel (default visible — primary interaction surface)
      agentChatVisible: true,
      setAgentChatVisible: (visible: boolean) => set({ agentChatVisible: visible }),
      toggleAgentChat: () => {
        const current = get().agentChatVisible;
        set({ agentChatVisible: !current });
      },

      // Migration banner v5
      seenMigrationBannerV5: false,
      setSeenMigrationBannerV5: (seen: boolean) => set({ seenMigrationBannerV5: seen }),
      dismissMigrationBannerV5: () => set({ seenMigrationBannerV5: true }),

      pairMode: false,
      setPairMode: (on: boolean) => set({ pairMode: on }),
      togglePairMode: () => { const current = get().pairMode; set({ pairMode: !current }); },
      proposedEditObserveMode: false,
      setProposedEditObserveMode: (on: boolean) => set({ proposedEditObserveMode: on }),

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
        const clamped = Math.max(20, Math.min(80, position));
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
          editMode: true,
          codeFirstView: true,
          agentChatVisible: true,
          seenMigrationBannerV5: false,
          pairMode: false,
          proposedEditObserveMode: false,
          sidebarSplitPosition: DEFAULT_SIDEBAR_POSITION,
          sessionPanelSplitPosition: DEFAULT_SESSION_PANEL_POSITION,
          editorSplitPosition: DEFAULT_EDITOR_SPLIT_POSITION,
          zoomLevel: DEFAULT_ZOOM_LEVEL,
        }),
    }),
    {
      name: 'ui-preferences', // localStorage key
      version: 6,
      migrate: (persistedState: unknown, version: number) => {
        // v5: terminal/shell removed entirely. Drop legacy panel flags and
        // default agentChatVisible to true so chat is visible by default.
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState as UIState;
        }
        if (version < 5) {
          const old = persistedState as Record<string, unknown>;
          const {
            terminalPanelVisible: _tpv,
            shellDrawerVisible: _sdv,
            chatPanelVisible: _cpv,
            ...rest
          } = old;
          return {
            ...rest,
            agentChatVisible: true,
            seenMigrationBannerV5:
              typeof old.seenMigrationBannerV5 === 'boolean' ? old.seenMigrationBannerV5 : false,
            pairMode: false,
            proposedEditObserveMode: false,
          } as UIState;
        }
        if (version < 6) {
          const old = persistedState as Record<string, unknown>;
          return { ...old, pairMode: false, proposedEditObserveMode: false } as UIState;
        }
        return persistedState as UIState;
      },
    }
  )
);

if (typeof window !== 'undefined') {
  (window as unknown as { __UI_STORE__: typeof useUIStore }).__UI_STORE__ = useUIStore;
}
