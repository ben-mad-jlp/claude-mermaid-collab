/**
 * deckStore — shared selection/HUD state for the Bridge SplitDeck (BR-3).
 *
 * `selectedNodeId` is the two-way panel↔graph spotlight (visual only): the
 * FleetGraph sets it on node click and highlights it; left-panel cards can read
 * it to highlight the matching row. `forcedLod` is the semantic-zoom HUD
 * override (null = follow the live zoom level).
 */

import { create } from 'zustand';

export type Lod = 0 | 1 | 2;

interface DeckState {
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  /** HUD override for semantic zoom; null = derive from live zoom. */
  forcedLod: Lod | null;
  setForcedLod: (lod: Lod | null) => void;
  /** BR-4: the escalation currently shown in the focal DecisionCard (null = none). */
  focalEscalationId: string | null;
  setFocalEscalationId: (id: string | null) => void;
  /** BR-4: graph-answers-the-card — the node the graph should fitView+pulse. */
  focusNodeId: string | null;
  setFocusNodeId: (id: string | null) => void;
}

export const useDeckStore = create<DeckState>((set) => ({
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  forcedLod: null,
  setForcedLod: (lod) => set({ forcedLod: lod }),
  focalEscalationId: null,
  setFocalEscalationId: (id) => set({ focalEscalationId: id }),
  focusNodeId: null,
  setFocusNodeId: (id) => set({ focusNodeId: id }),
}));
