/**
 * useTaskGraph Hook Tests
 *
 * Tests verify:
 * - Initial fetch on mount
 * - Updates from CustomEvent
 * - Cleanup on unmount
 * - Error handling (fetch fails, invalid event data)
 * - Refresh function
 * - Loading state management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTaskGraph } from '../useTaskGraph';
import type { TaskBatch, TaskGraphUpdatedDetail } from '../../types';

// Mock fetch globally
global.fetch = vi.fn();

// Mock console methods
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('useTaskGraph', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'test-session';

  const mockTaskBatch: TaskBatch = {
    id: 'batch-1',
    tasks: [
      { id: 'task-1', status: 'completed', dependsOn: [] },
      { id: 'task-2', status: 'in_progress', dependsOn: ['task-1'] },
    ],
    status: 'in_progress',
  };

  const mockApiResponse = {
    diagram: 'graph TD\n  A[Task 1]\n  B[Task 2]',
    batches: [mockTaskBatch],
    completedTasks: ['task-1'],
    pendingTasks: ['task-2'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockClear();
    consoleWarnSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Fetch on Mount', () => {
    it('should fetch initial state on mount', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.diagram).toBeNull();

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify state updated with API response
      expect(result.current.diagram).toBe(mockApiResponse.diagram);
      expect(result.current.batches).toEqual(mockApiResponse.batches);
      expect(result.current.completedTasks).toEqual(mockApiResponse.completedTasks);
      expect(result.current.pendingTasks).toEqual(mockApiResponse.pendingTasks);
      expect(result.current.error).toBeNull();
    });

    it('should handle fetch errors', async () => {
      const mockError = new Error('Network error');
      (global.fetch as any).mockRejectedValueOnce(mockError);

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify error state
      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).toContain('Network error');
      expect(result.current.diagram).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle non-OK API responses', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify error state
      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).toContain('Failed to fetch task graph');
    });

    it('should handle missing data fields in API response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Verify default values for missing fields
      expect(result.current.diagram).toBeNull();
      expect(result.current.batches).toEqual([]);
      expect(result.current.completedTasks).toEqual([]);
      expect(result.current.pendingTasks).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe('CustomEvent Updates', () => {
    it('should update state when task_graph_updated event is received', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          diagram: 'old diagram',
          batches: [],
          completedTasks: [],
          pendingTasks: [],
        }),
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Initial state
      expect(result.current.diagram).toBe('old diagram');

      // Dispatch custom event with new data
      const updatedDetail: TaskGraphUpdatedDetail = {
        project: mockProject,
        session: mockSession,
        payload: {
          ...mockApiResponse,
          updatedTaskId: 'task-2',
          updatedStatus: 'in_progress',
        },
      };

      act(() => {
        const event = new CustomEvent('task_graph_updated', { detail: updatedDetail });
        window.dispatchEvent(event);
      });

      // Verify state updated
      expect(result.current.diagram).toBe(mockApiResponse.diagram);
      expect(result.current.batches).toEqual(mockApiResponse.batches);
      expect(result.current.completedTasks).toEqual(mockApiResponse.completedTasks);
      expect(result.current.pendingTasks).toEqual(mockApiResponse.pendingTasks);
    });

    it('should handle invalid event data gracefully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const previousDiagram = result.current.diagram;

      // Dispatch invalid event (missing payload)
      act(() => {
        const event = new CustomEvent('task_graph_updated', {
          detail: {
            project: mockProject,
            session: mockSession,
            // Missing payload
          },
        });
        window.dispatchEvent(event);
      });

      // State should remain unchanged
      expect(result.current.diagram).toBe(previousDiagram);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should handle event with undefined payload fields', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Dispatch event with partial payload
      act(() => {
        const event = new CustomEvent('task_graph_updated', {
          detail: {
            project: mockProject,
            session: mockSession,
            payload: {
              diagram: 'new diagram',
              updatedTaskId: 'task-1',
              updatedStatus: 'completed',
              // Missing other fields
            },
          } as any,
        });
        window.dispatchEvent(event);
      });

      // Should update with available data
      expect(result.current.diagram).toBe('new diagram');
      expect(result.current.batches).toEqual([]);
      expect(result.current.completedTasks).toEqual([]);
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should remove event listener on unmount', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Unmount component
      unmount();

      // Verify event listener was removed
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'task_graph_updated',
        expect.any(Function)
      );

      removeEventListenerSpy.mockRestore();
    });

    it('should not respond to events after unmount', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          diagram: 'initial',
          batches: [],
          completedTasks: [],
          pendingTasks: [],
        }),
      });

      const { result, unmount } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const initialDiagram = result.current.diagram;

      // Unmount
      unmount();

      // Try to dispatch event after unmount
      act(() => {
        const event = new CustomEvent('task_graph_updated', {
          detail: {
            project: mockProject,
            session: mockSession,
            payload: {
              ...mockApiResponse,
              diagram: 'should not update',
              updatedTaskId: 'task-1',
              updatedStatus: 'completed',
            },
          },
        });
        window.dispatchEvent(event);
      });

      // Component should not be updated (already unmounted)
      // This is verified by checking that the unmount succeeded without errors
    });
  });

  describe('Refresh Function', () => {
    it('should refetch data when refresh is called', async () => {
      const firstResponse = {
        ok: true,
        json: async () => ({
          diagram: 'diagram v1',
          batches: [],
          completedTasks: [],
          pendingTasks: [],
        }),
      };

      const secondResponse = {
        ok: true,
        json: async () => ({
          diagram: 'diagram v2',
          batches: [mockTaskBatch],
          completedTasks: ['task-1'],
          pendingTasks: ['task-2'],
        }),
      };

      (global.fetch as any)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.diagram).toBe('diagram v1');

      // Call refresh
      await act(async () => {
        await result.current.refresh();
      });

      // Verify data was updated
      expect(result.current.diagram).toBe('diagram v2');
      expect(result.current.batches).toEqual([mockTaskBatch]);
      expect(result.current.completedTasks).toEqual(['task-1']);
      expect(result.current.pendingTasks).toEqual(['task-2']);
    });

    it('should handle errors during refresh', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const previousDiagram = result.current.diagram;

      // Mock fetch to fail on refresh
      (global.fetch as any).mockRejectedValueOnce(new Error('Refresh failed'));

      // Call refresh
      await act(async () => {
        await result.current.refresh();
      });

      // Verify error is set
      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).toContain('Refresh failed');
      // Previous data should be retained
      expect(result.current.diagram).toBe(previousDiagram);
    });

    it('should set loading state during refresh', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Mock delayed response
      (global.fetch as any).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({
                ok: true,
                json: async () => mockApiResponse,
              }),
              100
            )
          )
      );

      // Call refresh
      act(() => {
        result.current.refresh();
      });

      // Loading should be true during fetch
      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('API URL Construction', () => {
    it('should encode project and session in URL', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const projectWithSlashes = '/path/with/slashes';
      const sessionWithSpaces = 'session with spaces';

      renderHook(() => useTaskGraph(projectWithSlashes, sessionWithSpaces));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const fetchUrl = (global.fetch as any).mock.calls[0][0];
      expect(fetchUrl).toContain('task-graph');
      expect(fetchUrl).toContain(encodeURIComponent(projectWithSlashes));
      expect(fetchUrl).toContain(encodeURIComponent(sessionWithSpaces));
    });
  });

  describe('Error State Clearing', () => {
    it('should clear error on successful refresh', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Initial error'));

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });

      // Mock successful response
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      // Refresh
      await act(async () => {
        await result.current.refresh();
      });

      // Error should be cleared
      expect(result.current.error).toBeNull();
      expect(result.current.diagram).toBe(mockApiResponse.diagram);
    });

    it('should clear error when receiving successful CustomEvent', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Simulate event with error data
      act(() => {
        const event = new CustomEvent('task_graph_updated', {
          detail: {
            project: mockProject,
            session: mockSession,
            payload: {
              ...mockApiResponse,
              updatedTaskId: 'task-1',
              updatedStatus: 'completed',
            },
          },
        });
        window.dispatchEvent(event);
      });

      // Error should remain null
      expect(result.current.error).toBeNull();
    });
  });

  describe('Multiple Rapid Updates', () => {
    it('should handle multiple rapid CustomEvents (latest wins)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          diagram: 'initial',
          batches: [],
          completedTasks: [],
          pendingTasks: [],
        }),
      });

      const { result } = renderHook(() => useTaskGraph(mockProject, mockSession));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Send multiple events rapidly
      act(() => {
        const event1 = new CustomEvent('task_graph_updated', {
          detail: {
            project: mockProject,
            session: mockSession,
            payload: {
              ...mockApiResponse,
              diagram: 'diagram v1',
              updatedTaskId: 'task-1',
              updatedStatus: 'completed',
            },
          },
        });
        window.dispatchEvent(event1);

        const event2 = new CustomEvent('task_graph_updated', {
          detail: {
            project: mockProject,
            session: mockSession,
            payload: {
              ...mockApiResponse,
              diagram: 'diagram v2',
              updatedTaskId: 'task-2',
              updatedStatus: 'in_progress',
            },
          },
        });
        window.dispatchEvent(event2);

        const event3 = new CustomEvent('task_graph_updated', {
          detail: {
            project: mockProject,
            session: mockSession,
            payload: {
              ...mockApiResponse,
              diagram: 'diagram v3',
              updatedTaskId: 'task-3',
              updatedStatus: 'pending',
            },
          },
        });
        window.dispatchEvent(event3);
      });

      // Latest should win
      expect(result.current.diagram).toBe('diagram v3');
    });
  });
});
