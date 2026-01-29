/**
 * useWireframe Hook Tests
 *
 * Tests verify:
 * - Hook fetches wireframe JSON from API
 * - Loading state is properly managed
 * - Error state is properly managed
 * - WebSocket subscription for live updates
 * - Cleanup on unmount
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWireframe } from '../useWireframe';
import * as websocket from '../../lib/websocket';

// Mock the WebSocket client
vi.mock('../../lib/websocket', () => ({
  getWebSocketClient: vi.fn(),
}));

describe('useWireframe', () => {
  let mockWebSocketClient: any;
  let mockFetch: any;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Mock WebSocket client
    mockWebSocketClient = {
      onMessage: vi.fn((handler) => {
        mockWebSocketClient._messageHandler = handler;
        return { unsubscribe: vi.fn() };
      }),
      onConnect: vi.fn((handler) => {
        mockWebSocketClient._connectHandler = handler;
        return { unsubscribe: vi.fn() };
      }),
      onDisconnect: vi.fn(() => ({
        unsubscribe: vi.fn(),
      })),
      subscribe: vi.fn(),
      isConnected: vi.fn(() => false),
    };

    vi.mocked(websocket.getWebSocketClient).mockReturnValue(mockWebSocketClient);

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Load', () => {
    it('should initialize with loading state', () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: {} }),
      });

      const { result } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      expect(result.current.loading).toBe(true);
      expect(result.current.wireframe).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should fetch wireframe from API on mount', async () => {
      const mockWireframeData = {
        id: 'wireframe-1',
        content: {
          viewport: 'mobile',
          direction: 'LR',
          screens: [
            {
              type: 'Screen',
              label: 'Home',
              children: [],
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockWireframeData,
      });

      const { result } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.wireframe).toEqual(mockWireframeData.content);
      expect(result.current.error).toBeNull();
    });

    it('should construct correct API URL with query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: {} }),
      });

      renderHook(() =>
        useWireframe('my-project', 'my-session', 'wire-123')
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const callArgs = mockFetch.mock.calls[0][0];
      expect(callArgs).toContain('/api/wireframe/wire-123');
      expect(callArgs).toContain('project=my-project');
      expect(callArgs).toContain('session=my-session');
    });

    it('should handle API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { result } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.wireframe).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it('should handle fetch network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.wireframe).toBeNull();
      expect(result.current.error).toContain('Network error');
    });

    it('should handle JSON parse error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const { result } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.wireframe).toBeNull();
      expect(result.current.error).toContain('Invalid JSON');
    });
  });

  describe('WebSocket Updates', () => {
    it('should subscribe to WebSocket updates on mount', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: { id: 'wireframe-1' } }),
      });

      renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      // WebSocket subscription should be set up
      expect(mockWebSocketClient.onMessage).toHaveBeenCalled();
    });

    it('should update wireframe on WebSocket message', async () => {
      const initialData = { content: { id: 'wireframe-1', name: 'Initial' } };
      const updatedContent = { id: 'wireframe-1', name: 'Updated' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => initialData,
      });

      const { result } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.wireframe).toEqual(initialData.content);

      // Simulate WebSocket message with matching ID
      act(() => {
        mockWebSocketClient._messageHandler({
          id: 'wireframe-1',
          content: updatedContent,
        });
      });

      expect(result.current.wireframe).toEqual(updatedContent);
    });

    it('should only update wireframe for matching wireframe ID', async () => {
      const initialData = { content: { id: 'wireframe-1' } };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => initialData,
      });

      const { result } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Try to update with a different wireframe ID
      const wrongIdData = {
        id: 'wireframe-2',
        content: { id: 'wireframe-2' },
      };

      act(() => {
        mockWebSocketClient._messageHandler(wrongIdData);
      });

      // Should still have the original data
      expect(result.current.wireframe).toEqual(initialData.content);
    });

    it('should handle WebSocket messages with null content gracefully', async () => {
      const initialData = { content: { id: 'wireframe-1' } };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => initialData,
      });

      const { result } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Message without content property should not crash
      act(() => {
        mockWebSocketClient._messageHandler({ id: 'wireframe-1' });
      });

      // Should still have the original data
      expect(result.current.wireframe).toEqual(initialData.content);
    });
  });

  describe('Dependency Updates', () => {
    it('should refetch when project changes', async () => {
      const data1 = { content: { project: 'project-1' } };
      const data2 = { content: { project: 'project-2' } };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => data1 })
        .mockResolvedValueOnce({ ok: true, json: async () => data2 });

      const { result, rerender } = renderHook(
        ({ project, session, id }) =>
          useWireframe(project, session, id),
        {
          initialProps: { project: 'project-1', session: 'session-1', id: 'wireframe-1' },
        }
      );

      await waitFor(() => {
        expect(result.current.wireframe).toEqual(data1.content);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Change project
      rerender({ project: 'project-2', session: 'session-1', id: 'wireframe-1' });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      expect(result.current.wireframe).toEqual(data2.content);
    });

    it('should refetch when session changes', async () => {
      const data1 = { content: { session: 'session-1' } };
      const data2 = { content: { session: 'session-2' } };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => data1 })
        .mockResolvedValueOnce({ ok: true, json: async () => data2 });

      const { result, rerender } = renderHook(
        ({ project, session, id }) =>
          useWireframe(project, session, id),
        {
          initialProps: { project: 'project-1', session: 'session-1', id: 'wireframe-1' },
        }
      );

      await waitFor(() => {
        expect(result.current.wireframe).toEqual(data1.content);
      });

      rerender({ project: 'project-1', session: 'session-2', id: 'wireframe-1' });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      expect(result.current.wireframe).toEqual(data2.content);
    });

    it('should refetch when wireframe id changes', async () => {
      const data1 = { content: { id: 'wireframe-1' } };
      const data2 = { content: { id: 'wireframe-2' } };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => data1 })
        .mockResolvedValueOnce({ ok: true, json: async () => data2 });

      const { result, rerender } = renderHook(
        ({ project, session, id }) =>
          useWireframe(project, session, id),
        {
          initialProps: { project: 'project-1', session: 'session-1', id: 'wireframe-1' },
        }
      );

      await waitFor(() => {
        expect(result.current.wireframe).toEqual(data1.content);
      });

      rerender({ project: 'project-1', session: 'session-1', id: 'wireframe-2' });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      expect(result.current.wireframe).toEqual(data2.content);
    });
  });

  describe('Cleanup', () => {
    it('should unsubscribe from WebSocket on unmount', async () => {
      const unsubscribeMock = vi.fn();
      mockWebSocketClient.onMessage.mockReturnValue({
        unsubscribe: unsubscribeMock,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: {} }),
      });

      const { unmount } = renderHook(() =>
        useWireframe('test-project', 'test-session', 'wireframe-1')
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      unmount();

      expect(unsubscribeMock).toHaveBeenCalled();
    });
  });
});
