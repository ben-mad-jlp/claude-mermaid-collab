/**
 * useNavHistory Hook
 *
 * Bounded navigation history stack for cross-file navigation. Push when
 * the user jumps to a new location; call back() to pop and return the
 * most recent entry. Max 20 entries by default — oldest entries are
 * evicted when the cap is exceeded.
 *
 * Uses a ref mirror so back() can read the current stack synchronously,
 * which is important for rapid consecutive back() calls.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface NavEntry {
  snippetId: string;
  line: number;
}

export interface NavHistory {
  entries: NavEntry[];
  push: (entry: NavEntry) => void;
  back: () => NavEntry | null;
  clear: () => void;
  canGoBack: boolean;
}

const DEFAULT_MAX_ENTRIES = 20;

export function useNavHistory(maxEntries: number = DEFAULT_MAX_ENTRIES): NavHistory {
  const [entries, setEntries] = useState<NavEntry[]>([]);
  const entriesRef = useRef<NavEntry[]>([]);

  // Keep ref mirror in sync with state
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const push = useCallback((entry: NavEntry) => {
    setEntries(prev => {
      const next = [...prev, entry];
      while (next.length > maxEntries) {
        next.shift();
      }
      // Keep ref in sync synchronously so rapid push → back reads fresh state
      entriesRef.current = next;
      return next;
    });
  }, [maxEntries]);

  const back = useCallback((): NavEntry | null => {
    const current = entriesRef.current;
    if (current.length === 0) return null;
    const entry = current[current.length - 1];
    const newEntries = current.slice(0, -1);
    // Mutate ref synchronously so rapid back() calls see fresh state
    entriesRef.current = newEntries;
    setEntries(newEntries);
    return entry;
  }, []);

  const clear = useCallback(() => {
    entriesRef.current = [];
    setEntries([]);
  }, []);

  return {
    entries,
    push,
    back,
    clear,
    canGoBack: entries.length > 0,
  };
}
