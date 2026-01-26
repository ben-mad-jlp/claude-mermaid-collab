/**
 * useSyncScroll Hook
 *
 * Provides synchronized scrolling between editor and preview panes:
 * - Uses proportional scroll position (scrollTop / scrollHeight)
 * - Debounces scroll events to prevent feedback loops
 * - Tracks scroll source to prevent infinite scroll loops
 * - Supports enabling/disabling sync programmatically
 */

import { RefObject, useState, useRef, useEffect, useCallback } from 'react';

export interface SyncScrollOptions {
  /** Editor scroll container ref */
  editorRef: RefObject<HTMLElement>;
  /** Preview scroll container ref */
  previewRef: RefObject<HTMLElement>;
  /** Whether sync is enabled */
  enabled: boolean;
  /** Debounce delay in ms (default: 16) */
  debounceMs?: number;
}

export interface SyncScrollReturn {
  /** Current sync enabled state */
  isSynced: boolean;
  /** Toggle sync on/off */
  toggleSync: () => void;
  /** Enable sync */
  enableSync: () => void;
  /** Disable sync */
  disableSync: () => void;
}

/**
 * Simple debounce utility function
 */
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return ((...args: unknown[]) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  }) as T;
}

/**
 * Hook for synchronized scrolling between editor and preview panes.
 * Uses proportional scroll position (scrollTop / scrollHeight).
 *
 * @param options - Configuration options for sync scrolling
 * @returns Object with sync state and control functions
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const editorRef = useRef<HTMLDivElement>(null);
 *   const previewRef = useRef<HTMLDivElement>(null);
 *
 *   const { isSynced, toggleSync } = useSyncScroll({
 *     editorRef,
 *     previewRef,
 *     enabled: true,
 *   });
 *
 *   return (
 *     <div>
 *       <button onClick={toggleSync}>
 *         {isSynced ? 'Disable' : 'Enable'} Sync
 *       </button>
 *       <div ref={editorRef} style={{ overflow: 'auto' }}>
 *         {/* Editor content *\/}
 *       </div>
 *       <div ref={previewRef} style={{ overflow: 'auto' }}>
 *         {/* Preview content *\/}
 *       </div>
 *     </div>
 *   );
 * }
 * ```
 */
export function useSyncScroll(options: SyncScrollOptions): SyncScrollReturn {
  const { editorRef, previewRef, enabled, debounceMs = 16 } = options;

  const [isSynced, setIsSynced] = useState(enabled);
  const scrollSource = useRef<'editor' | 'preview' | null>(null);

  const toggleSync = useCallback(() => setIsSynced((prev) => !prev), []);
  const enableSync = useCallback(() => setIsSynced(true), []);
  const disableSync = useCallback(() => setIsSynced(false), []);

  useEffect(() => {
    if (!isSynced) return;

    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;

    const handleEditorScroll = debounce(() => {
      if (scrollSource.current === 'preview') return;
      scrollSource.current = 'editor';

      // Calculate proportional position
      const scrollableHeight = editor.scrollHeight - editor.clientHeight;
      // Handle edge case: if content fits without scrolling, ratio is 0
      const scrollRatio = scrollableHeight > 0 ? editor.scrollTop / scrollableHeight : 0;
      const targetScrollableHeight = preview.scrollHeight - preview.clientHeight;
      const targetScroll = scrollRatio * targetScrollableHeight;

      preview.scrollTop = targetScroll;

      setTimeout(() => {
        scrollSource.current = null;
      }, debounceMs);
    }, debounceMs);

    const handlePreviewScroll = debounce(() => {
      if (scrollSource.current === 'editor') return;
      scrollSource.current = 'preview';

      // Calculate proportional position
      const scrollableHeight = preview.scrollHeight - preview.clientHeight;
      // Handle edge case: if content fits without scrolling, ratio is 0
      const scrollRatio = scrollableHeight > 0 ? preview.scrollTop / scrollableHeight : 0;
      const targetScrollableHeight = editor.scrollHeight - editor.clientHeight;
      const targetScroll = scrollRatio * targetScrollableHeight;

      editor.scrollTop = targetScroll;

      setTimeout(() => {
        scrollSource.current = null;
      }, debounceMs);
    }, debounceMs);

    editor.addEventListener('scroll', handleEditorScroll);
    preview.addEventListener('scroll', handlePreviewScroll);

    return () => {
      editor.removeEventListener('scroll', handleEditorScroll);
      preview.removeEventListener('scroll', handlePreviewScroll);
    };
  }, [isSynced, editorRef, previewRef, debounceMs]);

  return { isSynced, toggleSync, enableSync, disableSync };
}

export default useSyncScroll;
