/**
 * useIsMobile Hook
 *
 * Mobile detection hook using matchMedia to detect screens < 640px.
 * Updates state when window resizes.
 * Properly cleans up event listeners on unmount.
 */

import { useState, useEffect } from 'react';

/**
 * Hook for detecting mobile viewport (< 640px width).
 * Uses window.matchMedia with resize listener to update on viewport changes.
 *
 * @returns boolean - true if viewport width is < 640px, false otherwise
 *
 * @example
 * ```tsx
 * function App() {
 *   const isMobile = useIsMobile();
 *
 *   return isMobile ? <MobileLayout /> : <DesktopLayout />;
 * }
 * ```
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    // Initialize based on current viewport
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      const mediaQuery = window.matchMedia('(max-width: 639px)');
      return mediaQuery.matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // Ensure window is available (client-side only)
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const mediaQuery = window.matchMedia('(max-width: 639px)');

      // Handle media query changes
      const handleChange = (e: MediaQueryListEvent) => {
        setIsMobile(e.matches);
      };

      // Add listener for viewport changes
      mediaQuery.addEventListener('change', handleChange);

      // Cleanup function to remove listener
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    } catch {
      // If matchMedia is not supported, do nothing
      return;
    }
  }, []);

  return isMobile;
}

export default useIsMobile;
