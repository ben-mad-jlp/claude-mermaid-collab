/**
 * useIsDesktop — true at/above Tailwind's `lg` breakpoint (1024px).
 *
 * Shared so the Bridge's SplitDeck (split orientation) and the FleetGraph
 * (dagre rankdir LR vs TB) flip on the SAME signal, and so the responsive
 * switch is done in JS — letting both panes stay mounted exactly once instead
 * of a CSS show/hide that would risk double-mounting the subscription-bearing
 * graph. SSR / jsdom (no matchMedia) defaults to desktop.
 */

import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(DESKTOP_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export default useIsDesktop;
