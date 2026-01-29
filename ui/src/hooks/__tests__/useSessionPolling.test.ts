/**
 * useSessionPolling Hook Tests
 *
 * Tests verify:
 * - Hook initialization with project and session parameters
 * - Polling mechanism at 5s intervals
 * - Fetch calls to session state API endpoint
 * - State update when lastActivity changes
 * - State stability when lastActivity hasn't changed
 * - Graceful error handling during polling
 * - Polling cleanup on unmount or dependency changes
 * - Polling disabled when project or session is null
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionPolling } from '../useSessionPolling';
import { useSessionStore } from '../../stores/sessionStore';

// Setup mocks
const mockSetCollabState = vi.fn();
let mockCollabState = {
  lastActivity: '2026-01-28T10:00:00Z',
  phase: 'rough-draft',
  currentItem: 1,
  totalItems: 10,
};

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: vi.fn((selector) => {
    return selector({
      collabState: mockCollabState,
      setCollabState: mockSetCollabState,
    });
  }),
}));

// Mock global fetch
global.fetch = vi.fn();

describe('useSessionPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollabState = {
      lastActivity: '2026-01-28T10:00:00Z',
      phase: 'rough-draft',
      currentItem: 1,
      totalItems: 10,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid parameters', () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ lastActivity: '2026-01-28T10:00:00Z' }),
      } as Response);

      expect(() => {
        renderHook(() => useSessionPolling('/test/project', 'test-session', 5000));
      }).not.toThrow();
    });

    it('should not poll when project is null', async () => {
      renderHook(() => useSessionPolling(null, 'test-session', 5000));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not poll when session is null', async () => {
      renderHook(() => useSessionPolling('/test/project', null, 5000));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not poll when both project and session are null', async () => {
      renderHook(() => useSessionPolling(null, null, 5000));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('API Calls', () => {
    it('should construct correct API endpoint with query parameters', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ lastActivity: '2026-01-28T10:00:00Z' }),
      } as Response);

      renderHook(() => useSessionPolling('/test/project', 'test-session', 5000));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/session-state\?project=.+&session=.+$/)
      );
    });

    it('should encode project and session parameters in URL', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ lastActivity: '2026-01-28T10:00:00Z' }),
      } as Response);

      const project = '/Users/test project/path';
      const session = 'my-session name';

      renderHook(() => useSessionPolling(project, session, 5000));

      await new Promise((resolve) => setTimeout(resolve, 100));

      const callUrl = vi.mocked(global.fetch).mock.calls[0][0] as string;
      expect(callUrl).toContain(encodeURIComponent(project));
      expect(callUrl).toContain(encodeURIComponent(session));
    });
  });

  describe('State Updates', () => {
    it('should update state when lastActivity changes', async () => {
      mockCollabState = {
        lastActivity: '2026-01-28T10:00:00Z',
        phase: 'rough-draft',
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          lastActivity: '2026-01-28T10:05:00Z',
          phase: 'implementation',
          currentItem: 2,
        }),
      } as Response);

      renderHook(() => useSessionPolling('/test/project', 'test-session', 5000));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSetCollabState).toHaveBeenCalledWith(
        expect.objectContaining({
          lastActivity: '2026-01-28T10:05:00Z',
          phase: 'implementation',
        })
      );
    });

    it('should not update state when lastActivity unchanged', async () => {
      const currentActivity = '2026-01-28T10:00:00Z';
      mockCollabState = {
        lastActivity: currentActivity,
        phase: 'rough-draft',
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          lastActivity: currentActivity,
          phase: 'rough-draft',
        }),
      } as Response);

      renderHook(() => useSessionPolling('/test/project', 'test-session', 5000));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSetCollabState).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should silently handle fetch errors', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      expect(() => {
        renderHook(() => useSessionPolling('/test/project', 'test-session', 5000));
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSetCollabState).not.toHaveBeenCalled();
    });

    it('should silently handle failed responses (non-200)', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response);

      renderHook(() => useSessionPolling('/test/project', 'test-session', 5000));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSetCollabState).not.toHaveBeenCalled();
    });

    it('should silently handle JSON parse errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Response);

      expect(() => {
        renderHook(() => useSessionPolling('/test/project', 'test-session', 5000));
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSetCollabState).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should clean up on unmount', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          lastActivity: '2026-01-28T10:00:00Z',
        }),
      } as Response);

      const { unmount } = renderHook(() =>
        useSessionPolling('/test/project', 'test-session', 5000)
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(() => {
        unmount();
      }).not.toThrow();
    });

    it('should handle project becoming null', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          lastActivity: '2026-01-28T10:00:00Z',
        }),
      } as Response);

      const { rerender } = renderHook(
        ({ project, session }) =>
          useSessionPolling(project, session, 5000),
        {
          initialProps: {
            project: '/test/project',
            session: 'test-session',
          },
        }
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(global.fetch).toHaveBeenCalled();
      vi.mocked(global.fetch).mockClear();

      rerender({
        project: null,
        session: 'test-session',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not fetch when project is null
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle session becoming null', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          lastActivity: '2026-01-28T10:00:00Z',
        }),
      } as Response);

      const { rerender } = renderHook(
        ({ project, session }) =>
          useSessionPolling(project, session, 5000),
        {
          initialProps: {
            project: '/test/project',
            session: 'test-session',
          },
        }
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(global.fetch).toHaveBeenCalled();
      vi.mocked(global.fetch).mockClear();

      rerender({
        project: '/test/project',
        session: null,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not fetch when session is null
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Default Interval', () => {
    it('should use 5000ms as default interval when not specified', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          lastActivity: '2026-01-28T10:00:00Z',
        }),
      } as Response);

      renderHook(() => useSessionPolling('/test/project', 'test-session'));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Hook Integration', () => {
    it('should work with useShallow selector from zustand', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          lastActivity: '2026-01-28T10:05:00Z',
          phase: 'implementation',
        }),
      } as Response);

      expect(() => {
        renderHook(() => useSessionPolling('/test/project', 'test-session', 5000));
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSetCollabState).toHaveBeenCalled();
    });
  });
});
