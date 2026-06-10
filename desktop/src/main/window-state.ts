import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Persists the main window's size/position across launches so the app reopens
 * where the user left it. Bounds are saved on move/resize/close and restored on
 * createWindow. A saved position that no longer lands on any connected display
 * (e.g. an external monitor was unplugged) is discarded so the window can't open
 * off-screen — we fall back to the default size, centered by Electron.
 */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1100, height: 800 };

/** Read persisted state; returns null on missing/corrupt file. */
export function loadWindowState(file: string): WindowState | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<WindowState>;
    if (typeof raw.width !== 'number' || typeof raw.height !== 'number') return null;
    if (raw.width <= 0 || raw.height <= 0) return null;
    return {
      x: typeof raw.x === 'number' ? raw.x : undefined,
      y: typeof raw.y === 'number' ? raw.y : undefined,
      width: raw.width,
      height: raw.height,
      isMaximized: raw.isMaximized === true,
    };
  } catch {
    return null;
  }
}

/** Best-effort write; never throws (a failed save must not crash the app). */
export function saveWindowState(file: string, state: WindowState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  } catch {
    /* best-effort */
  }
}

/**
 * True if the saved window is visible on at least one display: its top-left
 * corner (where the title bar lives, so it can always be grabbed) must fall
 * inside some display's work area. Pure — display list is injected for testing.
 */
export function isVisibleOnAnyDisplay(state: WindowState, workAreas: WorkArea[]): boolean {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return false;
  const x = state.x;
  const y = state.y;
  return workAreas.some(
    (a) => x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height,
  );
}

/**
 * Resolve the BrowserWindow constructor bounds from saved state + the current
 * displays. Drops an off-screen position (keeps the saved size) and never
 * returns isMaximized — the caller maximizes after the window is built.
 */
export function resolveInitialBounds(
  saved: WindowState | null,
  workAreas: WorkArea[],
): WindowState {
  if (!saved) return { ...DEFAULT_WINDOW_STATE };
  const visible = isVisibleOnAnyDisplay(saved, workAreas);
  return {
    width: saved.width,
    height: saved.height,
    ...(visible ? { x: saved.x, y: saved.y } : {}),
    isMaximized: saved.isMaximized,
  };
}
