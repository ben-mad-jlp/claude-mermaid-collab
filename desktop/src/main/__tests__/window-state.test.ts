import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadWindowState,
  saveWindowState,
  isVisibleOnAnyDisplay,
  resolveInitialBounds,
  DEFAULT_WINDOW_STATE,
} from '../window-state';

const DISPLAYS = [
  { x: 0, y: 0, width: 1440, height: 900 },
  { x: 1440, y: 0, width: 1920, height: 1080 }, // a second monitor to the right
];

describe('loadWindowState / saveWindowState', () => {
  it('round-trips a saved state', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'winstate-')), 'window-state.json');
    saveWindowState(file, { x: 100, y: 200, width: 1200, height: 850, isMaximized: false });
    expect(loadWindowState(file)).toEqual({
      x: 100, y: 200, width: 1200, height: 850, isMaximized: false,
    });
  });

  it('returns null for a missing file', () => {
    expect(loadWindowState(join(tmpdir(), 'does-not-exist-winstate.json'))).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'winstate-')), 'window-state.json');
    writeFileSync(file, '{ not json');
    expect(loadWindowState(file)).toBeNull();
  });

  it('rejects non-positive or non-numeric dimensions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winstate-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ width: 0, height: 800 }));
    expect(loadWindowState(bad)).toBeNull();
    writeFileSync(bad, JSON.stringify({ width: '900', height: 800 }));
    expect(loadWindowState(bad)).toBeNull();
  });

  it('saveWindowState never throws on an unwritable path', () => {
    expect(() => saveWindowState('/proc/should-not-write/window-state.json', DEFAULT_WINDOW_STATE)).not.toThrow();
  });
});

describe('isVisibleOnAnyDisplay', () => {
  it('true when the top-left corner falls inside a display', () => {
    expect(isVisibleOnAnyDisplay({ x: 50, y: 50, width: 1100, height: 800 }, DISPLAYS)).toBe(true);
    expect(isVisibleOnAnyDisplay({ x: 1500, y: 100, width: 1100, height: 800 }, DISPLAYS)).toBe(true);
  });

  it('false when the corner is off every display (unplugged monitor)', () => {
    expect(isVisibleOnAnyDisplay({ x: 4000, y: 100, width: 1100, height: 800 }, DISPLAYS)).toBe(false);
    expect(isVisibleOnAnyDisplay({ x: -2000, y: 0, width: 1100, height: 800 }, DISPLAYS)).toBe(false);
  });

  it('false when no position was saved', () => {
    expect(isVisibleOnAnyDisplay({ width: 1100, height: 800 }, DISPLAYS)).toBe(false);
  });
});

describe('resolveInitialBounds', () => {
  it('returns the default size when there is no saved state', () => {
    expect(resolveInitialBounds(null, DISPLAYS)).toEqual({ ...DEFAULT_WINDOW_STATE });
  });

  it('keeps a visible saved position', () => {
    const r = resolveInitialBounds({ x: 60, y: 70, width: 1200, height: 850 }, DISPLAYS);
    expect(r).toEqual({ x: 60, y: 70, width: 1200, height: 850, isMaximized: undefined });
  });

  it('drops an off-screen position but keeps the saved size', () => {
    const r = resolveInitialBounds({ x: 5000, y: 70, width: 1200, height: 850 }, DISPLAYS);
    expect(r.x).toBeUndefined();
    expect(r.y).toBeUndefined();
    expect(r.width).toBe(1200);
    expect(r.height).toBe(850);
  });

  it('carries through isMaximized', () => {
    const r = resolveInitialBounds({ x: 60, y: 70, width: 1200, height: 850, isMaximized: true }, DISPLAYS);
    expect(r.isMaximized).toBe(true);
  });
});
