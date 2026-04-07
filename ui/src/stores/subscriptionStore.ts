import { create } from 'zustand';

interface SubscribedSession {
  project: string;
  session: string;
  claudeSessionId?: string;
  status: 'active' | 'waiting' | 'unknown';
  lastUpdate: number;
}

interface SubscriptionState {
  subscriptions: Record<string, SubscribedSession>;
  subscribe: (project: string, session: string) => void;
  unsubscribe: (key: string) => void;
  updateStatus: (claudeSessionId: string, status: string, project: string, session: string) => void;
}

const STORAGE_KEY = 'session-subscriptions';

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  })(),

  subscribe: (project, session) => {
    const key = `${project}:${session}`;
    set((state) => {
      const next = { ...state.subscriptions, [key]: { project, session, status: 'unknown' as const, lastUpdate: Date.now() } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { subscriptions: next };
    });
  },

  unsubscribe: (key) => {
    set((state) => {
      const next = { ...state.subscriptions };
      delete next[key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { subscriptions: next };
    });
  },

  updateStatus: (claudeSessionId, status, project, session) => {
    const key = `${project}:${session}`;
    set((state) => {
      const existing = state.subscriptions[key];
      if (!existing) return state;
      const next = { ...state.subscriptions, [key]: { ...existing, claudeSessionId, status: status as 'active' | 'waiting' | 'unknown', lastUpdate: Date.now() } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { subscriptions: next };
    });
  },
}));
