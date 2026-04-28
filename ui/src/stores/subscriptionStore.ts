import { create } from 'zustand';
import { evictSessionItemsCache } from '@/lib/sessionItemsCache';

interface SubscribedSession {
  project: string;
  session: string;
  claudeSessionId?: string;
  claudePid?: number;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
}

interface SubscriptionState {
  subscriptions: Record<string, SubscribedSession>;
  order: string[];
  subscribe: (project: string, session: string) => void;
  unsubscribe: (key: string) => void;
  reorder: (order: string[]) => void;
  updateStatus: (claudeSessionId: string, status: string, project: string, session: string, claudePid?: number) => void;
}

const STORAGE_KEY = 'session-subscriptions';
const ORDER_KEY = 'session-subscriptions-order';

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  })(),

  order: (() => {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); }
    catch { return []; }
  })(),

  subscribe: (project, session) => {
    const key = `${project}:${session}`;
    set((state) => {
      const next = { ...state.subscriptions, [key]: { project, session, status: 'unknown' as const, lastUpdate: Date.now() } };
      const nextOrder = state.order.includes(key) ? state.order : [...state.order, key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ORDER_KEY, JSON.stringify(nextOrder));
      return { subscriptions: next, order: nextOrder };
    });
  },

  unsubscribe: (key) => {
    set((state) => {
      const next = { ...state.subscriptions };
      const entry = state.subscriptions[key];
      if (entry) evictSessionItemsCache(entry.project, entry.session);
      delete next[key];
      const nextOrder = state.order.filter((k) => k !== key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ORDER_KEY, JSON.stringify(nextOrder));
      return { subscriptions: next, order: nextOrder };
    });
  },

  reorder: (newOrder) => {
    set(() => {
      localStorage.setItem(ORDER_KEY, JSON.stringify(newOrder));
      return { order: newOrder };
    });
  },

  updateStatus: (claudeSessionId, status, project, session, claudePid?) => {
    const key = `${project}:${session}`;
    set((state) => {
      const existing = state.subscriptions[key];
      if (!existing) return state;
      const newStatus = status as 'active' | 'waiting' | 'permission' | 'unknown';
      // Only reset the timer when transitioning between active and non-active states
      const isActiveGroup = (s: string) => s === 'active' || s === 'permission';
      const statusGroupChanged = isActiveGroup(existing.status) !== isActiveGroup(newStatus);
      const lastUpdate = statusGroupChanged ? Date.now() : existing.lastUpdate;
      const pidUpdate = claudePid !== undefined ? { claudePid } : {};
      const next = { ...state.subscriptions, [key]: { ...existing, claudeSessionId, status: newStatus, lastUpdate, ...pidUpdate } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { subscriptions: next };
    });
  },
}));
