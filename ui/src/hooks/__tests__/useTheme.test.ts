/**
 * useTheme Hook Tests
 *
 * Tests verify:
 * - Hook initialization with current theme
 * - Theme getter and setter
 * - Theme toggle functionality
 * - Persistence via UI store
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../useTheme';
import { useUIStore } from '../../stores/uiStore';

describe('useTheme', () => {
  beforeEach(() => {
    // Clear localStorage and reset store before each test
    localStorage.clear();
    useUIStore.getState().reset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initialization', () => {
    it('should initialize with theme from store', () => {
      const { result } = renderHook(() => useTheme());

      // Should have a valid theme
      expect(['light', 'dark']).toContain(result.current.theme);
    });

    it('should match UI store theme', () => {
      const { result } = renderHook(() => useTheme());
      const storeTheme = useUIStore.getState().theme;

      expect(result.current.theme).toBe(storeTheme);
    });
  });

  describe('Theme Management', () => {
    it('should set theme to light', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      expect(result.current.theme).toBe('light');
    });

    it('should set theme to dark', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
    });

    it('should persist theme change to store', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(useUIStore.getState().theme).toBe('dark');
    });
  });

  describe('Theme Toggle', () => {
    it('should toggle from light to dark', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
    });

    it('should toggle from dark to light', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');
    });

    it('should toggle multiple times', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      const initial = result.current.theme;

      act(() => {
        result.current.toggleTheme();
      });

      const after1 = result.current.theme;
      expect(after1).not.toBe(initial);

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe(initial);
    });
  });

  describe('Persistence', () => {
    it('should persist theme to localStorage via UI store', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      const stored = localStorage.getItem('ui-preferences');
      expect(stored).toBeDefined();

      if (stored) {
        const data = JSON.parse(stored);
        expect(data.state.theme).toBe('dark');
      }
    });
  });

  describe('Multiple Hooks', () => {
    it('should share state between multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useTheme());
      const { result: result2 } = renderHook(() => useTheme());

      act(() => {
        result1.current.setTheme('dark');
      });

      expect(result2.current.theme).toBe('dark');
    });

    it('should update all hooks when one changes theme', () => {
      const { result: result1 } = renderHook(() => useTheme());
      const { result: result2 } = renderHook(() => useTheme());
      const { result: result3 } = renderHook(() => useTheme());

      act(() => {
        result1.current.toggleTheme();
      });

      expect(result2.current.theme).toBe(result1.current.theme);
      expect(result3.current.theme).toBe(result1.current.theme);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid theme changes', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
        result.current.toggleTheme();
        result.current.toggleTheme();
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
    });
  });
});
