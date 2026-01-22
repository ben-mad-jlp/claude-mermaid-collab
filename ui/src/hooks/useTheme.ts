/**
 * useTheme Hook
 *
 * Provides React integration for theme state management with:
 * - Theme state (light/dark) from UI store
 * - Theme getter and setter methods
 * - Theme toggle functionality
 * - Persistent storage of theme preference
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore, type Theme } from '../stores/uiStore';

export interface UseThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

/**
 * Hook for accessing and managing theme state
 *
 * Provides convenient access to theme preferences from the UI store
 * with automatic persistence to localStorage
 *
 * @returns Theme state and control methods
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const { theme, toggleTheme } = useTheme();
 *
 *   return (
 *     <button onClick={toggleTheme}>
 *       Current theme: {theme}
 *     </button>
 *   );
 * }
 * ```
 */
export function useTheme(): UseThemeReturn {
  // Get theme state using shallow comparison
  const { theme, setTheme, toggleTheme } = useUIStore(
    useShallow((state) => ({
      theme: state.theme,
      setTheme: state.setTheme,
      toggleTheme: state.toggleTheme,
    }))
  );

  return {
    theme,
    setTheme: useCallback((newTheme: Theme) => {
      setTheme(newTheme);
    }, [setTheme]),
    toggleTheme: useCallback(() => {
      toggleTheme();
    }, [toggleTheme]),
  };
}
