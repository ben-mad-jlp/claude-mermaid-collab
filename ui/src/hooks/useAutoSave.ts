/**
 * useAutoSave Hook
 *
 * Provides automatic saving functionality with debouncing:
 * - Tracks content changes against original content
 * - Debounces save operations by configurable delay (default 2s)
 * - Tracks saving state and last saved timestamp
 * - Handles async save operations with error handling
 * - Cleans up timers on unmount
 */

import { useState, useRef, useEffect, useCallback } from 'react';

export interface UseAutoSaveReturn {
  isSaving: boolean;
  lastSaved: number | null;
  hasUnsavedChanges: boolean;
}

const DEFAULT_DELAY = 2000;

/**
 * Hook for automatic content saving with debounce
 *
 * Monitors content changes and triggers save after a delay of inactivity.
 * Useful for editors that need to auto-save without overwhelming the server.
 *
 * @param content - The current content to monitor for changes
 * @param onSave - Async callback to perform the save operation
 * @param delay - Debounce delay in milliseconds (default: 2000ms)
 * @returns Object with isSaving, lastSaved timestamp, and hasUnsavedChanges flag
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const [content, setContent] = useState('');
 *   const { isSaving, lastSaved, hasUnsavedChanges } = useAutoSave(
 *     content,
 *     async (content) => {
 *       await api.saveDocument(content);
 *     },
 *     2000
 *   );
 *
 *   return (
 *     <div>
 *       <textarea value={content} onChange={(e) => setContent(e.target.value)} />
 *       {isSaving && <span>Saving...</span>}
 *       {hasUnsavedChanges && <span>Unsaved changes</span>}
 *       {lastSaved && <span>Last saved: {new Date(lastSaved).toLocaleTimeString()}</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAutoSave(
  content: string,
  onSave: (content: string) => Promise<void>,
  delay: number = DEFAULT_DELAY
): UseAutoSaveReturn {
  // State for tracking save status
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Refs for tracking original content and debounce timer
  const originalContentRef = useRef<string>(content);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref to track if component is mounted (for async safety)
  const isMountedRef = useRef(true);

  // Stable reference to onSave to avoid effect re-runs
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Perform the save operation
  const performSave = useCallback(async (contentToSave: string) => {
    if (!isMountedRef.current) return;

    setIsSaving(true);
    try {
      await onSaveRef.current(contentToSave);

      if (isMountedRef.current) {
        const now = Date.now();
        setLastSaved(now);
        originalContentRef.current = contentToSave;
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      // Log error but don't throw - the hook consumer can implement
      // their own error handling in the onSave callback
      console.error('Auto-save failed:', error);
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }, []);

  // Watch for content changes and trigger debounced save
  useEffect(() => {
    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Check if content has changed from original
    if (content !== originalContentRef.current) {
      setHasUnsavedChanges(true);

      // Start new debounce timer
      debounceTimerRef.current = setTimeout(() => {
        performSave(content);
      }, delay);
    } else {
      setHasUnsavedChanges(false);
    }

    // Cleanup timer on effect re-run
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [content, delay, performSave]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  return {
    isSaving,
    lastSaved,
    hasUnsavedChanges,
  };
}
