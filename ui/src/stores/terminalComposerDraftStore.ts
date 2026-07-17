// Terminal composer draft-presence store.
//
// A tiny ephemeral flag that mirrors whether the terminal MessageComposer's
// textarea currently holds any non-whitespace text. SuggestionChips reads it to
// hide the AI-proposed reply chips while the user is typing their own message
// (chips STAGE into the draft, so showing them over live text would be noise).
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
