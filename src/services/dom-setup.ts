import { JSDOM } from 'jsdom';

// Set up DOM environment for Mermaid (must run before mermaid import)
const dom = new JSDOM('<!DOCTYPE html><body></body>');
const window = dom.window as any;

// Set global DOM objects
global.document = window.document;
global.window = window;
global.navigator = window.navigator;

// Import isomorphic-dompurify which auto-initializes with jsdom
import DOMPurify from 'isomorphic-dompurify';
(global as any).DOMPurify = DOMPurify;

// Polyfill SVG methods that JSDOM doesn't implement
if (typeof window.SVGElement !== 'undefined') {
  if (!window.SVGElement.prototype.getBBox) {
    window.SVGElement.prototype.getBBox = function() {
      // Return a reasonable default bounding box
      return {
        x: 0,
        y: 0,
        width: 100,
        height: 30,
      };
    };
  }

  if (!window.SVGGraphicsElement) {
    (window as any).SVGGraphicsElement = window.SVGElement;
  }
}

export { window, document };
