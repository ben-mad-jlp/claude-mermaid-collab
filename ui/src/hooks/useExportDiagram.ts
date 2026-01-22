/**
 * useExportDiagram Hook
 *
 * Provides SVG and PNG export functionality for Mermaid diagrams.
 * - Handles SVG serialization with inline styles
 * - Converts SVG to PNG via canvas with 2x retina scaling
 * - Manages export state and download functionality
 */

import { useRef, useState, useCallback } from 'react';

export interface UseExportDiagramReturn {
  svgContainerRef: React.RefCallback<HTMLDivElement>;
  exportAsSVG: (filename: string) => void;
  exportAsPNG: (filename: string) => Promise<void>;
  canExport: boolean;
}

/**
 * Inlines computed styles into an SVG element recursively
 */
function inlineStyles(element: Element): void {
  const computed = window.getComputedStyle(element);
  element.setAttribute('style', computed.cssText);

  for (let i = 0; i < element.children.length; i++) {
    inlineStyles(element.children[i]);
  }
}

/**
 * Downloads a file from a blob URL
 */
function downloadFile(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Hook for exporting Mermaid diagrams as SVG or PNG
 */
export function useExportDiagram(): UseExportDiagramReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canExport, setCanExport] = useState(false);

  const svgContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    // Update canExport state based on whether SVG is present
    if (node === null) {
      setCanExport(false);
    } else {
      const hasSvg = node.querySelector('svg') !== null;
      setCanExport(hasSvg);
    }
  }, []);

  const exportAsSVG = useCallback((filename: string) => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const svg = container.querySelector('svg');
    if (svg === null) {
      return;
    }

    // Clone SVG and inline styles
    const clone = svg.cloneNode(true) as Element;
    inlineStyles(clone);

    // Serialize to string
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);

    // Create blob and download
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `${filename}.svg`);
    URL.revokeObjectURL(url);
  }, []);

  const exportAsPNG = useCallback(
    (filename: string) => {
      return new Promise<void>((resolve) => {
        const container = containerRef.current;
        if (container === null) {
          resolve();
          return;
        }

        const svg = container.querySelector('svg');
        if (svg === null) {
          resolve();
          return;
        }

        // Get SVG dimensions
        let width: number;
        let height: number;

        try {
          const bbox = svg.getBBox();
          width = bbox.width || svg.clientWidth || 800;
          height = bbox.height || svg.clientHeight || 600;
        } catch {
          // Fallback if getBBox fails
          width = svg.clientWidth || 800;
          height = svg.clientHeight || 600;
        }

        // Clone and inline styles
        const clone = svg.cloneNode(true) as Element;
        inlineStyles(clone);

        // Create data URL from SVG
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clone);
        const svgDataUrl =
          'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(svgString);

        // Draw to canvas with 2x retina scaling
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;

        const ctx = canvas.getContext('2d');
        if (ctx === null) {
          resolve();
          return;
        }

        ctx.scale(2, 2);

        // Set a timeout to prevent hanging on image load
        const timeoutId = setTimeout(() => {
          resolve();
        }, 10000);

        const img = new Image();
        img.onload = () => {
          clearTimeout(timeoutId);
          try {
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((blob) => {
              if (blob === null) {
                resolve();
                return;
              }

              const url = URL.createObjectURL(blob);
              downloadFile(url, `${filename}.png`);
              URL.revokeObjectURL(url);
              resolve();
            }, 'image/png');
          } catch {
            resolve();
          }
        };

        img.onerror = () => {
          clearTimeout(timeoutId);
          resolve();
        };

        img.src = svgDataUrl;
      });
    },
    []
  );

  return { svgContainerRef, exportAsSVG, exportAsPNG, canExport };
}

export default useExportDiagram;
