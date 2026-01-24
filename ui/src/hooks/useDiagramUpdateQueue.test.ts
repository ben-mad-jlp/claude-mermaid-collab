/**
 * useDiagramUpdateQueue Hook Tests
 *
 * Tests verify:
 * - Batching multiple updates to same diagram (only latest applied)
 * - Debounce timer resets on new updates
 * - flushNow applies updates immediately
 * - Cleanup on unmount
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiagramUpdateQueue } from './useDiagramUpdateQueue';

describe('useDiagramUpdateQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Batching updates', () => {
    it('should batch multiple updates to the same diagram and only apply latest', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      // Queue multiple updates to the same diagram
      act(() => {
        result.current.queueUpdate('diagram-1', 'content-v1', 1000);
        result.current.queueUpdate('diagram-1', 'content-v2', 2000);
        result.current.queueUpdate('diagram-1', 'content-v3', 3000);
      });

      // No updates applied yet (debouncing)
      expect(updateDiagram).not.toHaveBeenCalled();

      // Advance timer past debounce period
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Only the latest update should be applied
      expect(updateDiagram).toHaveBeenCalledTimes(1);
      expect(updateDiagram).toHaveBeenCalledWith('diagram-1', {
        content: 'content-v3',
        lastModified: 3000,
      });
    });

    it('should apply updates to different diagrams separately', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      // Queue updates to different diagrams
      act(() => {
        result.current.queueUpdate('diagram-1', 'content-1', 1000);
        result.current.queueUpdate('diagram-2', 'content-2', 2000);
        result.current.queueUpdate('diagram-3', 'content-3', 3000);
      });

      // Advance timer
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // All three diagrams should be updated
      expect(updateDiagram).toHaveBeenCalledTimes(3);
      expect(updateDiagram).toHaveBeenCalledWith('diagram-1', {
        content: 'content-1',
        lastModified: 1000,
      });
      expect(updateDiagram).toHaveBeenCalledWith('diagram-2', {
        content: 'content-2',
        lastModified: 2000,
      });
      expect(updateDiagram).toHaveBeenCalledWith('diagram-3', {
        content: 'content-3',
        lastModified: 3000,
      });
    });

    it('should batch updates across multiple diagrams with latest per diagram', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      // Queue multiple updates to multiple diagrams
      act(() => {
        result.current.queueUpdate('diagram-1', 'content-1-v1', 1000);
        result.current.queueUpdate('diagram-2', 'content-2-v1', 1100);
        result.current.queueUpdate('diagram-1', 'content-1-v2', 1200);
        result.current.queueUpdate('diagram-2', 'content-2-v2', 1300);
      });

      // Advance timer
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Only latest for each diagram
      expect(updateDiagram).toHaveBeenCalledTimes(2);
      expect(updateDiagram).toHaveBeenCalledWith('diagram-1', {
        content: 'content-1-v2',
        lastModified: 1200,
      });
      expect(updateDiagram).toHaveBeenCalledWith('diagram-2', {
        content: 'content-2-v2',
        lastModified: 1300,
      });
    });
  });

  describe('Debounce timer', () => {
    it('should reset debounce timer on new updates', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      // Queue first update
      act(() => {
        result.current.queueUpdate('diagram-1', 'content-v1', 1000);
      });

      // Advance timer but not past debounce
      act(() => {
        vi.advanceTimersByTime(80);
      });

      // No updates yet
      expect(updateDiagram).not.toHaveBeenCalled();

      // Queue another update (should reset timer)
      act(() => {
        result.current.queueUpdate('diagram-1', 'content-v2', 2000);
      });

      // Advance by 80ms again (160ms total, but only 80ms since last update)
      act(() => {
        vi.advanceTimersByTime(80);
      });

      // Still no updates (timer was reset)
      expect(updateDiagram).not.toHaveBeenCalled();

      // Advance remaining 20ms
      act(() => {
        vi.advanceTimersByTime(20);
      });

      // Now the latest update should be applied
      expect(updateDiagram).toHaveBeenCalledTimes(1);
      expect(updateDiagram).toHaveBeenCalledWith('diagram-1', {
        content: 'content-v2',
        lastModified: 2000,
      });
    });

    it('should use default debounce of 100ms', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() => useDiagramUpdateQueue(updateDiagram));

      act(() => {
        result.current.queueUpdate('diagram-1', 'content', 1000);
      });

      // Not flushed at 99ms
      act(() => {
        vi.advanceTimersByTime(99);
      });
      expect(updateDiagram).not.toHaveBeenCalled();

      // Flushed at 100ms
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(updateDiagram).toHaveBeenCalledTimes(1);
    });

    it('should respect custom debounce time', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 500 })
      );

      act(() => {
        result.current.queueUpdate('diagram-1', 'content', 1000);
      });

      // Not flushed at 499ms
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(updateDiagram).not.toHaveBeenCalled();

      // Flushed at 500ms
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(updateDiagram).toHaveBeenCalledTimes(1);
    });
  });

  describe('flushNow', () => {
    it('should apply updates immediately when flushNow is called', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      act(() => {
        result.current.queueUpdate('diagram-1', 'content', 1000);
      });

      // Not flushed yet
      expect(updateDiagram).not.toHaveBeenCalled();

      // Flush immediately
      act(() => {
        result.current.flushNow();
      });

      // Update applied immediately
      expect(updateDiagram).toHaveBeenCalledTimes(1);
      expect(updateDiagram).toHaveBeenCalledWith('diagram-1', {
        content: 'content',
        lastModified: 1000,
      });
    });

    it('should cancel pending timer when flushNow is called', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      act(() => {
        result.current.queueUpdate('diagram-1', 'content', 1000);
      });

      // Flush immediately
      act(() => {
        result.current.flushNow();
      });

      expect(updateDiagram).toHaveBeenCalledTimes(1);

      // Advance timer past debounce period
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Should not be called again (timer was cancelled)
      expect(updateDiagram).toHaveBeenCalledTimes(1);
    });

    it('should do nothing if no pending updates', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      // Flush with no pending updates
      act(() => {
        result.current.flushNow();
      });

      expect(updateDiagram).not.toHaveBeenCalled();
    });

    it('should clear pending updates after flushNow', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      act(() => {
        result.current.queueUpdate('diagram-1', 'content', 1000);
        result.current.flushNow();
      });

      expect(updateDiagram).toHaveBeenCalledTimes(1);

      // Flush again - should not call updateDiagram
      act(() => {
        result.current.flushNow();
      });

      expect(updateDiagram).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup on unmount', () => {
    it('should clear timer on unmount', () => {
      const updateDiagram = vi.fn();
      const { result, unmount } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      // Queue an update
      act(() => {
        result.current.queueUpdate('diagram-1', 'content', 1000);
      });

      // Unmount before timer fires
      unmount();

      // Advance timer
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Update should not be applied (timer was cleared)
      expect(updateDiagram).not.toHaveBeenCalled();
    });

    it('should not throw on unmount with no pending updates', () => {
      const updateDiagram = vi.fn();
      const { unmount } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Return type', () => {
    it('should return queueUpdate and flushNow functions', () => {
      const updateDiagram = vi.fn();
      const { result } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      expect(result.current).toHaveProperty('queueUpdate');
      expect(result.current).toHaveProperty('flushNow');
      expect(typeof result.current.queueUpdate).toBe('function');
      expect(typeof result.current.flushNow).toBe('function');
    });

    it('should maintain stable function references', () => {
      const updateDiagram = vi.fn();
      const { result, rerender } = renderHook(() =>
        useDiagramUpdateQueue(updateDiagram, { debounceMs: 100 })
      );

      const initialQueueUpdate = result.current.queueUpdate;
      const initialFlushNow = result.current.flushNow;

      // Re-render
      rerender();

      // Functions should be stable (same references)
      expect(result.current.queueUpdate).toBe(initialQueueUpdate);
      expect(result.current.flushNow).toBe(initialFlushNow);
    });
  });
});
