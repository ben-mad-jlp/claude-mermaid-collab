/**
 * Tests for useNavHistory hook — bounded navigation history stack.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNavHistory, type NavEntry } from '../useNavHistory';

describe('useNavHistory', () => {
  describe('Initialization', () => {
    it('should initialize with empty entries', () => {
      const { result } = renderHook(() => useNavHistory());
      expect(result.current.entries).toEqual([]);
    });

    it('should initialize with canGoBack false', () => {
      const { result } = renderHook(() => useNavHistory());
      expect(result.current.canGoBack).toBe(false);
    });
  });

  describe('push', () => {
    it('should add an entry to the stack', () => {
      const { result } = renderHook(() => useNavHistory());
      const entry: NavEntry = { snippetId: 'a', line: 1 };
      act(() => {
        result.current.push(entry);
      });
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0]).toEqual(entry);
      expect(result.current.canGoBack).toBe(true);
    });

    it('should append entries in order', () => {
      const { result } = renderHook(() => useNavHistory());
      const first: NavEntry = { snippetId: 'a', line: 1 };
      const second: NavEntry = { snippetId: 'b', line: 2 };
      act(() => {
        result.current.push(first);
        result.current.push(second);
      });
      expect(result.current.entries).toEqual([first, second]);
    });

    it('should evict oldest entry when exceeding default max of 20', () => {
      const { result } = renderHook(() => useNavHistory());
      act(() => {
        for (let i = 0; i <= 20; i++) {
          result.current.push({ snippetId: `s${i}`, line: i });
        }
      });
      expect(result.current.entries).toHaveLength(20);
      expect(result.current.entries[0].snippetId).toBe('s1');
      expect(result.current.entries[19].snippetId).toBe('s20');
    });

    it('should respect a custom maxEntries parameter', () => {
      const { result } = renderHook(() => useNavHistory(3));
      act(() => {
        for (let i = 0; i < 5; i++) {
          result.current.push({ snippetId: `s${i}`, line: i });
        }
      });
      expect(result.current.entries).toHaveLength(3);
      expect(result.current.entries[0].snippetId).toBe('s2');
    });
  });

  describe('back', () => {
    it('should return null when history is empty', () => {
      const { result } = renderHook(() => useNavHistory());
      let popped: NavEntry | null = null;
      act(() => {
        popped = result.current.back();
      });
      expect(popped).toBeNull();
      expect(result.current.entries).toEqual([]);
    });

    it('should pop and return the most recent entry', () => {
      const { result } = renderHook(() => useNavHistory());
      const entry: NavEntry = { snippetId: 'a', line: 10 };
      act(() => {
        result.current.push(entry);
      });
      let popped: NavEntry | null = null;
      act(() => {
        popped = result.current.back();
      });
      expect(popped).toEqual(entry);
      expect(result.current.entries).toEqual([]);
      expect(result.current.canGoBack).toBe(false);
    });

    it('should support multiple sequential back calls', () => {
      const { result } = renderHook(() => useNavHistory());
      const a: NavEntry = { snippetId: 'a', line: 1 };
      const b: NavEntry = { snippetId: 'b', line: 2 };
      const c: NavEntry = { snippetId: 'c', line: 3 };
      act(() => {
        result.current.push(a);
        result.current.push(b);
        result.current.push(c);
      });
      let popped1: NavEntry | null = null;
      let popped2: NavEntry | null = null;
      let popped3: NavEntry | null = null;
      act(() => {
        popped1 = result.current.back();
        popped2 = result.current.back();
        popped3 = result.current.back();
      });
      expect(popped1).toEqual(c);
      expect(popped2).toEqual(b);
      expect(popped3).toEqual(a);
      expect(result.current.entries).toEqual([]);
    });

    it('should return null after exhausting history', () => {
      const { result } = renderHook(() => useNavHistory());
      act(() => {
        result.current.push({ snippetId: 'a', line: 1 });
      });
      act(() => {
        result.current.back();
      });
      let popped: NavEntry | null = null;
      act(() => {
        popped = result.current.back();
      });
      expect(popped).toBeNull();
    });
  });

  describe('clear', () => {
    it('should empty entries and reset canGoBack', () => {
      const { result } = renderHook(() => useNavHistory());
      act(() => {
        result.current.push({ snippetId: 'a', line: 1 });
        result.current.push({ snippetId: 'b', line: 2 });
      });
      act(() => {
        result.current.clear();
      });
      expect(result.current.entries).toEqual([]);
      expect(result.current.canGoBack).toBe(false);
    });

    it('should be a no-op on empty history', () => {
      const { result } = renderHook(() => useNavHistory());
      expect(() => {
        act(() => {
          result.current.clear();
        });
      }).not.toThrow();
      expect(result.current.entries).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle interleaved push and back operations', () => {
      const { result } = renderHook(() => useNavHistory());
      const a: NavEntry = { snippetId: 'a', line: 1 };
      const b: NavEntry = { snippetId: 'b', line: 2 };
      const c: NavEntry = { snippetId: 'c', line: 3 };
      act(() => {
        result.current.push(a);
        result.current.push(b);
      });
      act(() => {
        result.current.back();
      });
      act(() => {
        result.current.push(c);
      });
      expect(result.current.entries).toEqual([a, c]);
    });

    it('should handle maxEntries of 1', () => {
      const { result } = renderHook(() => useNavHistory(1));
      const a: NavEntry = { snippetId: 'a', line: 1 };
      const b: NavEntry = { snippetId: 'b', line: 2 };
      act(() => {
        result.current.push(a);
        result.current.push(b);
      });
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0]).toEqual(b);
    });
  });
});
