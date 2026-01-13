import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';

describe('Wireframe Renderer', () => {
  let document, container, window;

  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><div id="test"></div>');
    window = dom.window;
    document = window.document;
    global.document = document;
    global.window = window;
    container = document.getElementById('test');
  });

  it('should create SVG with correct viewBox', async () => {
    const { draw } = await import('../src/wireframeRenderer.js');
    const mockDb = {
      getData: () => ({
        viewport: 'mobile',
        tree: [{ type: 'col', modifiers: {}, children: [] }]
      })
    };

    draw('', 'test', null, { db: mockDb });

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 375 600');
  });

  it('should calculate flex layout correctly', async () => {
    const { calculateChildBounds } = await import('../src/wireframeRenderer.js');

    const bounds = { x: 0, y: 0, width: 400, height: 100 };
    const children = [
      { type: 'Text', modifiers: { width: 100 }, children: [] },
      { type: 'Text', modifiers: { flex: 1 }, children: [] },
      { type: 'Text', modifiers: { flex: 2 }, children: [] }
    ];

    const result = calculateChildBounds(children, bounds, 'horizontal');

    expect(result[0].width).toBe(100);
    expect(result[1].width).toBe(100); // (400-100)/3 * 1
    expect(result[2].width).toBe(200); // (400-100)/3 * 2
  });

  it('should handle overflow gracefully', async () => {
    const { calculateChildBounds } = await import('../src/wireframeRenderer.js');

    const bounds = { x: 0, y: 0, width: 200, height: 100 };
    const children = [
      { type: 'Text', modifiers: { width: 150 }, children: [] },
      { type: 'Text', modifiers: { flex: 1 }, children: [] },
      { type: 'Text', modifiers: { width: 150 }, children: [] }
    ];

    const result = calculateChildBounds(children, bounds, 'horizontal');

    // Fixed sizes: 150 + 150 = 300 > 200 available
    // Flexible space = max(0, 200 - 300) = 0
    // Flex child gets 0 width (not negative)
    expect(result[0].width).toBe(150);
    expect(result[1].width).toBe(0);
    expect(result[2].width).toBe(150);
  });
});
