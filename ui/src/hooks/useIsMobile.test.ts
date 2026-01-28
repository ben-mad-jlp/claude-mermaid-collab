/**
 * useIsMobile Hook Tests
 *
 * Tests verify:
 * - Mobile detection using matchMedia (< 640px)
 * - Desktop detection (>= 640px)
 * - Resize listener updates state
 * - No memory leaks from event listeners
 * - Proper cleanup on unmount
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

// Helper to create mock matchMedia
function createMockMatchMedia(matches: boolean) {
  return {
    matches,
    media: '(max-width: 639px)',
    onchange: null as ((event: MediaQueryListEvent) => void) | null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
}

describe('useIsMobile', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    // Save original matchMedia
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    // Restore original matchMedia
    window.matchMedia = originalMatchMedia;
    vi.clearAllMocks();
  });

  describe('Desktop detection', () => {
    it('should return false for desktop viewport (>= 640px)', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      const { result } = renderHook(() => useIsMobile());

      expect(result.current).toBe(false);
    });

    it('should call matchMedia with correct media query', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      const matchMediaFn = vi.fn(() => mockMatchMedia);
      window.matchMedia = matchMediaFn;

      renderHook(() => useIsMobile());

      expect(matchMediaFn).toHaveBeenCalledWith('(max-width: 639px)');
    });

    it('should add resize event listener', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      renderHook(() => useIsMobile());

      expect(mockMatchMedia.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('Mobile detection', () => {
    it('should return true for mobile viewport (< 640px)', () => {
      const mockMatchMedia = createMockMatchMedia(true);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      const { result } = renderHook(() => useIsMobile());

      expect(result.current).toBe(true);
    });
  });

  describe('Viewport changes', () => {
    it('should update state when viewport changes from desktop to mobile', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      let changeListener: ((event: MediaQueryListEvent) => void) | null = null;

      window.matchMedia = vi.fn(() => {
        // Capture the listener for manual triggering
        return {
          ...mockMatchMedia,
          addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
            if (event === 'change') {
              changeListener = listener;
            }
          }),
        };
      });

      const { result } = renderHook(() => useIsMobile());

      expect(result.current).toBe(false);

      // Simulate window resize to mobile
      if (changeListener) {
        act(() => {
          changeListener({
            matches: true,
            media: '(max-width: 639px)',
          } as MediaQueryListEvent);
        });
      }

      expect(result.current).toBe(true);
    });

    it('should update state when viewport changes from mobile to desktop', () => {
      const mockMatchMedia = createMockMatchMedia(true);
      let changeListener: ((event: MediaQueryListEvent) => void) | null = null;

      window.matchMedia = vi.fn(() => {
        return {
          ...mockMatchMedia,
          addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
            if (event === 'change') {
              changeListener = listener;
            }
          }),
        };
      });

      const { result } = renderHook(() => useIsMobile());

      expect(result.current).toBe(true);

      // Simulate window resize to desktop
      if (changeListener) {
        act(() => {
          changeListener({
            matches: false,
            media: '(max-width: 639px)',
          } as MediaQueryListEvent);
        });
      }

      expect(result.current).toBe(false);
    });

    it('should handle multiple rapid viewport changes', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      let changeListener: ((event: MediaQueryListEvent) => void) | null = null;

      window.matchMedia = vi.fn(() => {
        return {
          ...mockMatchMedia,
          addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
            if (event === 'change') {
              changeListener = listener;
            }
          }),
        };
      });

      const { result } = renderHook(() => useIsMobile());

      expect(result.current).toBe(false);

      // Rapid changes
      if (changeListener) {
        act(() => {
          changeListener({ matches: true, media: '(max-width: 639px)' } as MediaQueryListEvent);
          changeListener({ matches: false, media: '(max-width: 639px)' } as MediaQueryListEvent);
          changeListener({ matches: true, media: '(max-width: 639px)' } as MediaQueryListEvent);
        });
      }

      expect(result.current).toBe(true);
    });
  });

  describe('Memory leaks', () => {
    it('should remove event listener on unmount', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      const { unmount } = renderHook(() => useIsMobile());

      unmount();

      expect(mockMatchMedia.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should only add one event listener per hook instance', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      renderHook(() => useIsMobile());

      expect(mockMatchMedia.addEventListener).toHaveBeenCalledTimes(1);
    });

    it('should not leak listeners on multiple renders', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      const { rerender } = renderHook(() => useIsMobile());

      // Re-render multiple times
      rerender();
      rerender();
      rerender();

      // addEventListener should only be called once (in initial mount)
      expect(mockMatchMedia.addEventListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Return type', () => {
    it('should return a boolean', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      const { result } = renderHook(() => useIsMobile());

      expect(typeof result.current).toBe('boolean');
    });

    it('should always return a boolean value', () => {
      const mockMatchMedia = createMockMatchMedia(true);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      const { result } = renderHook(() => useIsMobile());

      expect([true, false]).toContain(result.current);
    });
  });

  describe('Edge cases', () => {
    it('should handle matchMedia not being available gracefully', () => {
      const originalWM = window.matchMedia;
      // @ts-ignore - intentionally breaking matchMedia for test
      window.matchMedia = undefined;

      // Should not throw
      expect(() => {
        renderHook(() => useIsMobile());
      }).not.toThrow();

      window.matchMedia = originalWM;
    });

    it('should maintain consistent state across multiple hook instances', () => {
      const mockMatchMedia = createMockMatchMedia(false);
      window.matchMedia = vi.fn(() => mockMatchMedia);

      const { result: result1 } = renderHook(() => useIsMobile());
      const { result: result2 } = renderHook(() => useIsMobile());

      expect(result1.current).toBe(result2.current);
    });
  });
});
