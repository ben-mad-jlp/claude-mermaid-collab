import { useQuickReplyStore } from '@/stores/quickReplyStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * Terminal theme palette — the single source of colour for the terminal subsystem
 * (xterm canvas + the session switcher, quick-reply chip bar, and message composer
 * chrome), so they always agree. Driven by the `terminalTheme` setting:
 *   'match' → follow the collab app theme (uiStore.theme), light/dark/sepia → pin.
 *
 * One flat palette (not Tailwind classes) so xterm's ITheme and the React inline
 * styles can share the exact same values.
 */

export interface TerminalPalette {
  /** xterm canvas background + the deepest surface. */
  bg: string;
  /** chrome surface (chip rail, composer, switcher rail). */
  surface: string;
  /** input/textarea/editor field background. */
  inputBg: string;
  /** active/selected row background (switcher). */
  activeBg: string;
  border: string;
  /** primary text. */
  fg: string;
  /** secondary/muted text. */
  mutedFg: string;
  /** focus ring / drag highlight / accent. */
  accent: string;
  /** compose-chip hue (a second accent, distinct from `accent`). */
  accentSoft: string;
  /** filled (send) chip background. */
  chipBg: string;
  /** Send button. */
  primary: string;
  primaryBorder: string;
  primaryFg: string;
  /** locked-chip ✓ flash. */
  success: string;
  successBorder: string;
  /** destructive (delete). */
  danger: string;
  /** textarea background while a file is dragged over it. */
  dragBg: string;
  /** xterm cursor. */
  cursor: string;
}

const DARK: TerminalPalette = {
  bg: '#0d1117', surface: '#161b22', inputBg: '#0d1117', activeBg: '#0d1117',
  border: '#30363d', fg: '#c9d1d9', mutedFg: '#8b949e',
  accent: '#58a6ff', accentSoft: '#d2a8ff', chipBg: '#21262d',
  primary: '#238636', primaryBorder: '#2ea043', primaryFg: '#ffffff',
  success: '#3fb950', successBorder: '#238636', danger: '#f85149',
  dragBg: '#10243e', cursor: '#c9d1d9',
};

const LIGHT: TerminalPalette = {
  bg: '#ffffff', surface: '#f6f8fa', inputBg: '#ffffff', activeBg: '#eaeef2',
  border: '#d0d7de', fg: '#1f2328', mutedFg: '#656d76',
  accent: '#0969da', accentSoft: '#8250df', chipBg: '#eef1f4',
  primary: '#1f883d', primaryBorder: '#1a7f37', primaryFg: '#ffffff',
  success: '#1a7f37', successBorder: '#1f883d', danger: '#cf222e',
  dragBg: '#ddf4ff', cursor: '#1f2328',
};

const SEPIA: TerminalPalette = {
  bg: '#f4ecd8', surface: '#ebe0c9', inputBg: '#fbf5e6', activeBg: '#e2d4b4',
  border: '#d9c9a6', fg: '#4b3b27', mutedFg: '#8a7553',
  accent: '#b07d2b', accentSoft: '#8a6d3b', chipBg: '#e6d9ba',
  primary: '#8a6d3b', primaryBorder: '#75592c', primaryFg: '#fbf5e6',
  success: '#5f7d3a', successBorder: '#4f6d2a', danger: '#a33a2a',
  dragBg: '#efe3c4', cursor: '#4b3b27',
};

const PALETTES: Record<'light' | 'dark' | 'sepia', TerminalPalette> = {
  light: LIGHT, dark: DARK, sepia: SEPIA,
};

/** Resolve the active palette from the terminal setting + the app theme. */
export function resolveTerminalPalette(
  setting: 'match' | 'light' | 'dark' | 'sepia',
  appTheme: 'light' | 'dark' | 'sepia',
): TerminalPalette {
  const key = setting === 'match' ? appTheme : setting;
  return PALETTES[key] ?? DARK;
}

/** Reactive hook — re-renders consumers when either the terminal setting or (in
 *  'match' mode) the app theme changes. */
export function useTerminalPalette(): TerminalPalette {
  const setting = useQuickReplyStore((s) => s.terminalTheme);
  const appTheme = useUIStore((s) => s.theme);
  return resolveTerminalPalette(setting, appTheme);
}
