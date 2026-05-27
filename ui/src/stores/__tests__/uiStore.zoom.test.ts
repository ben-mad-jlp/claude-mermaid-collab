import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../uiStore.js';

const MIN_ZOOM_LEVEL = 60;
const MAX_ZOOM_LEVEL = 160;

beforeEach(() => {
  useUIStore.setState({ zoomLevel: 100 });
});

describe('uiStore zoom behavior', () => {
  it('zoomIn increments by 10', () => {
    useUIStore.getState().zoomIn();
    expect(useUIStore.getState().zoomLevel).toBe(110);
  });

  it('zoomOut decrements by 10', () => {
    useUIStore.getState().zoomOut();
    expect(useUIStore.getState().zoomLevel).toBe(90);
  });

  it('zoomOut clamps at MIN_ZOOM_LEVEL (60)', () => {
    useUIStore.setState({ zoomLevel: MIN_ZOOM_LEVEL });
    useUIStore.getState().zoomOut();
    expect(useUIStore.getState().zoomLevel).toBe(MIN_ZOOM_LEVEL);
  });

  it('setZoomLevel clamps at MIN_ZOOM_LEVEL (60)', () => {
    useUIStore.getState().setZoomLevel(10);
    expect(useUIStore.getState().zoomLevel).toBe(MIN_ZOOM_LEVEL);
  });

  it('zoomIn clamps at MAX_ZOOM_LEVEL (160)', () => {
    useUIStore.setState({ zoomLevel: MAX_ZOOM_LEVEL });
    useUIStore.getState().zoomIn();
    expect(useUIStore.getState().zoomLevel).toBe(MAX_ZOOM_LEVEL);
  });

  it('setZoomLevel(125) sets 125', () => {
    useUIStore.getState().setZoomLevel(125);
    expect(useUIStore.getState().zoomLevel).toBe(125);
  });
});
