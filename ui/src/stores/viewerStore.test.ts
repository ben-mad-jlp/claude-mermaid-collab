/**
 * Viewer Store Tests
 *
 * Tests for the viewer store that manages the currently viewed artifact
 * (document or diagram) and provides navigation functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore } from './viewerStore';

describe('Viewer Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useViewerStore.setState({
      currentView: null,
    });
  });

  describe('Initial State', () => {
    it('should initialize with null currentView', () => {
      const state = useViewerStore.getState();
      expect(state.currentView).toBeNull();
    });

    it('should have navigateToArtifact method', () => {
      const state = useViewerStore.getState();
      expect(typeof state.navigateToArtifact).toBe('function');
    });

    it('should have reset method', () => {
      const state = useViewerStore.getState();
      expect(typeof state.reset).toBe('function');
    });
  });

  describe('navigateToArtifact Method', () => {
    it('should update currentView with document type and id', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-123', 'document');

      const state = useViewerStore.getState();
      expect(state.currentView).toBeDefined();
      expect(state.currentView?.type).toBe('document');
      expect(state.currentView?.id).toBe('doc-123');
    });

    it('should update currentView with diagram type and id', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('diag-456', 'diagram');

      const state = useViewerStore.getState();
      expect(state.currentView).toBeDefined();
      expect(state.currentView?.type).toBe('diagram');
      expect(state.currentView?.id).toBe('diag-456');
    });

    it('should replace previous view when navigating to new artifact', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-123', 'document');

      let state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('doc-123');

      store.navigateToArtifact('diag-456', 'diagram');

      state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('diag-456');
      expect(state.currentView?.type).toBe('diagram');
    });

    it('should handle navigating to the same artifact multiple times', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-123', 'document');
      store.navigateToArtifact('doc-123', 'document');

      const state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('doc-123');
      expect(state.currentView?.type).toBe('document');
    });

    it('should handle switching between different document artifacts', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-1', 'document');
      store.navigateToArtifact('doc-2', 'document');

      const state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('doc-2');
      expect(state.currentView?.type).toBe('document');
    });

    it('should handle switching between different diagram artifacts', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('diag-1', 'diagram');
      store.navigateToArtifact('diag-2', 'diagram');

      const state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('diag-2');
      expect(state.currentView?.type).toBe('diagram');
    });

    it('should preserve artifact ID with special characters', () => {
      const store = useViewerStore.getState();
      const specialId = 'doc-123_abc-def@456';
      store.navigateToArtifact(specialId, 'document');

      const state = useViewerStore.getState();
      expect(state.currentView?.id).toBe(specialId);
    });

    it('should preserve artifact ID with long strings', () => {
      const store = useViewerStore.getState();
      const longId = 'doc-' + 'a'.repeat(200);
      store.navigateToArtifact(longId, 'document');

      const state = useViewerStore.getState();
      expect(state.currentView?.id).toBe(longId);
    });
  });

  describe('Reset Method', () => {
    it('should clear currentView when reset is called', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-123', 'document');

      let state = useViewerStore.getState();
      expect(state.currentView).toBeDefined();

      store.reset();

      state = useViewerStore.getState();
      expect(state.currentView).toBeNull();
    });

    it('should work even when currentView is already null', () => {
      const store = useViewerStore.getState();
      store.reset();

      const state = useViewerStore.getState();
      expect(state.currentView).toBeNull();
    });
  });

  describe('Store Reactivity', () => {
    it('should notify subscribers when navigateToArtifact is called', () => {
      const subscriber = vi.fn();
      const unsubscribe = useViewerStore.subscribe(subscriber);

      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-123', 'document');

      expect(subscriber).toHaveBeenCalled();
      unsubscribe();
    });

    it('should notify subscribers when reset is called', () => {
      const subscriber = vi.fn();
      const unsubscribe = useViewerStore.subscribe(subscriber);

      const store = useViewerStore.getState();
      store.reset();

      expect(subscriber).toHaveBeenCalled();
      unsubscribe();
    });

    it('should pass updated state to subscribers', () => {
      let capturedState: any;
      const unsubscribe = useViewerStore.subscribe((state) => {
        capturedState = state;
      });

      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-123', 'document');

      expect(capturedState.currentView?.id).toBe('doc-123');
      expect(capturedState.currentView?.type).toBe('document');
      unsubscribe();
    });
  });

  describe('Current View Type', () => {
    it('should return currentView with correct type property', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('diag-1', 'diagram');

      const state = useViewerStore.getState();
      expect(state.currentView?.type).toBe('diagram');
    });

    it('should return currentView with correct id property', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-1', 'document');

      const state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('doc-1');
    });

    it('should have currentView as object with type and id', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-123', 'document');

      const state = useViewerStore.getState();
      expect(typeof state.currentView).toBe('object');
      expect(Object.keys(state.currentView!)).toContain('type');
      expect(Object.keys(state.currentView!)).toContain('id');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string ID', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('', 'document');

      const state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('');
    });

    it('should handle rapid successive navigations', () => {
      const store = useViewerStore.getState();
      store.navigateToArtifact('doc-1', 'document');
      store.navigateToArtifact('doc-2', 'document');
      store.navigateToArtifact('doc-3', 'document');
      store.navigateToArtifact('diag-1', 'diagram');

      const state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('diag-1');
      expect(state.currentView?.type).toBe('diagram');
    });
  });
});

// Import vi for mocking
import { vi } from 'vitest';
