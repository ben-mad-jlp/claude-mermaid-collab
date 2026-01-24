/**
 * Viewer Store
 *
 * Manages the current artifact being viewed in the viewer pane.
 * Allows navigation between documents and diagrams.
 */

import { create } from 'zustand';

export interface CurrentView {
  type: 'document' | 'diagram';
  id: string;
}

export interface ViewerState {
  currentView: CurrentView | null;
  navigateToArtifact: (id: string, type: 'document' | 'diagram') => void;
  reset: () => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  currentView: null,

  navigateToArtifact: (id: string, type: 'document' | 'diagram') => {
    set({
      currentView: {
        type,
        id,
      },
    });
  },

  reset: () => {
    set({
      currentView: null,
    });
  },
}));
