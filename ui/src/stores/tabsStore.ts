import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSessionStore } from './sessionStore';

export type TabKind =
  | 'artifact'
  | 'task-graph'
  | 'task-details'
  | 'blueprint'
  | 'embed'
  | 'code-file';

export type TabArtifactType =
  | 'diagram'
  | 'document'
  | 'design'
  | 'spreadsheet'
  | 'snippet'
  | 'image';

export interface TabDescriptor {
  id: string;
  kind: TabKind;
  artifactType?: TabArtifactType;
  artifactId: string;
  name: string;
  isPreview: boolean;
  isPinned: boolean;
  order: number;
  openedAt: number;
}

export type PaneId = 'left' | 'right';

/** @deprecated - internal state no longer uses panes; shape synthesized by useSessionTabs compat shim */
export interface PaneState {
  tabs: TabDescriptor[];
  activeTabId: string | null;
}

export interface SessionTabsState {
  tabs: TabDescriptor[];
  activeTabId: string | null;
  rightPaneTabId: string | null;
  /** @deprecated always 'left'; kept for caller compatibility */
  activePaneId: PaneId;
}

export interface SessionTabsViewCompat extends SessionTabsState {
  panes: {
    left: { tabs: TabDescriptor[]; activeTabId: string | null };
    right: { tabs: TabDescriptor[]; activeTabId: string | null };
  };
}

export type TabsMap = Record<string, SessionTabsState>;

export function sessionKey(project: string, name: string): string {
  return `${project}::${name}`;
}

const EMPTY_STATE: SessionTabsState = {
  tabs: [],
  activeTabId: null,
  rightPaneTabId: null,
  activePaneId: 'left',
};

function emptyState(): SessionTabsState {
  return {
    tabs: [],
    activeTabId: null,
    rightPaneTabId: null,
    activePaneId: 'left',
  };
}

type TabInput = Omit<TabDescriptor, 'isPreview' | 'isPinned' | 'order' | 'openedAt'> &
  Partial<Pick<TabDescriptor, 'isPreview' | 'isPinned' | 'order' | 'openedAt'>>;

interface TabsStoreShape {
  bySession: TabsMap;

  openPreview: (tab: TabInput) => void;
  openPermanent: (tab: TabInput) => void;
  promoteToPermanent: (id: string) => void;
  pinTab: (id: string) => void;
  unpinTab: (id: string) => void;
  closeTab: (id: string) => void;
  reorderTabs: (ids: string[]) => void;
  setActive: (id: string) => void;
  pinTabRight: (id: string) => void;
  unpinTabRight: (id?: string) => void;
  closeRightPane: () => void;

  /** @deprecated use pinTabRight / unpinTabRight */
  moveTabBetweenPanes: (
    tabId: string,
    fromPane: PaneId,
    toPane: PaneId,
    insertAtIndex?: number
  ) => void;
  /** @deprecated no-op; left is always the interactive pane */
  setActivePaneId: (pane: PaneId) => void;

  getSessionTabs: (key: string) => SessionTabsState;
}

function currentKey(): string | null {
  const cs = useSessionStore.getState().currentSession;
  if (!cs || !cs.project || !cs.name) return null;
  return sessionKey(cs.project, cs.name);
}

function getEntry(bySession: TabsMap, key: string): SessionTabsState {
  return bySession[key] ?? emptyState();
}

function maxOrder(tabs: TabDescriptor[]): number {
  return tabs.reduce((acc, t) => (t.order > acc ? t.order : acc), -1);
}

export const useTabsStore = create<TabsStoreShape>()(
  persist(
    (set, get) => ({
      bySession: {},

      openPreview: (tab) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          const existing = entry.tabs.find((t) => t.id === tab.id);
          if (existing) {
            return {
              bySession: {
                ...state.bySession,
                [key]: { ...entry, activeTabId: existing.id },
              },
            };
          }
          const previewIdx = entry.tabs.findIndex((t) => t.isPreview);
          if (previewIdx >= 0) {
            const prev = entry.tabs[previewIdx];
            const replaced: TabDescriptor = {
              ...prev,
              id: tab.id,
              kind: tab.kind,
              artifactType: tab.artifactType,
              artifactId: tab.artifactId,
              name: tab.name,
              isPreview: true,
              openedAt: Date.now(),
            };
            const tabs = entry.tabs.slice();
            tabs[previewIdx] = replaced;
            return {
              bySession: {
                ...state.bySession,
                [key]: { ...entry, tabs, activeTabId: replaced.id },
              },
            };
          }
          const newTab: TabDescriptor = {
            id: tab.id,
            kind: tab.kind,
            artifactType: tab.artifactType,
            artifactId: tab.artifactId,
            name: tab.name,
            isPreview: true,
            isPinned: false,
            order: maxOrder(entry.tabs) + 1,
            openedAt: Date.now(),
          };
          return {
            bySession: {
              ...state.bySession,
              [key]: {
                ...entry,
                tabs: [...entry.tabs, newTab],
                activeTabId: newTab.id,
              },
            },
          };
        });
      },

      openPermanent: (tab) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          const existing = entry.tabs.find((t) => t.id === tab.id);
          if (existing) {
            const tabs = entry.tabs.map((t) =>
              t.id === tab.id ? { ...t, isPreview: false } : t
            );
            return {
              bySession: {
                ...state.bySession,
                [key]: { ...entry, tabs, activeTabId: tab.id },
              },
            };
          }
          const newTab: TabDescriptor = {
            id: tab.id,
            kind: tab.kind,
            artifactType: tab.artifactType,
            artifactId: tab.artifactId,
            name: tab.name,
            isPreview: false,
            isPinned: false,
            order: maxOrder(entry.tabs) + 1,
            openedAt: Date.now(),
          };
          return {
            bySession: {
              ...state.bySession,
              [key]: {
                ...entry,
                tabs: [...entry.tabs, newTab],
                activeTabId: newTab.id,
              },
            },
          };
        });
      },

      promoteToPermanent: (id) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          const tabs = entry.tabs.map((t) =>
            t.id === id ? { ...t, isPreview: false } : t
          );
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, tabs },
            },
          };
        });
      },

      pinTab: (id) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          const tabs = entry.tabs.map((t) =>
            t.id === id ? { ...t, isPinned: true } : t
          );
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, tabs },
            },
          };
        });
      },

      unpinTab: (id) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          const tabs = entry.tabs.map((t) =>
            t.id === id ? { ...t, isPinned: false } : t
          );
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, tabs },
            },
          };
        });
      },

      closeTab: (id) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          const i = entry.tabs.findIndex((t) => t.id === id);
          if (i < 0) return state;
          const nextActive = entry.tabs[i + 1]?.id ?? entry.tabs[i - 1]?.id ?? null;
          const tabs = entry.tabs.filter((t) => t.id !== id);
          const activeTabId = entry.activeTabId === id ? nextActive : entry.activeTabId;
          const rightPaneTabId = entry.rightPaneTabId === id ? null : entry.rightPaneTabId;
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, tabs, activeTabId, rightPaneTabId },
            },
          };
        });
      },

      reorderTabs: (ids) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          if (ids.length !== entry.tabs.length) return state;
          const existingIds = new Set(entry.tabs.map((t) => t.id));
          if (!ids.every((id) => existingIds.has(id))) return state;
          const newIdSet = new Set(ids);
          if (newIdSet.size !== ids.length) return state;
          const byId = new Map(entry.tabs.map((t) => [t.id, t]));
          const reordered = ids.map((id, idx) => ({ ...byId.get(id)!, order: idx }));
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, tabs: reordered },
            },
          };
        });
      },

      setActive: (id) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, activeTabId: id },
            },
          };
        });
      },

      pinTabRight: (id) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          if (!entry.tabs.some((t) => t.id === id)) return state;
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, rightPaneTabId: id },
            },
          };
        });
      },

      unpinTabRight: (id) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          if (id !== undefined && entry.rightPaneTabId !== id) return state;
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, rightPaneTabId: null },
            },
          };
        });
      },

      closeRightPane: () => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, rightPaneTabId: null },
            },
          };
        });
      },

      moveTabBetweenPanes: (tabId, fromPane, toPane, _insertAtIndex) => {
        if (fromPane === toPane) return;
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          if (toPane === 'right') {
            if (!entry.tabs.some((t) => t.id === tabId)) return state;
            return {
              bySession: {
                ...state.bySession,
                [key]: { ...entry, rightPaneTabId: tabId },
              },
            };
          }
          // toPane === 'left' → unpin if it's the right-pinned tab
          if (entry.rightPaneTabId === tabId) {
            return {
              bySession: {
                ...state.bySession,
                [key]: { ...entry, rightPaneTabId: null },
              },
            };
          }
          return state;
        });
      },

      setActivePaneId: (_pane) => {
        // no-op: left is always the interactive pane
      },

      getSessionTabs: (key) => {
        const entry = get().bySession[key];
        return entry ?? emptyState();
      },
    }),
    {
      name: 'collab.tabs.v3',
      version: 3,
      partialize: (state) => ({ bySession: state.bySession }),
      migrate: (_persisted, prevVersion) =>
        prevVersion < 3 ? { bySession: {} } : (_persisted as any),
    }
  )
);

export function useSessionTabs(): SessionTabsViewCompat {
  const bySession = useTabsStore((s) => s.bySession);
  const currentSession = useSessionStore((s) => s.currentSession);
  const key =
    currentSession && currentSession.project && currentSession.name
      ? sessionKey(currentSession.project, currentSession.name)
      : null;
  const entry = key ? bySession[key] ?? emptyState() : emptyState();
  const leftPane = { tabs: entry.tabs, activeTabId: entry.activeTabId };
  const rightTab = entry.rightPaneTabId
    ? entry.tabs.find((t) => t.id === entry.rightPaneTabId)
    : undefined;
  const rightPane = {
    tabs: rightTab ? [rightTab] : [],
    activeTabId: entry.rightPaneTabId,
  };
  return { ...entry, panes: { left: leftPane, right: rightPane } };
}
