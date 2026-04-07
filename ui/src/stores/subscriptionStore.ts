import { create } from 'zustand';

interface SubscribedSession {
  project: string;
  session: string;
  claudeSessionId?: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
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
      const newStatus = status as 'active' | 'waiting' | 'permission' | 'unknown';
      // Only reset the timer when transitioning between active and non-active states
      const isActiveGroup = (s: string) => s === 'active' || s === 'permission';
      const statusGroupChanged = isActiveGroup(existing.status) !== isActiveGroup(newStatus);
      const lastUpdate = statusGroupChanged ? Date.now() : existing.lastUpdate;
      const next = { ...state.subscriptions, [key]: { ...existing, claudeSessionId, status: newStatus, lastUpdate } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { subscriptions: next };
    });
  },
}));
