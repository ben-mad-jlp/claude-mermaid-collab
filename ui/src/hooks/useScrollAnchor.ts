/**
 * useScrollAnchor Hook
 *
 * Anchors a scroll container to its bottom when the user is near the bottom:
 * - Tracks whether the user is within `threshold` px of the bottom
 * - Auto-scrolls when content grows (via ResizeObserver) if near bottom
 * - Exposes an imperative `scrollToBottom` helper
 * - SSR-safe: guards window and ResizeObserver access
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseScrollAnchorOptions {
  /** Distance from bottom (px) considered "near bottom" (default: 80) */
  threshold?: number;
  /** Scroll behavior used for auto-scroll and scrollToBottom (default: 'auto') */
  behavior?: ScrollBehavior;
}

export interface UseScrollAnchorResult<T extends HTMLElement> {
  /** Ref to attach to the scroll container */
  containerRef: { current: T | null };
  /** Whether the user is currently within threshold of the bottom */
  isNearBottom: boolean;
  /** Imperatively scroll the container to the bottom */
  scrollToBottom: (opts?: { behavior?: ScrollBehavior }) => void;
}

/**
 * Hook that keeps a scroll container pinned to the bottom while the user is
 * near the bottom, but leaves it alone once they scroll up.
 */
export function useScrollAnchor<T extends HTMLElement = HTMLDivElement>(
  options?: UseScrollAnchorOptions
): UseScrollAnchorResult<T> {
  const threshold = options?.threshold ?? 80;
  const behavior = options?.behavior ?? 'auto';
  const [el, setEl] = useState<T | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);

  useEffect(() => {
    isNearBottomRef.current = isNearBottom;
  }, [isNearBottom]);

  const containerRef = useMemo<{ current: T | null }>(() => ({
    get current() {
      return el;
    },
    set current(v: T | null) {
      setEl(v);
    },
  }), [el]);

  // Scroll listener: track whether user is near bottom
  useEffect(() => {
    if (!el || typeof window === 'undefined') return;

    const recompute = () => {
      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      setIsNearBottom(distance <= threshold);
    };

    recompute();
    el.addEventListener('scroll', recompute, { passive: true } as AddEventListenerOptions);
    return () => el.removeEventListener('scroll', recompute);
  }, [el, threshold]);

  // ResizeObserver: auto-scroll when content grows AND user is near bottom
  useEffect(() => {
    if (
      !el ||
      typeof window === 'undefined' ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }

    prevScrollHeightRef.current = el.scrollHeight;

    const ro = new ResizeObserver(() => {
      const prev = prevScrollHeightRef.current;
      const next = el.scrollHeight;
      if (next > prev && isNearBottomRef.current) {
        try {
          el.scrollTo({ top: next, behavior });
        } catch {
          el.scrollTop = next;
        }
      }
      prevScrollHeightRef.current = next;
    });

    ro.observe(el);
    const child = el.firstElementChild;
    if (child) ro.observe(child);

    return () => ro.disconnect();
  }, [el, behavior]);

  const scrollToBottom = useCallback(
    (opts?: { behavior?: ScrollBehavior }) => {
      if (!el) return;
      const b = opts?.behavior ?? behavior;
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: b });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
      setIsNearBottom(true);
    },
    [el, behavior]
  );

  return { containerRef, isNearBottom, scrollToBottom };
}

export default useScrollAnchor;
