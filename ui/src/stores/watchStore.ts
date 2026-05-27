import { create } from 'zustand';

const STORAGE_KEY = 'watched-servers';
const mc = () => (window as any).mc;

interface WatchState {
  watchedIds: string[];
  toggleWatched: (id: string) => void;
  setWatched: (ids: string[]) => void;
  isWatched: (id: string) => boolean;
}

export const useWatchStore = create<WatchState>((set, get) => ({
  watchedIds: (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  })(),

  toggleWatched: (id) => set((state) => {
    const nextIds = state.watchedIds.includes(id)
      ? state.watchedIds.filter((x) => x !== id)
      : [...state.watchedIds, id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextIds));
    void mc()?.setWatchedServers?.(nextIds);
    return { watchedIds: nextIds };
  }),

  setWatched: (ids) => set(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    void mc()?.setWatchedServers?.(ids);
    return { watchedIds: ids };
  }),

  isWatched: (id) => get().watchedIds.includes(id),
}));
