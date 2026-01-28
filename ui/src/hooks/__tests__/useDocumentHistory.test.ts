/**
 * useDocumentHistory Hook Tests
 *
 * Tests verify:
 * - Hook initialization with correct default state
 * - Fetching document history from API
 * - Loading and error states
 * - Handling 404 (no history) gracefully
 * - Refetching on document ID change
 * - getVersionAt function for specific timestamps
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDocumentHistory } from '../useDocumentHistory';
import { useSessionStore } from '../../stores/sessionStore';

describe('useDocumentHistory', () => {
  const mockHistoryResponse = {
    original: 'Initial content',
    changes: [
      {
        timestamp: '2024-01-15T10:00:00Z',
        diff: { oldString: 'Initial', newString: 'Updated' },
      },
      {
        timestamp: '2024-01-15T11:00:00Z',
        diff: { oldString: 'Updated', newString: 'Final' },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().reset();
    // Set up a session
    useSessionStore.getState().setCurrentSession({
      project: '/test/project',
      name: 'test-session',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with null history and not loading when documentId is null', () => {
      const { result } = renderHook(() => useDocumentHistory(null));

      expect(result.current.history).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should start loading when documentId is provided', async () => {
      global.fetch = vi.fn(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      expect(result.current.isLoading).toBe(true);
    });

    it('should have refetch function', () => {
      const { result } = renderHook(() => useDocumentHistory(null));

      expect(typeof result.current.refetch).toBe('function');
    });

    it('should have getVersionAt function', () => {
      const { result } = renderHook(() => useDocumentHistory(null));

      expect(typeof result.current.getVersionAt).toBe('function');
    });
  });

  describe('Fetching History', () => {
    it('should fetch history from correct API endpoint', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockHistoryResponse), { status: 200 })
        )
      );

      renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/document/doc-1/history?project=%2Ftest%2Fproject&session=test-session'
        );
      });
    });

    it('should set history data on successful fetch', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockHistoryResponse), { status: 200 })
        )
      );

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(result.current.history).toEqual(mockHistoryResponse);
      });
    });

    it('should set isLoading to false after fetch completes', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockHistoryResponse), { status: 200 })
        )
      );

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should not fetch when project is not set', async () => {
      useSessionStore.getState().setCurrentSession(null);
      global.fetch = vi.fn();

      renderHook(() => useDocumentHistory('doc-1'));

      // Wait a bit to ensure no fetch happens
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should set error on non-ok response', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response('Server error', { status: 500 }))
      );

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to load history');
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should set error on network failure', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(result.current.error).toBe('Network error');
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should set history to null on 404 (no history yet)', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response('Not found', { status: 404 }))
      );

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(result.current.history).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('Refetch', () => {
    it('should refetch when refetch is called', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockHistoryResponse), { status: 200 })
        )
      );

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await result.current.refetch();
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should refetch when documentId changes', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockHistoryResponse), { status: 200 })
        )
      );

      const { result, rerender } = renderHook(
        ({ docId }) => useDocumentHistory(docId),
        { initialProps: { docId: 'doc-1' } }
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      rerender({ docId: 'doc-2' });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch).toHaveBeenLastCalledWith(
          '/api/document/doc-2/history?project=%2Ftest%2Fproject&session=test-session'
        );
      });
    });
  });

  describe('getVersionAt', () => {
    it('should fetch version at specific timestamp', async () => {
      const versionResponse = {
        content: 'Content at timestamp',
        timestamp: '2024-01-15T10:00:00Z',
      };

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockHistoryResponse), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(versionResponse), { status: 200 })
        );

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(result.current.history).not.toBeNull();
      });

      let content: string | null = null;
      await act(async () => {
        content = await result.current.getVersionAt('2024-01-15T10:00:00Z');
      });

      expect(content).toBe('Content at timestamp');
      expect(global.fetch).toHaveBeenLastCalledWith(
        '/api/document/doc-1/version?project=%2Ftest%2Fproject&session=test-session&timestamp=2024-01-15T10%3A00%3A00Z'
      );
    });

    it('should return null when version fetch fails', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockHistoryResponse), { status: 200 })
        )
        .mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(result.current.history).not.toBeNull();
      });

      let content: string | null = 'not-null';
      await act(async () => {
        content = await result.current.getVersionAt('2024-01-15T10:00:00Z');
      });

      expect(content).toBeNull();
    });

    it('should return null when documentId is null', async () => {
      const { result } = renderHook(() => useDocumentHistory(null));

      let content: string | null = 'not-null';
      await act(async () => {
        content = await result.current.getVersionAt('2024-01-15T10:00:00Z');
      });

      expect(content).toBeNull();
    });

    it('should return null when session is not set', async () => {
      useSessionStore.getState().setCurrentSession(null);

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      let content: string | null = 'not-null';
      await act(async () => {
        content = await result.current.getVersionAt('2024-01-15T10:00:00Z');
      });

      expect(content).toBeNull();
    });
  });

  describe('Session Changes', () => {
    it('should clear history when session changes', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockHistoryResponse), { status: 200 })
        )
      );

      const { result } = renderHook(() => useDocumentHistory('doc-1'));

      await waitFor(() => {
        expect(result.current.history).toEqual(mockHistoryResponse);
      });

      // Change session - this clears history
      act(() => {
        useSessionStore.getState().setCurrentSession({
          project: '/different/project',
          name: 'different-session',
        });
      });

      // History should be refetched for the new session
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/document/doc-1/history?project=%2Fdifferent%2Fproject&session=different-session'
        );
      });
    });
  });
});
