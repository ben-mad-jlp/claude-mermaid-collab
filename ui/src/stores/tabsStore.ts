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

export interface SessionTabsState {
  tabs: TabDescriptor[];
  activeTabId: string | null;
}

export type TabsMap = Record<string, SessionTabsState>;

export function sessionKey(project: string, name: string): string {
  return `${project}::${name}`;
}

const EMPTY_STATE: SessionTabsState = { tabs: [], activeTabId: null };

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

  getSessionTabs: (key: string) => SessionTabsState;
}

function currentKey(): string | null {
  const cs = useSessionStore.getState().currentSession;
  if (!cs || !cs.project || !cs.name) return null;
  return sessionKey(cs.project, cs.name);
}

function getEntry(bySession: TabsMap, key: string): SessionTabsState {
  return bySession[key] ?? { tabs: [], activeTabId: null };
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
                [key]: { tabs, activeTabId: replaced.id },
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
                [key]: { tabs, activeTabId: tab.id },
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
          const activeTabId =
            entry.activeTabId === id ? nextActive : entry.activeTabId;
          return {
            bySession: {
              ...state.bySession,
              [key]: { tabs, activeTabId },
            },
          };
        });
      },

      reorderTabs: (ids) => {
        const key = currentKey();
        if (!key) return;
        set((state) => {
          const entry = getEntry(state.bySession, key);
          const subset = ids
            .map((id) => entry.tabs.find((t) => t.id === id))
            .filter((t): t is TabDescriptor => !!t);
          if (subset.length !== ids.length) return state;
          if (subset.length === 0) return state;
          const firstPinned = subset[0].isPinned;
          if (!subset.every((t) => t.isPinned === firstPinned)) return state;

          // Queue of new ordered ids to apply in place of old ids-in-ids positions
          const idSet = new Set(ids);
          const queue = ids.slice();
          const rebuilt = entry.tabs.map((t) => {
            if (idSet.has(t.id)) {
              const nextId = queue.shift()!;
              const src = entry.tabs.find((x) => x.id === nextId)!;
              return src;
            }
            return t;
          });
          const tabs = rebuilt.map((t, idx) => ({ ...t, order: idx }));
          return {
            bySession: {
              ...state.bySession,
              [key]: { ...entry, tabs },
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

      getSessionTabs: (key) => {
        const entry = get().bySession[key];
        return entry ?? EMPTY_STATE;
      },
    }),
    {
      name: 'collab.tabs.v1',
      partialize: (state) => ({ bySession: state.bySession }),
    }
  )
);

export function useSessionTabs(): SessionTabsState {
  const bySession = useTabsStore((s) => s.bySession);
  const currentSession = useSessionStore((s) => s.currentSession);
  if (!currentSession || !currentSession.project || !currentSession.name) {
    return EMPTY_STATE;
  }
  const key = sessionKey(currentSession.project, currentSession.name);
  return bySession[key] ?? EMPTY_STATE;
}
