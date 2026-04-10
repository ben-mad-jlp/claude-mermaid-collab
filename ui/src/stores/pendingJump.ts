/**
 * pendingJump store
 *
 * Tiny zustand store holding a pending jump target used to coordinate
 * selectSnippet -> new-editor-mount -> jumpToLine handoff across
 * CodeEditor component remounts.
 *
 * Pattern: callers set a pending jump BEFORE calling selectSnippet(id).
 * When the newly-mounted CodeEditor's effect runs, it calls consume(snippetId)
 * and receives the target line if the pending entry matches.
 */

import { create } from 'zustand';

export interface PendingJump {
  snippetId: string;
  line: number;
}

interface PendingJumpState {
  pending: PendingJump | null;
  setPending: (v: PendingJump | null) => void;
  /**
   * If the pending jump matches the given snippetId, return its line
   * and clear the pending entry. Otherwise return null.
   */
  consume: (snippetId: string) => number | null;
}

export const usePendingJump = create<PendingJumpState>((set, get) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
  consume: (snippetId) => {
    const { pending } = get();
    if (pending && pending.snippetId === snippetId) {
      set({ pending: null });
      return pending.line;
    }
    return null;
  },
}));
