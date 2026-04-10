/**
 * globalSearch store
 *
 * Exposes the GlobalSearch overlay's open state so it can be triggered from
 * anywhere in the UI (e.g. a magnifying-glass button in the Sidebar), not
 * just via the Cmd+K keyboard shortcut.
 */

import { create } from 'zustand';

interface GlobalSearchState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useGlobalSearch = create<GlobalSearchState>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set({ isOpen: !get().isOpen }),
}));
