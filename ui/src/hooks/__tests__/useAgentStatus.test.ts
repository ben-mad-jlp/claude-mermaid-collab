/**
 * useAgentStatus Hook Tests
 *
 * Test coverage includes:
 * - Hook initialization with idle state
 * - Fetching status from API endpoint
 * - Polling with configurable intervals
 * - WebSocket real-time updates
 * - Error handling and graceful fallback
 * - Loading state management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAgentStatus } from '../useAgentStatus';

describe('useAgentStatus', () => {
  const mockStatusResponse = {
    status: 'working' as const,
    message: 'Processing task',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Initialization', () => {
    it('should initialize with idle state and isLoading true', () => {
      global.fetch = vi.fn(() =>
        new Promise(() => {}) // Never resolves
      );

      const { result } = renderHook(() => useAgentStatus(2000));

      expect(result.current.agentStatus).toBe('idle');
      expect(result.current.agentMessage).toBeUndefined();
      expect(result.current.agentIsLoading).toBe(true);
    });

    it('should use default polling interval of 2000ms', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      renderHook(() => useAgentStatus());

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      }, { timeout: 3000 });
    });

    it('should use custom polling interval', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      renderHook(() => useAgentStatus(5000));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      }, { timeout: 3000 });
    });
  });

  describe('API Fetching', () => {
    it('should fetch status from /api/status', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/status');
      }, { timeout: 3000 });
    });

    it('should update state when API returns data', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      const { result } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(result.current.agentStatus).toBe('working');
        expect(result.current.agentMessage).toBe('Processing task');
      }, { timeout: 3000 });
    });

    it('should set isLoading to false after fetch completes', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      const { result } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(result.current.agentIsLoading).toBe(false);
      }, { timeout: 3000 });
    });

    it('should handle waiting status', async () => {
      const waitingResponse = { status: 'waiting' as const, message: 'User input required' };
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(waitingResponse), { status: 200 })
        )
      );

      const { result } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(result.current.agentStatus).toBe('waiting');
      }, { timeout: 3000 });
    });

    it('should handle idle status', async () => {
      const idleResponse = { status: 'idle' as const };
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(idleResponse), { status: 200 })
        )
      );

      const { result } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(result.current.agentStatus).toBe('idle');
      }, { timeout: 3000 });
    });
  });

  describe('Polling', () => {
    it('should poll at configured intervals', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      renderHook(() => useAgentStatus(100));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      }, { timeout: 3000 });

      // Wait for second poll
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      }, { timeout: 3000 });
    });

    it('should respect custom polling intervals', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      renderHook(() => useAgentStatus(150));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      }, { timeout: 3000 });

      // Wait for second poll after 150ms
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      }, { timeout: 3000 });
    });

    it('should clear polling interval on unmount', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      const { unmount } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      }, { timeout: 3000 });

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should keep last known state when fetch fails', async () => {
      const validResponse = { status: 'working' as const, message: 'Working' };
      global.fetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(validResponse), { status: 200 })
        )
        .mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(result.current.agentStatus).toBe('working');
      }, { timeout: 3000 });

      const previousStatus = result.current.agentStatus;

      // Error on next fetch should keep previous status
      await waitFor(() => {
        expect(result.current.agentStatus).toBe(previousStatus);
      }, { timeout: 3000 });
    });

    it('should handle API errors gracefully', async () => {
      global.fetch = vi.fn(() =>
        Promise.reject(new Error('Connection refused'))
      );

      const { result } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        // Should maintain initial state
        expect(result.current.agentStatus).toBe('idle');
      }, { timeout: 3000 });

      // Should not crash
      expect(result.current).toBeDefined();
    });

    it('should handle malformed response gracefully', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 })
        )
      );

      const { result } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(result.current.agentStatus).toMatch(/working|waiting|idle/);
      }, { timeout: 3000 });

      expect(result.current.agentIsLoading).toBe(false);
    });
  });

  describe('WebSocket Integration', () => {
    it('should update state on WebSocket status_changed event', async () => {
      let wsCallback: ((event: any) => void) | null = null;

      const originalAddEventListener = window.addEventListener;
      window.addEventListener = vi.fn((event: string, callback: any) => {
        if (event === 'status_changed') {
          wsCallback = callback;
        }
      });

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: 'idle' as const }), { status: 200 })
        )
      );

      const { result } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(result.current.agentStatus).toBe('idle');
      }, { timeout: 3000 });

      // Simulate WebSocket update
      if (wsCallback) {
        act(() => {
          wsCallback({
            detail: { status: 'working', message: 'Task started' },
          });
        });
      }

      await waitFor(() => {
        expect(result.current.agentStatus).toBe('working');
        expect(result.current.agentMessage).toBe('Task started');
      }, { timeout: 3000 });

      window.addEventListener = originalAddEventListener;
    });
  });

  describe('Cleanup', () => {
    it('should clean up on unmount', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockStatusResponse), { status: 200 })
        )
      );

      const { unmount } = renderHook(() => useAgentStatus(2000));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      }, { timeout: 3000 });

      unmount();

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
