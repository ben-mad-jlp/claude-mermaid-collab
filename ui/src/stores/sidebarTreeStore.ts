import { create } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';

export type SidebarTab = 'items' | 'code';

export interface MultiSelection {
  ids: Set<string>;
  anchorId: string | null;
}

export interface SidebarTreeState {
  collapsedSections: Set<string>;
  showDeprecated: boolean;
  searchQuery: string;
  forceExpandedSections: Set<string>;
  activeTab: SidebarTab;
  pseudoCollapsedPaths: Set<string>;
  pseudoProject: string | null;
  multiSelection: MultiSelection;
  toggleSection: (id: string) => void;
  setShowDeprecated: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setForceExpandedSections: (ids: string[]) => void;
  setActiveTab: (tab: SidebarTab) => void;
  togglePseudoPath: (path: string) => void;
  setPseudoProject: (project: string | null) => void;
  collapseAllItems: (ids: string[]) => void;
  expandAllItems: () => void;
  collapseAllPseudo: (allDirs: string[]) => void;
  expandAllPseudo: () => void;
  setSelection: (ids: Iterable<string>, anchorId?: string | null) => void;
  toggleInSelection: (id: string, anchorId?: string | null) => void;
  extendSelectionTo: (id: string, visibleOrder: string[]) => void;
  clearSelection: () => void;
}

const COLLAPSED_KEY = 'collab.sidebar.tree.collapsed.v1';
const SHOW_DEPRECATED_KEY = 'collab.sidebar.tree.showDeprecated.v1';
const PSEUDO_COLLAPSED_KEY = 'collab.sidebar.pseudo.collapsed.v1';
const ACTIVE_TAB_KEY = 'collab.sidebar.activeTab.v1';
const PSEUDO_PROJECT_KEY = 'collab.sidebar.pseudoProject.v1';

const dualKeyStorage: StateStorage = {
  getItem: (_name: string): string | null => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const collapsedRaw = window.localStorage.getItem(COLLAPSED_KEY);
      const showDeprecatedRaw = window.localStorage.getItem(SHOW_DEPRECATED_KEY);
      const pseudoCollapsedRaw = window.localStorage.getItem(PSEUDO_COLLAPSED_KEY);
      const activeTabRaw = window.localStorage.getItem(ACTIVE_TAB_KEY);
      const pseudoProjectRaw = window.localStorage.getItem(PSEUDO_PROJECT_KEY);

      if (
        collapsedRaw === null &&
        showDeprecatedRaw === null &&
        pseudoCollapsedRaw === null &&
        activeTabRaw === null &&
        pseudoProjectRaw === null
      ) {
        return null;
      }

      let collapsedArr: string[] = [];
      if (collapsedRaw !== null) {
        try {
          const parsed = JSON.parse(collapsedRaw);
          if (Array.isArray(parsed)) {
            collapsedArr = parsed.filter((x): x is string => typeof x === 'string');
          }
        } catch {
          collapsedArr = [];
        }
      }

      let showDeprecated = false;
      if (showDeprecatedRaw !== null) {
        try {
          const parsed = JSON.parse(showDeprecatedRaw);
          showDeprecated = typeof parsed === 'boolean' ? parsed : false;
        } catch {
          showDeprecated = false;
        }
      }

      let pseudoCollapsedArr: string[] = [];
      if (pseudoCollapsedRaw !== null) {
        try {
          const parsed = JSON.parse(pseudoCollapsedRaw);
          if (Array.isArray(parsed)) {
            pseudoCollapsedArr = parsed.filter((x): x is string => typeof x === 'string');
          }
        } catch {
          pseudoCollapsedArr = [];
        }
      }

      let activeTab: SidebarTab = 'items';
      if (activeTabRaw !== null) {
        try {
          const parsed = JSON.parse(activeTabRaw);
          if (parsed === 'code' || parsed === 'pseudo') activeTab = 'code';
          else if (parsed === 'items') activeTab = 'items';
        } catch {
          activeTab = 'items';
        }
      }

      let pseudoProject: string | null = null;
      if (pseudoProjectRaw !== null) {
        try {
          const parsed = JSON.parse(pseudoProjectRaw);
          pseudoProject = typeof parsed === 'string' ? parsed : null;
        } catch {
          pseudoProject = null;
        }
      }

      return JSON.stringify({
        state: {
          collapsedSections: collapsedArr,
          showDeprecated,
          pseudoCollapsedPaths: pseudoCollapsedArr,
          activeTab,
          pseudoProject,
        },
        version: 1,
      });
    } catch {
      return null;
    }
  },
  setItem: (_name: string, value: string): void => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const envelope = JSON.parse(value) as {
        state?: {
          collapsedSections?: unknown;
          showDeprecated?: unknown;
          pseudoCollapsedPaths?: unknown;
          activeTab?: unknown;
          pseudoProject?: unknown;
        };
      };
      const state = envelope.state ?? {};
      const collapsed = state.collapsedSections;
      let collapsedArr: string[] = [];
      if (Array.isArray(collapsed)) {
        collapsedArr = collapsed.filter((x): x is string => typeof x === 'string');
      } else if (collapsed instanceof Set) {
        collapsedArr = Array.from(collapsed as Set<string>);
      }
      const showDeprecated =
        typeof state.showDeprecated === 'boolean' ? state.showDeprecated : false;

      const pseudoCollapsed = state.pseudoCollapsedPaths;
      let pseudoCollapsedArr: string[] = [];
      if (Array.isArray(pseudoCollapsed)) {
        pseudoCollapsedArr = pseudoCollapsed.filter((x): x is string => typeof x === 'string');
      } else if (pseudoCollapsed instanceof Set) {
        pseudoCollapsedArr = Array.from(pseudoCollapsed as Set<string>);
      }

      const activeTab: SidebarTab =
        state.activeTab === 'code'
          ? 'code'
          : state.activeTab === 'items'
            ? 'items'
            : state.activeTab === 'pseudo'
              ? 'code'
              : 'items';

      const pseudoProject: string | null =
        typeof state.pseudoProject === 'string' ? state.pseudoProject : null;

      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedArr));
      window.localStorage.setItem(SHOW_DEPRECATED_KEY, JSON.stringify(showDeprecated));
      window.localStorage.setItem(PSEUDO_COLLAPSED_KEY, JSON.stringify(pseudoCollapsedArr));
      window.localStorage.setItem(ACTIVE_TAB_KEY, JSON.stringify(activeTab));
      window.localStorage.setItem(PSEUDO_PROJECT_KEY, JSON.stringify(pseudoProject));
    } catch {
      // ignore
    }
  },
  removeItem: (_name: string): void => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.removeItem(COLLAPSED_KEY);
      window.localStorage.removeItem(SHOW_DEPRECATED_KEY);
      window.localStorage.removeItem(PSEUDO_COLLAPSED_KEY);
      window.localStorage.removeItem(ACTIVE_TAB_KEY);
      window.localStorage.removeItem(PSEUDO_PROJECT_KEY);
    } catch {
      // ignore
    }
  },
};

export const useSidebarTreeStore = create<SidebarTreeState>()(
  persist(
    (set, get) => ({
      collapsedSections: new Set<string>(),
      showDeprecated: false,
      searchQuery: '',
      forceExpandedSections: new Set<string>(),
      activeTab: 'items' as SidebarTab,
      pseudoCollapsedPaths: new Set<string>(),
      pseudoProject: null,
      multiSelection: { ids: new Set<string>(), anchorId: null },

      toggleSection: (id: string) => {
        const current = get().collapsedSections;
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        set({ collapsedSections: next });
      },

      setShowDeprecated: (v: boolean) => set({ showDeprecated: v }),

      setSearchQuery: (q: string) => {
        const trimmed = q.trim();
        set({ searchQuery: trimmed });
        if (trimmed === '') {
          set({ forceExpandedSections: new Set<string>() });
        }
      },

      setForceExpandedSections: (ids: string[]) =>
        set({ forceExpandedSections: new Set(ids) }),

      setActiveTab: (tab) => set({ activeTab: tab }),
      togglePseudoPath: (path) => {
        const next = new Set(get().pseudoCollapsedPaths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        set({ pseudoCollapsedPaths: next });
      },
      setPseudoProject: (project) => set({ pseudoProject: project }),
      collapseAllItems: (ids) => set({ collapsedSections: new Set(ids) }),
      expandAllItems: () => set({ collapsedSections: new Set<string>() }),
      collapseAllPseudo: (allDirs) => set({ pseudoCollapsedPaths: new Set(allDirs) }),
      expandAllPseudo: () => set({ pseudoCollapsedPaths: new Set<string>() }),

      setSelection: (ids, anchorId = null) =>
        set({ multiSelection: { ids: new Set(ids), anchorId } }),
      toggleInSelection: (id, anchorId) => {
        const current = get().multiSelection;
        const next = new Set(current.ids);
        const wasPresent = next.has(id);
        if (wasPresent) next.delete(id);
        else next.add(id);
        let newAnchor: string | null;
        if (anchorId !== undefined) newAnchor = anchorId;
        else if (!wasPresent) newAnchor = id;
        else if (next.size === 0) newAnchor = null;
        else if (current.anchorId === id) newAnchor = next.values().next().value ?? null;
        else newAnchor = current.anchorId;
        set({ multiSelection: { ids: next, anchorId: newAnchor } });
      },
      extendSelectionTo: (id, visibleOrder) => {
        const { anchorId } = get().multiSelection;
        if (anchorId === null) {
          set({ multiSelection: { ids: new Set([id]), anchorId: id } });
          return;
        }
        const aIdx = visibleOrder.indexOf(anchorId);
        const bIdx = visibleOrder.indexOf(id);
        if (aIdx < 0 || bIdx < 0) {
          set({ multiSelection: { ids: new Set([id]), anchorId: id } });
          return;
        }
        const lo = Math.min(aIdx, bIdx);
        const hi = Math.max(aIdx, bIdx);
        set({
          multiSelection: {
            ids: new Set(visibleOrder.slice(lo, hi + 1)),
            anchorId,
          },
        });
      },
      clearSelection: () =>
        set({ multiSelection: { ids: new Set<string>(), anchorId: null } }),
    }),
    {
      name: 'collab.sidebar.tree',
      version: 1,
      storage: {
        getItem: (name) => {
          const str = dualKeyStorage.getItem(name) as string | null;
          if (str === null) {
            return null;
          }
          try {
            return JSON.parse(str);
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          dualKeyStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          dualKeyStorage.removeItem(name);
        },
      },
      partialize: (state) =>
        ({
          collapsedSections: Array.from(state.collapsedSections) as unknown as Set<string>,
          showDeprecated: state.showDeprecated,
          pseudoCollapsedPaths: Array.from(state.pseudoCollapsedPaths) as unknown as Set<string>,
          activeTab: state.activeTab,
          pseudoProject: state.pseudoProject,
        }) as SidebarTreeState,
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as {
          collapsedSections?: unknown;
          showDeprecated?: unknown;
          pseudoCollapsedPaths?: unknown;
          activeTab?: unknown;
          pseudoProject?: unknown;
        };
        let collapsedSet = new Set<string>();
        if (Array.isArray(persisted.collapsedSections)) {
          collapsedSet = new Set(
            persisted.collapsedSections.filter((x): x is string => typeof x === 'string')
          );
        } else if (persisted.collapsedSections instanceof Set) {
          collapsedSet = new Set(persisted.collapsedSections as Set<string>);
        }
        const showDeprecated =
          typeof persisted.showDeprecated === 'boolean' ? persisted.showDeprecated : false;

        let pseudoCollapsedSet = new Set<string>();
        if (Array.isArray(persisted.pseudoCollapsedPaths)) {
          pseudoCollapsedSet = new Set(
            persisted.pseudoCollapsedPaths.filter((x): x is string => typeof x === 'string')
          );
        } else if (persisted.pseudoCollapsedPaths instanceof Set) {
          pseudoCollapsedSet = new Set(persisted.pseudoCollapsedPaths as Set<string>);
        }

        const activeTab: SidebarTab =
          persisted.activeTab === 'code'
            ? 'code'
            : persisted.activeTab === 'items'
              ? 'items'
              : persisted.activeTab === 'pseudo'
                ? 'code'
                : 'items';

        const pseudoProject: string | null =
          typeof persisted.pseudoProject === 'string' ? persisted.pseudoProject : null;

        return {
          ...currentState,
          collapsedSections: collapsedSet,
          showDeprecated,
          pseudoCollapsedPaths: pseudoCollapsedSet,
          activeTab,
          pseudoProject,
        };
      },
    }
  )
);
