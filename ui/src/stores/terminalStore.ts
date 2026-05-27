import { create } from 'zustand';

/** Visibility of the in-app terminal drawer. */
interface TerminalState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
