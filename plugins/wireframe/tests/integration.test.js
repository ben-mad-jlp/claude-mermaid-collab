import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';
import { diagram } from '../src/wireframeDiagram.js';

describe('Integration Tests', () => {
  let document, container;

  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><div id="test"></div>');
    document = dom.window.document;
    global.document = document;
    global.window = dom.window;
    container = document.getElementById('test');

    // Initialize diagram
    diagram.init({});
  });

  it('should render complete login form', () => {
    const input = `wireframe mobile
  col
    AppBar "Sign In"
    col padding=24
      Title "Welcome"
      Input "Email"
      Input "Password"
      Button "Sign In" primary`;

    // Parse
    const result = diagram.parser.parse(input);
    expect(result.viewport).toBe('mobile');

    // Build tree
    diagram.db.addNodes(result);
    const { tree } = diagram.db.getData();
    expect(tree).toHaveLength(1);

    // Render
    const svg = d3.select(container).append('svg').attr('id', 'test');
    diagram.renderer.draw(input, 'test', null, { db: diagram.db });

    // Verify SVG output
    const svgEl = container.querySelector('svg');
    expect(svgEl).toBeTruthy();
    expect(svgEl.getAttribute('viewBox')).toBe('0 0 375 600');

    // Verify elements were rendered
    const rects = svgEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThan(0);

    const texts = svgEl.querySelectorAll('text');
    const textContent = Array.from(texts).map(t => t.textContent);
    expect(textContent).toContain('Sign In');
    expect(textContent).toContain('Welcome');
  });

  it('should render dashboard with Grid', () => {
    const input = `wireframe desktop
  col
    AppBar "Dashboard"
    Grid
      header "Name | Email"
      row "John | john@example.com"
      row "Jane | jane@example.com"`;

    // Clear previous test's SVG
    container.innerHTML = '';

    const result = diagram.parser.parse(input);
    diagram.db.addNodes(result);

    // Create container with proper id
    const testDiv = document.createElement('div');
    testDiv.id = 'test2';
    container.appendChild(testDiv);

    diagram.renderer.draw(input, 'test2', null, { db: diagram.db });

    const svgEl = testDiv.querySelector('svg');
    expect(svgEl.getAttribute('viewBox')).toBe('0 0 1200 600');

    // Should have grid cells
    const rects = svgEl.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThan(6); // Grid has header + 2 rows * 2 cols
  });
});
