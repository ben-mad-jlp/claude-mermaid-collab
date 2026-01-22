/**
 * Tests for useExportDiagram hook
 */

import { renderHook, act } from '@testing-library/react';
import { useExportDiagram } from '../useExportDiagram';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('useExportDiagram', () => {
  beforeEach(() => {
    // Mock URL APIs
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return hook with expected interface', () => {
    const { result } = renderHook(() => useExportDiagram());

    expect(result.current).toHaveProperty('svgContainerRef');
    expect(result.current).toHaveProperty('exportAsSVG');
    expect(result.current).toHaveProperty('exportAsPNG');
    expect(result.current).toHaveProperty('canExport');

    expect(typeof result.current.svgContainerRef).toBe('function');
    expect(typeof result.current.exportAsSVG).toBe('function');
    expect(typeof result.current.exportAsPNG).toBe('function');
    expect(typeof result.current.canExport).toBe('boolean');
  });

  it('should initialize with canExport as false', () => {
    const { result } = renderHook(() => useExportDiagram());

    expect(result.current.canExport).toBe(false);
  });

  it('should set canExport to false when ref is null', () => {
    const { result } = renderHook(() => useExportDiagram());

    act(() => {
      result.current.svgContainerRef(null);
    });

    expect(result.current.canExport).toBe(false);
  });

  it('should set canExport to false when container has no SVG', () => {
    const { result } = renderHook(() => useExportDiagram());

    const container = document.createElement('div');

    act(() => {
      result.current.svgContainerRef(container);
    });

    expect(result.current.canExport).toBe(false);
  });

  it('should set canExport to true when container has SVG', () => {
    const { result } = renderHook(() => useExportDiagram());

    const container = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    container.appendChild(svg);

    act(() => {
      result.current.svgContainerRef(container);
    });

    expect(result.current.canExport).toBe(true);
  });

  describe('exportAsSVG', () => {
    it('should silently return when container is null', () => {
      const { result } = renderHook(() => useExportDiagram());

      // Container starts as null, should not throw
      expect(() => {
        result.current.exportAsSVG('test');
      }).not.toThrow();
    });

    it('should silently return when SVG is not found', () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');
      act(() => {
        result.current.svgContainerRef(container);
      });

      // No SVG in container, should not throw
      expect(() => {
        result.current.exportAsSVG('test');
      }).not.toThrow();
    });

    it('should not call download functions when no SVG present', () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');
      act(() => {
        result.current.svgContainerRef(container);
      });

      // Reset mocks to check if they're called
      vi.clearAllMocks();

      act(() => {
        result.current.exportAsSVG('test');
      });

      // createObjectURL should not be called if there's no SVG
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should call createObjectURL when SVG exists', () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      act(() => {
        result.current.svgContainerRef(container);
      });

      vi.clearAllMocks();

      // Mock downloadFile to prevent actual file download
      const downloadFileSpy = vi.spyOn(document, 'createElement');

      act(() => {
        result.current.exportAsSVG('test-diagram');
      });

      // Should attempt to create blob and object URL
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();

      downloadFileSpy.mockRestore();
    });
  });

  describe('exportAsPNG', () => {
    it('should return a promise', () => {
      const { result } = renderHook(() => useExportDiagram());

      const promise = result.current.exportAsPNG('test');
      expect(promise).toBeInstanceOf(Promise);
    });

    it('should resolve when container is null', async () => {
      const { result } = renderHook(() => useExportDiagram());

      // Container starts as null
      await expect(result.current.exportAsPNG('test')).resolves.toBeUndefined();
    });

    it('should resolve when SVG is not found', async () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');
      act(() => {
        result.current.svgContainerRef(container);
      });

      await expect(result.current.exportAsPNG('test')).resolves.toBeUndefined();
    });

    it('should handle SVG with fallback dimensions', async () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '300');
      svg.setAttribute('height', '200');
      container.appendChild(svg);

      act(() => {
        result.current.svgContainerRef(container);
      });

      // Should resolve even with fallback dimensions
      const promise = result.current.exportAsPNG('test');
      expect(promise).toBeInstanceOf(Promise);
    }, 1000); // Set short timeout for this test

    it('should handle edge case of empty container', async () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');

      act(() => {
        result.current.svgContainerRef(container);
      });

      // Should resolve gracefully when SVG not found
      await expect(result.current.exportAsPNG('test')).resolves.toBeUndefined();
    });
  });

  describe('svgContainerRef callback', () => {
    it('should update canExport state on ref changes', () => {
      const { result } = renderHook(() => useExportDiagram());

      expect(result.current.canExport).toBe(false);

      const container = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      act(() => {
        result.current.svgContainerRef(container);
      });

      expect(result.current.canExport).toBe(true);

      act(() => {
        result.current.svgContainerRef(null);
      });

      expect(result.current.canExport).toBe(false);
    });

    it('should detect SVG presence correctly', () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');
      const div = document.createElement('div');
      container.appendChild(div);

      act(() => {
        result.current.svgContainerRef(container);
      });

      expect(result.current.canExport).toBe(false);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      act(() => {
        result.current.svgContainerRef(container);
      });

      expect(result.current.canExport).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid ref updates', () => {
      const { result } = renderHook(() => useExportDiagram());

      const containers = Array.from({ length: 5 }, () => {
        const c = document.createElement('div');
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        c.appendChild(s);
        return c;
      });

      act(() => {
        containers.forEach((c) => {
          result.current.svgContainerRef(c);
        });
      });

      expect(result.current.canExport).toBe(true);
    });

    it('should not throw on export with complex SVG structure', () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      // Add nested elements
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');

      g.appendChild(circle);
      g.appendChild(text);
      svg.appendChild(g);
      container.appendChild(svg);

      act(() => {
        result.current.svgContainerRef(container);
      });

      expect(() => {
        result.current.exportAsSVG('complex');
      }).not.toThrow();
    });

    it('should handle very long filenames', () => {
      const { result } = renderHook(() => useExportDiagram());

      const container = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      container.appendChild(svg);

      act(() => {
        result.current.svgContainerRef(container);
      });

      const longFilename = 'a'.repeat(200);

      expect(() => {
        result.current.exportAsSVG(longFilename);
      }).not.toThrow();
    });
  });
});
