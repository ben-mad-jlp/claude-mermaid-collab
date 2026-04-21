import * as React from 'react';

/**
 * Keeps a scroll container pinned to the bottom while the user is "near bottom".
 *
 * - On mount and when `resetKey` changes (e.g. session switch), snaps to bottom.
 * - While the user is within `threshold` px of the bottom, auto-scrolls on any
 *   content size change (streaming tokens, new messages, tool cards, etc.).
 * - If the user scrolls up past the threshold, stick-to-bottom disengages and
 *   does NOT yank them back.
 * - Scrolling back into the threshold re-engages stick-to-bottom.
 *
 * Uses a ResizeObserver on the inner content element so it reacts to any
 * layout change without needing the parent to track streaming state.
 *
 * Returns refs to attach to the scroll container and the inner content.
 */
export function useStickyBottom<
  TContainer extends HTMLElement,
  TContent extends HTMLElement,
>(options?: { threshold?: number; resetKey?: unknown }) {
  const threshold = options?.threshold ?? 40;
  const resetKey = options?.resetKey;

  const containerRef = React.useRef<TContainer | null>(null);
  const contentRef = React.useRef<TContent | null>(null);
  // Start pinned; decay only if the user explicitly scrolls up.
  const pinnedRef = React.useRef(true);
  const rafRef = React.useRef<number | null>(null);

  const scrollToBottom = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const c = containerRef.current;
      if (!c) return;
      c.scrollTop = c.scrollHeight;
    });
  }, []);

  const isNearBottom = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= threshold;
  }, [threshold]);

  // Snap to bottom on mount / when resetKey changes (e.g. new session).
  React.useLayoutEffect(() => {
    pinnedRef.current = true;
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  // Observe content size changes; if pinned, keep at bottom.
  React.useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) {
        scrollToBottom();
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // Update pinned flag as the user scrolls.
  const onScroll = React.useCallback(() => {
    pinnedRef.current = isNearBottom();
  }, [isNearBottom]);

  React.useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { containerRef, contentRef, onScroll, scrollToBottom };
}
