/**
 * useDiagramUpdateQueue Hook
 *
 * Provides batched diagram update functionality with debouncing:
 * - Queues multiple updates to the same diagram
 * - Only applies the latest update per diagram when flushed
 * - Debounces updates by configurable delay (default 100ms)
 * - Supports immediate flush for critical operations
 * - Cleans up timers on unmount
 */

import { useCallback, useRef, useEffect } from 'react';

interface PendingUpdate {
  id: string;
  content: string;
  lastModified: number;
}

interface UseDiagramUpdateQueueOptions {
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Hook for batching diagram updates with debounce
 *
 * Queues updates and applies them in batches to reduce API calls.
 * Useful for rapid color updates or other frequent diagram modifications.
 *
 * @param updateDiagram - Callback to apply the update
 * @param options - Configuration options (debounceMs)
 * @returns Object with queueUpdate and flushNow functions
 *
 * @example
 * ```tsx
 * function DiagramEditor() {
 *   const { queueUpdate, flushNow } = useDiagramUpdateQueue(
 *     (id, updates) => {
 *       api.updateDiagram(id, updates);
 *     },
 *     { debounceMs: 100 }
 *   );
 *
 *   const handleColorChange = (diagramId: string, newContent: string) => {
 *     queueUpdate(diagramId, newContent, Date.now());
 *   };
 *
 *   const handleSave = () => {
 *     flushNow(); // Apply all pending updates immediately
 *   };
 * }
 * ```
 */
export function useDiagramUpdateQueue(
  updateDiagram: (id: string, updates: { content: string; lastModified: number }) => void,
  options: UseDiagramUpdateQueueOptions = {}
) {
  const { debounceMs = DEFAULT_DEBOUNCE_MS } = options;

  // Map of pending updates by diagram ID
  const pending = useRef<Map<string, PendingUpdate>>(new Map());

  // Debounce timer reference
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable reference to updateDiagram to avoid effect re-runs
  const updateDiagramRef = useRef(updateDiagram);
  updateDiagramRef.current = updateDiagram;

  /**
   * Flush all pending updates atomically
   */
  const flush = useCallback(() => {
    const updates = pending.current;
    if (updates.size === 0) return;

    // Apply all pending updates
    updates.forEach((update) => {
      updateDiagramRef.current(update.id, {
        content: update.content,
        lastModified: update.lastModified,
      });
    });

    // Clear the pending map
    pending.current = new Map();
  }, []);

  /**
   * Queue an update for a diagram
   * If an update for the same diagram already exists, it will be replaced
   */
  const queueUpdate = useCallback(
    (id: string, content: string, lastModified: number) => {
      // Add or replace the update in the pending map
      pending.current.set(id, { id, content, lastModified });

      // Clear existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      // Start new debounce timer
      timerRef.current = setTimeout(() => {
        flush();
        timerRef.current = null;
      }, debounceMs);
    },
    [debounceMs, flush]
  );

  /**
   * Cancel timer and flush immediately
   */
  const flushNow = useCallback(() => {
    // Cancel any pending timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Flush immediately
    flush();
  }, [flush]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { queueUpdate, flushNow };
}
