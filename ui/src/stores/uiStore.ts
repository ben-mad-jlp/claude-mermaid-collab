import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'sepia';

// PCS Phase 5: which role-scoped view the supervisor surface renders.
export type SupervisorRole = 'supervisor' | 'planner' | 'coordinator';

// Control-UI vision §2: the top-level mode model. Studio = single-session
// cockpit (today's simple surface), Bridge = fleet command center (today's
// SupervisorView for now), Plan = roadmap/work-graph surface (stub for now).
export type UIMode = 'studio' | 'bridge' | 'plan';

// Workspace panes that dock side-by-side in one reorderable row. Bridge/Plan/
// Studio/Spec are PanelGroup panes; Browser/Terminal fold into the same row so
// every header toggle can be dragged to reorder. `studio` = the artifact viewer
// (viewerVisible), `spec` = the project Spec Sheet, `browser`/`terminal` carry
// their own visibility flags (browserStore.visible / terminalStore.open).
export type PaneKey = 'bridge' | 'plan' | 'studio' | 'spec' | 'browser' | 'terminal';
export const ALL_PANE_KEYS: PaneKey[] = ['bridge', 'plan', 'studio', 'spec', 'browser', 'terminal'];

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

  // Artifact viewer (the main center editor) visibility. Hiding it lets the
  // browser pane take the full width; selecting an artifact re-shows it.
  viewerVisible: boolean;
  setViewerVisible: (visible: boolean) => void;
  toggleViewer: () => void;

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

  // Control-UI vision §2: the top-level mode discriminant. Retained for back-compat
  // (some code reads/sets it); setMode now also OPENS the matching workspace pane.
  mode: UIMode;
  setMode: (mode: UIMode) => void;

  // Workspace panes (the new model): Bridge / Plan / Studio are independent
  // TOGGLES that dock side-by-side — any combination can be open at once (Studio
  // is the artifact viewer, i.e. `viewerVisible`). `paneOrder` is their left→right
  // order (for future drag-reorder).
  bridgeOpen: boolean;
  planOpen: boolean;
  specOpen: boolean;
  setBridgeOpen: (open: boolean) => void;
  setPlanOpen: (open: boolean) => void;
  setSpecOpen: (open: boolean) => void;
  toggleBridge: () => void;
  togglePlan: () => void;
  toggleSpec: () => void;
  paneOrder: PaneKey[];
  setPaneOrder: (order: PaneKey[]) => void;

  // CUI-6: per-mode sticky editor split. Each mode remembers its own split so
  // diving Studio ↔ Bridge ↔ Plan doesn't reset the user's layout.
  modeSplit: Record<UIMode, number>;
  setModeSplit: (mode: UIMode, position: number) => void;

  // PCS Phase 5: role-scoped view discriminant (Supervisor | Planner | Coordinator).
  supervisorRole: SupervisorRole;
  setSupervisorRole: (role: SupervisorRole) => void;

  // PCS Phase 5: the project that drives the project-scoped sections (Plan,
  // Sessions/Workers, scoped Escalations, Artifacts). Independent of the
  // current session — defaults to the current session's project on first load,
  // user-controlled thereafter. null = fall back to current session's project.
  activeProject: string | null;
  setActiveProject: (project: string | null) => void;

  // SupervisorPanel per-project group collapse state. Keyed by project path;
  // true = collapsed. Persisted (plain object, JSON-safe) so the expanded/
  // collapsed shape of the supervised list survives reloads.
  supervisorCollapsedProjects: Record<string, boolean>;
  toggleSupervisorProject: (project: string) => void;

  // Diff view preference: side-by-side (true) or unified (false)
  diffSideBySide: boolean;
  setDiffSideBySide: (on: boolean) => void;

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

  // Document conflict state (incoming remote change vs local)
  documentConflict: { docId: string; incomingContent: string } | null;
  setDocumentConflict: (conflict: { docId: string; incomingContent: string } | null) => void;

  // Reset to defaults
  reset: () => void;
}

const DEFAULT_SIDEBAR_POSITION = 20;
const DEFAULT_SESSION_PANEL_POSITION = 20;
const DEFAULT_EDITOR_SPLIT_POSITION = 50;
const DEFAULT_ZOOM_LEVEL = 100;
const MIN_ZOOM_LEVEL = 60;
const MAX_ZOOM_LEVEL = 160;
const ZOOM_STEP = 10;

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
        const next: Theme = current === 'light' ? 'dark' : current === 'dark' ? 'sepia' : 'light';
        set({ theme: next });
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

      // Artifact viewer (main center editor) visibility
      viewerVisible: true,
      setViewerVisible: (visible: boolean) => set({ viewerVisible: visible }),
      toggleViewer: () => set({ viewerVisible: !get().viewerVisible }),

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

      mode: 'studio',
      // setMode now also opens the matching pane (so legacy "go to bridge" calls,
      // e.g. the CommandBarBadge, surface the Bridge pane).
      setMode: (mode: UIMode) =>
        set(
          mode === 'bridge'
            ? { mode, bridgeOpen: true }
            : mode === 'plan'
              ? { mode, planOpen: true }
              : { mode, viewerVisible: true },
        ),

      // Workspace panes — Bridge open by default; Studio = viewerVisible.
      bridgeOpen: true,
      planOpen: false,
      specOpen: false,
      setBridgeOpen: (open: boolean) => set({ bridgeOpen: open }),
      setPlanOpen: (open: boolean) => set({ planOpen: open }),
      setSpecOpen: (open: boolean) => set({ specOpen: open }),
      toggleBridge: () => set((s) => ({ bridgeOpen: !s.bridgeOpen })),
      togglePlan: () => set((s) => ({ planOpen: !s.planOpen })),
      toggleSpec: () => set((s) => ({ specOpen: !s.specOpen })),
      paneOrder: [...ALL_PANE_KEYS],
      setPaneOrder: (order) => set({ paneOrder: order }),

      modeSplit: { studio: DEFAULT_EDITOR_SPLIT_POSITION, bridge: DEFAULT_EDITOR_SPLIT_POSITION, plan: DEFAULT_EDITOR_SPLIT_POSITION },
      setModeSplit: (mode: UIMode, position: number) => {
        const clamped = Math.max(20, Math.min(80, position));
        set((state) => ({ modeSplit: { ...state.modeSplit, [mode]: clamped } }));
      },

      supervisorRole: 'supervisor',
      setSupervisorRole: (role: SupervisorRole) => set({ supervisorRole: role }),

      activeProject: null,
      setActiveProject: (project: string | null) => set({ activeProject: project }),

      supervisorCollapsedProjects: {},
      toggleSupervisorProject: (project: string) =>
        set((s) => ({
          supervisorCollapsedProjects: {
            ...s.supervisorCollapsedProjects,
            [project]: !s.supervisorCollapsedProjects[project],
          },
        })),

      diffSideBySide: true,
      setDiffSideBySide: (on: boolean) => set({ diffSideBySide: on }),

      documentConflict: null,
      setDocumentConflict: (conflict: { docId: string; incomingContent: string } | null) =>
        set({ documentConflict: conflict }),

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
          viewerVisible: true,
          codeFirstView: true,
          agentChatVisible: true,
          seenMigrationBannerV5: false,
          pairMode: false,
          proposedEditObserveMode: false,
          diffSideBySide: true,
          mode: 'studio',
          modeSplit: { studio: DEFAULT_EDITOR_SPLIT_POSITION, bridge: DEFAULT_EDITOR_SPLIT_POSITION, plan: DEFAULT_EDITOR_SPLIT_POSITION },
          sidebarSplitPosition: DEFAULT_SIDEBAR_POSITION,
          sessionPanelSplitPosition: DEFAULT_SESSION_PANEL_POSITION,
          editorSplitPosition: DEFAULT_EDITOR_SPLIT_POSITION,
          zoomLevel: DEFAULT_ZOOM_LEVEL,
        }),
    }),
    {
      name: 'ui-preferences', // localStorage key
      version: 11,
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
            diffSideBySide: true,
          } as UIState;
        }
        if (version < 6) {
          const old = persistedState as Record<string, unknown>;
          return { ...old, pairMode: false, proposedEditObserveMode: false, diffSideBySide: true } as UIState;
        }
        if (version < 7) {
          const old = persistedState as Record<string, unknown>;
          return { ...old, diffSideBySide: typeof old.diffSideBySide === 'boolean' ? old.diffSideBySide : true } as UIState;
        }
        if (version < 8) {
          // Phase 5: seed role-scoped view discriminant + active project.
          const old = persistedState as Record<string, unknown>;
          return { ...old, supervisorRole: 'supervisor', activeProject: null } as UIState;
        }
        if (version < 9) {
          // Control-UI vision §2: seed the top-level mode discriminant.
          const old = persistedState as Record<string, unknown>;
          return { ...old, mode: 'studio' } as UIState;
        }
        if (version < 10) {
          // CUI-6: drop the dead supervisorViewOpen gate; seed per-mode splits.
          const old = persistedState as Record<string, unknown>;
          const { supervisorViewOpen: _svo, ...rest } = old;
          return {
            ...rest,
            modeSplit: { studio: DEFAULT_EDITOR_SPLIT_POSITION, bridge: DEFAULT_EDITOR_SPLIT_POSITION, plan: DEFAULT_EDITOR_SPLIT_POSITION },
          } as UIState;
        }
        if (version < 11) {
          // Spec/Browser/Terminal join the side-by-side reorderable pane row.
          // Preserve the user's existing left→right order, then APPEND any pane
          // keys they don't have yet (older orders only held bridge/plan/studio)
          // so the new panes get a position and can render when toggled.
          const old = persistedState as Record<string, unknown>;
          const prev = Array.isArray(old.paneOrder) ? (old.paneOrder as PaneKey[]) : [];
          const merged = [...prev.filter((p) => ALL_PANE_KEYS.includes(p))];
          for (const k of ALL_PANE_KEYS) if (!merged.includes(k)) merged.push(k);
          return {
            ...old,
            paneOrder: merged,
            specOpen: typeof old.specOpen === 'boolean' ? old.specOpen : false,
          } as UIState;
        }
        return persistedState as UIState;
      },
    }
  )
);

if (typeof window !== 'undefined') {
  (window as unknown as { __UI_STORE__: typeof useUIStore }).__UI_STORE__ = useUIStore;
}
