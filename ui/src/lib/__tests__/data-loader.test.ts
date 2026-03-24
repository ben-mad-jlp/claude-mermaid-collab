/**
 * Data Loader Tests - Unit and integration tests for artifact loading
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadDiagrams,
  loadDocuments,
  loadDesigns,
  loadSpreadsheets,
  loadSnippets,
  loadAllArtifacts,
  onLoadingProgress,
  dispatchLoadingProgress,
  LOADING_PROGRESS_EVENT,
} from '../data-loader';
import { api } from '../api';
import { useSessionStore } from '../../stores/sessionStore';
import type { Diagram, Document } from '../../types';
import type { Design, Spreadsheet } from '../../stores/sessionStore';
import type { Snippet } from '../../types';

// Mock the api module
vi.mock('../api', () => ({
  api: {
    getDiagrams: vi.fn(),
    getDocuments: vi.fn(),
    getDesigns: vi.fn(),
    getSpreadsheets: vi.fn(),
    getSnippets: vi.fn(),
  },
}));

// Mock window.addEventListener/removeEventListener
const listeners: Record<string, Set<EventListener>> = {};

const mockAddEventListener = vi.fn((type: string, listener: EventListener) => {
  if (!listeners[type]) {
    listeners[type] = new Set();
  }
  listeners[type].add(listener);
});

const mockRemoveEventListener = vi.fn((type: string, listener: EventListener) => {
  if (listeners[type]) {
    listeners[type].delete(listener);
  }
});

const mockDispatchEvent = vi.fn((event: Event) => {
  const listeners_set = listeners[event.type];
  if (listeners_set) {
    listeners_set.forEach((listener) => listener(event));
  }
  return true;
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(listeners).forEach((key) => {
    listeners[key].clear();
  });

  // Setup window event listener mocks
  window.addEventListener = mockAddEventListener as any;
  window.removeEventListener = mockRemoveEventListener as any;
  window.dispatchEvent = mockDispatchEvent as any;

  // Reset store to clear test state
  useSessionStore.getState().reset();
});

afterEach(() => {
  vi.clearAllMocks();
  Object.keys(listeners).forEach((key) => {
    listeners[key].clear();
  });
});

describe('Data Loader', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'test-session';

  describe('loadDiagrams', () => {
    it('should load diagrams and update store', async () => {
      const mockDiagrams: Diagram[] = [
        { id: 'diagram-1', name: 'Diagram 1', content: 'graph TD; A-->B' },
        { id: 'diagram-2', name: 'Diagram 2', content: 'graph TD; C-->D' },
      ];

      vi.mocked(api.getDiagrams).mockResolvedValueOnce(mockDiagrams);

      const result = await loadDiagrams(mockProject, mockSession);

      expect(result).toEqual(mockDiagrams);
      expect(useSessionStore.getState().diagrams).toEqual(mockDiagrams);
      expect(api.getDiagrams).toHaveBeenCalledWith(mockProject, mockSession);
    });

    it('should handle load failures gracefully', async () => {
      const error = new Error('Network error');
      vi.mocked(api.getDiagrams).mockRejectedValueOnce(error);

      const result = await loadDiagrams(mockProject, mockSession);

      expect(result).toEqual([]);
      expect(useSessionStore.getState().diagrams).toEqual([]);
    });

    it('should retry on failure', async () => {
      const mockDiagrams: Diagram[] = [{ id: 'diagram-1', name: 'Diagram 1' }];
      vi.mocked(api.getDiagrams)
        .mockRejectedValueOnce(new Error('Attempt 1'))
        .mockResolvedValueOnce(mockDiagrams);

      const result = await loadDiagrams(mockProject, mockSession);

      expect(result).toEqual(mockDiagrams);
      expect(api.getDiagrams).toHaveBeenCalledTimes(2);
    });

    it('should emit loading progress events', async () => {
      const mockDiagrams: Diagram[] = [{ id: 'diagram-1', name: 'Diagram 1' }];
      vi.mocked(api.getDiagrams).mockResolvedValueOnce(mockDiagrams);

      const progressEvents: any[] = [];
      onLoadingProgress((progress) => {
        progressEvents.push(progress);
      });

      await loadDiagrams(mockProject, mockSession);

      expect(progressEvents).toContainEqual(
        expect.objectContaining({
          type: 'artifact_loaded',
          artifactType: 'diagrams',
          loaded: 1,
          total: 1,
        })
      );
    });
  });

  describe('loadDocuments', () => {
    it('should load documents and update store', async () => {
      const mockDocuments: Document[] = [
        { id: 'doc-1', name: 'Document 1', content: '# Title' },
        { id: 'doc-2', name: 'Document 2', content: '# Title 2' },
      ];

      vi.mocked(api.getDocuments).mockResolvedValueOnce(mockDocuments);

      const result = await loadDocuments(mockProject, mockSession);

      expect(result).toEqual(mockDocuments);
      expect(useSessionStore.getState().documents).toEqual(mockDocuments);
    });

    it('should handle load failures gracefully', async () => {
      vi.mocked(api.getDocuments).mockRejectedValueOnce(new Error('Failed'));

      const result = await loadDocuments(mockProject, mockSession);

      expect(result).toEqual([]);
      expect(useSessionStore.getState().documents).toEqual([]);
    });
  });

  describe('loadDesigns', () => {
    it('should load designs and update store', async () => {
      const mockDesigns: Design[] = [
        { id: 'design-1', name: 'Design 1', content: '{}' },
      ];

      vi.mocked(api.getDesigns).mockResolvedValueOnce(mockDesigns);

      const result = await loadDesigns(mockProject, mockSession);

      expect(result).toEqual(mockDesigns);
      expect(useSessionStore.getState().designs).toEqual(mockDesigns);
    });

    it('should handle load failures gracefully', async () => {
      vi.mocked(api.getDesigns).mockRejectedValueOnce(new Error('Failed'));

      const result = await loadDesigns(mockProject, mockSession);

      expect(result).toEqual([]);
      expect(useSessionStore.getState().designs).toEqual([]);
    });
  });

  describe('loadSpreadsheets', () => {
    it('should load spreadsheets and update store', async () => {
      const mockSpreadsheets: Spreadsheet[] = [
        { id: 'sheet-1', name: 'Sheet 1', content: '{}' },
      ];

      vi.mocked(api.getSpreadsheets).mockResolvedValueOnce(mockSpreadsheets);

      const result = await loadSpreadsheets(mockProject, mockSession);

      expect(result).toEqual(mockSpreadsheets);
      expect(useSessionStore.getState().spreadsheets).toEqual(mockSpreadsheets);
    });

    it('should handle load failures gracefully', async () => {
      vi.mocked(api.getSpreadsheets).mockRejectedValueOnce(new Error('Failed'));

      const result = await loadSpreadsheets(mockProject, mockSession);

      expect(result).toEqual([]);
      expect(useSessionStore.getState().spreadsheets).toEqual([]);
    });
  });

  describe('loadSnippets', () => {
    it('should load snippets and update store', async () => {
      const mockSnippets: Snippet[] = [
        { id: 'snippet-1', name: 'Snippet 1', content: 'code', lastModified: Date.now() },
      ];

      vi.mocked(api.getSnippets).mockResolvedValueOnce(mockSnippets);

      const result = await loadSnippets(mockProject, mockSession);

      expect(result).toEqual(mockSnippets);
      expect(useSessionStore.getState().snippets).toEqual(mockSnippets);
    });

    it('should handle load failures gracefully', async () => {
      vi.mocked(api.getSnippets).mockRejectedValueOnce(new Error('Failed'));

      const result = await loadSnippets(mockProject, mockSession);

      expect(result).toEqual([]);
      expect(useSessionStore.getState().snippets).toEqual([]);
    });
  });

  describe('loadAllArtifacts', () => {
    it('should load all artifact types in parallel', async () => {
      const mockDiagrams: Diagram[] = [{ id: 'd1', name: 'D1' }];
      const mockDocuments: Document[] = [{ id: 'doc1', name: 'Doc1' }];
      const mockDesigns: Design[] = [{ id: 'design1', name: 'Design1' }];
      const mockSpreadsheets: Spreadsheet[] = [{ id: 'sheet1', name: 'Sheet1' }];
      const mockSnippets: Snippet[] = [
        { id: 'snippet1', name: 'Snippet1', content: 'code', lastModified: Date.now() },
      ];

      vi.mocked(api.getDiagrams).mockResolvedValueOnce(mockDiagrams);
      vi.mocked(api.getDocuments).mockResolvedValueOnce(mockDocuments);
      vi.mocked(api.getDesigns).mockResolvedValueOnce(mockDesigns);
      vi.mocked(api.getSpreadsheets).mockResolvedValueOnce(mockSpreadsheets);
      vi.mocked(api.getSnippets).mockResolvedValueOnce(mockSnippets);

      const result = await loadAllArtifacts(mockProject, mockSession);

      expect(result.diagrams).toEqual(mockDiagrams);
      expect(result.documents).toEqual(mockDocuments);
      expect(result.designs).toEqual(mockDesigns);
      expect(result.spreadsheets).toEqual(mockSpreadsheets);
      expect(result.snippets).toEqual(mockSnippets);
      expect(result.totalArtifacts).toBe(5);

      // Verify store is updated
      const store = useSessionStore.getState();
      expect(store.diagrams).toEqual(mockDiagrams);
      expect(store.documents).toEqual(mockDocuments);
      expect(store.designs).toEqual(mockDesigns);
      expect(store.spreadsheets).toEqual(mockSpreadsheets);
      expect(store.snippets).toEqual(mockSnippets);
    });

    it('should emit start and complete events', async () => {
      vi.mocked(api.getDiagrams).mockResolvedValueOnce([]);
      vi.mocked(api.getDocuments).mockResolvedValueOnce([]);
      vi.mocked(api.getDesigns).mockResolvedValueOnce([]);
      vi.mocked(api.getSpreadsheets).mockResolvedValueOnce([]);
      vi.mocked(api.getSnippets).mockResolvedValueOnce([]);

      const progressEvents: any[] = [];
      onLoadingProgress((progress) => {
        progressEvents.push(progress);
      });

      await loadAllArtifacts(mockProject, mockSession);

      expect(progressEvents).toContainEqual(
        expect.objectContaining({ type: 'start' })
      );
      expect(progressEvents).toContainEqual(
        expect.objectContaining({ type: 'complete' })
      );
    });

    it('should continue loading if some artifacts fail', async () => {
      const mockDiagrams: Diagram[] = [{ id: 'd1', name: 'D1' }];
      const mockDocuments: Document[] = [{ id: 'doc1', name: 'Doc1' }];

      vi.mocked(api.getDiagrams).mockResolvedValueOnce(mockDiagrams);
      vi.mocked(api.getDocuments).mockResolvedValueOnce(mockDocuments);
      vi.mocked(api.getDesigns).mockRejectedValueOnce(new Error('Design load failed'));
      vi.mocked(api.getSpreadsheets).mockResolvedValueOnce([]);
      vi.mocked(api.getSnippets).mockResolvedValueOnce([]);

      const result = await loadAllArtifacts(mockProject, mockSession);

      expect(result.diagrams).toEqual(mockDiagrams);
      expect(result.documents).toEqual(mockDocuments);
      expect(result.designs).toEqual([]);
      expect(result.totalArtifacts).toBe(2);
    });

    it('should return partial results if all loads fail', async () => {
      vi.mocked(api.getDiagrams).mockRejectedValueOnce(new Error('Failed'));
      vi.mocked(api.getDocuments).mockRejectedValueOnce(new Error('Failed'));
      vi.mocked(api.getDesigns).mockRejectedValueOnce(new Error('Failed'));
      vi.mocked(api.getSpreadsheets).mockRejectedValueOnce(new Error('Failed'));
      vi.mocked(api.getSnippets).mockRejectedValueOnce(new Error('Failed'));

      const result = await loadAllArtifacts(mockProject, mockSession);

      expect(result.totalArtifacts).toBe(0);
      expect(result.diagrams).toEqual([]);
      expect(result.documents).toEqual([]);
      expect(result.designs).toEqual([]);
      expect(result.spreadsheets).toEqual([]);
      expect(result.snippets).toEqual([]);
    });
  });

  describe('dispatchLoadingProgress', () => {
    it('should dispatch CustomEvent with progress detail', () => {
      const progress = { type: 'start' as const };

      dispatchLoadingProgress(progress);

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LOADING_PROGRESS_EVENT,
        })
      );
    });
  });

  describe('onLoadingProgress', () => {
    it('should register and call listener for progress events', async () => {
      const mockDiagrams: Diagram[] = [{ id: 'd1', name: 'D1' }];
      vi.mocked(api.getDiagrams).mockResolvedValueOnce(mockDiagrams);
      vi.mocked(api.getDocuments).mockResolvedValueOnce([]);
      vi.mocked(api.getDesigns).mockResolvedValueOnce([]);
      vi.mocked(api.getSpreadsheets).mockResolvedValueOnce([]);
      vi.mocked(api.getSnippets).mockResolvedValueOnce([]);

      const callback = vi.fn();
      const cleanup = onLoadingProgress(callback);

      await loadAllArtifacts(mockProject, mockSession);

      expect(callback).toHaveBeenCalled();
      expect(mockAddEventListener).toHaveBeenCalledWith(
        LOADING_PROGRESS_EVENT,
        expect.any(Function)
      );

      cleanup();
      expect(mockRemoveEventListener).toHaveBeenCalledWith(
        LOADING_PROGRESS_EVENT,
        expect.any(Function)
      );
    });

    it('should remove listener on cleanup', () => {
      const callback = vi.fn();
      const cleanup = onLoadingProgress(callback);

      cleanup();

      expect(mockRemoveEventListener).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should log errors to console', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Test error');

      // Mock all retries to fail with same error
      vi.mocked(api.getDiagrams)
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error);

      await loadDiagrams(mockProject, mockSession);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load diagrams:',
        'Test error'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-Error objects thrown as errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock all retries to fail
      vi.mocked(api.getDiagrams)
        .mockRejectedValueOnce('String error')
        .mockRejectedValueOnce('String error')
        .mockRejectedValueOnce('String error');

      await loadDiagrams(mockProject, mockSession);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load diagrams:',
        'String error'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('performance', () => {
    it('should load all artifacts in parallel', async () => {
      const startTime = Date.now();

      vi.mocked(api.getDiagrams).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );
      vi.mocked(api.getDocuments).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );
      vi.mocked(api.getDesigns).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );
      vi.mocked(api.getSpreadsheets).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );
      vi.mocked(api.getSnippets).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );

      await loadAllArtifacts(mockProject, mockSession);

      const elapsed = Date.now() - startTime;
      // If running sequentially, it would take 500ms (5 * 100ms)
      // If running in parallel, it should take ~100ms
      expect(elapsed).toBeLessThan(300); // Allow some overhead
    });
  });
});
