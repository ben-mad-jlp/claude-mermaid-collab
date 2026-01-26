/**
 * useSyncScroll Hook Tests
 *
 * Tests verify:
 * - Synchronized scrolling between editor and preview
 * - Debouncing prevents infinite scroll loops
 * - Toggle, enable, disable sync controls
 * - Cleanup on unmount
 * - Edge cases (division by zero, missing refs)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useSyncScroll } from './useSyncScroll';

// Helper to create mock scroll elements
function createMockElement(options: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
} = {}): HTMLElement {
  const element = {
    scrollTop: options.scrollTop ?? 0,
    scrollHeight: options.scrollHeight ?? 1000,
    clientHeight: options.clientHeight ?? 500,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement;
  return element;
}

describe('useSyncScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Initial state', () => {
    it('should initialize with enabled state from options', () => {
      const editorRef = { current: createMockElement() };
      const previewRef = { current: createMockElement() };

      const { result } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      expect(result.current.isSynced).toBe(true);
    });

    it('should initialize with disabled state from options', () => {
      const editorRef = { current: createMockElement() };
      const previewRef = { current: createMockElement() };

      const { result } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: false,
        })
      );

      expect(result.current.isSynced).toBe(false);
    });
  });

  describe('Sync controls', () => {
    it('should toggle sync on/off with toggleSync', () => {
      const editorRef = { current: createMockElement() };
      const previewRef = { current: createMockElement() };

      const { result } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      expect(result.current.isSynced).toBe(true);

      act(() => {
        result.current.toggleSync();
      });

      expect(result.current.isSynced).toBe(false);

      act(() => {
        result.current.toggleSync();
      });

      expect(result.current.isSynced).toBe(true);
    });

    it('should enable sync with enableSync', () => {
      const editorRef = { current: createMockElement() };
      const previewRef = { current: createMockElement() };

      const { result } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: false,
        })
      );

      expect(result.current.isSynced).toBe(false);

      act(() => {
        result.current.enableSync();
      });

      expect(result.current.isSynced).toBe(true);
    });

    it('should disable sync with disableSync', () => {
      const editorRef = { current: createMockElement() };
      const previewRef = { current: createMockElement() };

      const { result } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      expect(result.current.isSynced).toBe(true);

      act(() => {
        result.current.disableSync();
      });

      expect(result.current.isSynced).toBe(false);
    });
  });

  describe('Event listeners', () => {
    it('should add scroll event listeners when synced', () => {
      const editor = createMockElement();
      const preview = createMockElement();
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      expect(editor.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(preview.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    });

    it('should not add event listeners when not synced', () => {
      const editor = createMockElement();
      const preview = createMockElement();
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: false,
        })
      );

      expect(editor.addEventListener).not.toHaveBeenCalled();
      expect(preview.addEventListener).not.toHaveBeenCalled();
    });

    it('should remove event listeners on cleanup', () => {
      const editor = createMockElement();
      const preview = createMockElement();
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      const { unmount } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      unmount();

      expect(editor.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(preview.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    });

    it('should remove event listeners when sync is disabled', () => {
      const editor = createMockElement();
      const preview = createMockElement();
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      const { result } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      // Initially added
      expect(editor.addEventListener).toHaveBeenCalledTimes(1);
      expect(preview.addEventListener).toHaveBeenCalledTimes(1);

      // Disable sync
      act(() => {
        result.current.disableSync();
      });

      // Event listeners should be removed
      expect(editor.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(preview.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    });
  });

  describe('Scroll synchronization', () => {
    it('should sync preview scroll when editor scrolls', () => {
      const editor = createMockElement({
        scrollTop: 250,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const preview = createMockElement({
        scrollTop: 0,
        scrollHeight: 2000,
        clientHeight: 500,
      });
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
          debounceMs: 16,
        })
      );

      // Get the scroll handler
      const editorScrollHandler = (editor.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // Simulate editor scroll
      act(() => {
        editorScrollHandler();
        vi.advanceTimersByTime(16);
      });

      // Preview should be scrolled proportionally
      // Editor: 250 / (1000 - 500) = 0.5
      // Preview target: 0.5 * (2000 - 500) = 750
      expect(preview.scrollTop).toBe(750);
    });

    it('should sync editor scroll when preview scrolls', () => {
      const editor = createMockElement({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const preview = createMockElement({
        scrollTop: 750,
        scrollHeight: 2000,
        clientHeight: 500,
      });
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
          debounceMs: 16,
        })
      );

      // Get the scroll handler
      const previewScrollHandler = (preview.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // Simulate preview scroll
      act(() => {
        previewScrollHandler();
        vi.advanceTimersByTime(16);
      });

      // Editor should be scrolled proportionally
      // Preview: 750 / (2000 - 500) = 0.5
      // Editor target: 0.5 * (1000 - 500) = 250
      expect(editor.scrollTop).toBe(250);
    });
  });

  describe('Debouncing', () => {
    it('should use default debounce of 16ms', () => {
      const editor = createMockElement({ scrollTop: 250, scrollHeight: 1000, clientHeight: 500 });
      const preview = createMockElement({ scrollHeight: 2000, clientHeight: 500 });
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      const editorScrollHandler = (editor.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // Trigger scroll
      act(() => {
        editorScrollHandler();
      });

      // Not applied yet (within debounce)
      expect(preview.scrollTop).toBe(0);

      // Advance past debounce
      act(() => {
        vi.advanceTimersByTime(16);
      });

      // Now applied
      expect(preview.scrollTop).toBe(750);
    });

    it('should respect custom debounce time', () => {
      const editor = createMockElement({ scrollTop: 250, scrollHeight: 1000, clientHeight: 500 });
      const preview = createMockElement({ scrollHeight: 2000, clientHeight: 500 });
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
          debounceMs: 100,
        })
      );

      const editorScrollHandler = (editor.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // Trigger scroll
      act(() => {
        editorScrollHandler();
      });

      // Not applied at 50ms
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(preview.scrollTop).toBe(0);

      // Applied at 100ms
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(preview.scrollTop).toBe(750);
    });
  });

  describe('Edge cases', () => {
    it('should handle null refs gracefully', () => {
      const editorRef = { current: null };
      const previewRef = { current: null };

      // Should not throw
      expect(() =>
        renderHook(() =>
          useSyncScroll({
            editorRef,
            previewRef,
            enabled: true,
          })
        )
      ).not.toThrow();
    });

    it('should handle editor ref null gracefully', () => {
      const editorRef = { current: null };
      const preview = createMockElement();
      const previewRef = { current: preview };

      expect(() =>
        renderHook(() =>
          useSyncScroll({
            editorRef,
            previewRef,
            enabled: true,
          })
        )
      ).not.toThrow();

      // No event listeners should be added to preview
      expect(preview.addEventListener).not.toHaveBeenCalled();
    });

    it('should handle preview ref null gracefully', () => {
      const editor = createMockElement();
      const editorRef = { current: editor };
      const previewRef = { current: null };

      expect(() =>
        renderHook(() =>
          useSyncScroll({
            editorRef,
            previewRef,
            enabled: true,
          })
        )
      ).not.toThrow();

      // No event listeners should be added to editor
      expect(editor.addEventListener).not.toHaveBeenCalled();
    });

    it('should handle zero scrollable height (content fits without scrolling)', () => {
      const editor = createMockElement({
        scrollTop: 0,
        scrollHeight: 500, // Same as clientHeight
        clientHeight: 500,
      });
      const preview = createMockElement({
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 500,
      });
      const editorRef = { current: editor };
      const previewRef = { current: preview };

      renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
          debounceMs: 16,
        })
      );

      const editorScrollHandler = (editor.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][1];

      // Should not throw on division by zero
      expect(() => {
        act(() => {
          editorScrollHandler();
          vi.advanceTimersByTime(16);
        });
      }).not.toThrow();

      // Preview should be at 0 (ratio is 0 when scrollable height is 0)
      expect(preview.scrollTop).toBe(0);
    });
  });

  describe('Return type', () => {
    it('should return isSynced, toggleSync, enableSync, disableSync', () => {
      const editorRef = { current: createMockElement() };
      const previewRef = { current: createMockElement() };

      const { result } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      expect(result.current).toHaveProperty('isSynced');
      expect(result.current).toHaveProperty('toggleSync');
      expect(result.current).toHaveProperty('enableSync');
      expect(result.current).toHaveProperty('disableSync');
      expect(typeof result.current.isSynced).toBe('boolean');
      expect(typeof result.current.toggleSync).toBe('function');
      expect(typeof result.current.enableSync).toBe('function');
      expect(typeof result.current.disableSync).toBe('function');
    });

    it('should maintain stable function references', () => {
      const editorRef = { current: createMockElement() };
      const previewRef = { current: createMockElement() };

      const { result, rerender } = renderHook(() =>
        useSyncScroll({
          editorRef,
          previewRef,
          enabled: true,
        })
      );

      const initialToggleSync = result.current.toggleSync;
      const initialEnableSync = result.current.enableSync;
      const initialDisableSync = result.current.disableSync;

      // Re-render
      rerender();

      // Functions should be stable (same references)
      expect(result.current.toggleSync).toBe(initialToggleSync);
      expect(result.current.enableSync).toBe(initialEnableSync);
      expect(result.current.disableSync).toBe(initialDisableSync);
    });
  });
});
