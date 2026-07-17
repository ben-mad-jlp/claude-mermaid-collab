// Terminal composer draft-presence store.
//
// A tiny ephemeral flag that mirrors whether the terminal MessageComposer's
// textarea currently holds any non-whitespace text. The composer's inline GHOST
// suggestion is suppressed while the user is typing their own message (the ghost
// only shows over an EMPTY composer, so live text must hide it).
//
// Deliberately separate from composerDraftStore (the per-session Lexical draft
// with persistence/attachments): this is a single global boolean gate with no
// persistence — the composer owns the real text; this only reports "is empty?".

import { create } from 'zustand';

interface TerminalComposerDraftState {
  /** True when the composer textarea holds non-whitespace text. */
  hasText: boolean;
  setHasText: (hasText: boolean) => void;
}

export const useTerminalComposerDraftStore = create<TerminalComposerDraftState>((set) => ({
  hasText: false,
  setHasText: (hasText) => set({ hasText }),
}));
