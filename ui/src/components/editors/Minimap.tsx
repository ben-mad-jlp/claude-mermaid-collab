/**
 * Minimap Component
 *
 * Visual overview of document with colored annotation markers.
 * Shows viewport indicator and supports click-to-scroll.
 */

import React, { useMemo, useCallback } from 'react';

export interface MinimapMarker {
  /** Line number (1-indexed) */
  line: number;
  /** Marker type for color */
  type: 'comment' | 'propose' | 'approve' | 'reject';
}

export interface MinimapProps {
  /** Document content to analyze for markers */
  content: string;
  /** Total line count of document */
  lineCount: number;
  /** Current scroll position (0-1) */
  scrollPosition: number;
  /** Visible viewport height as fraction (0-1) */
  viewportFraction: number;
  /** Callback when user clicks minimap to scroll */
  onScrollTo: (position: number) => void;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Get the Tailwind color class for a marker type
 */
function getMarkerColor(type: MinimapMarker['type']): string {
  switch (type) {
    case 'comment':
      return 'bg-blue-400';
    case 'propose':
      return 'bg-yellow-400';
    case 'approve':
      return 'bg-green-400';
    case 'reject':
      return 'bg-red-400';
  }
}

/**
 * Extract annotation markers from content
 * @param content - Markdown content with annotation markers
 * @returns Array of markers with line numbers and types
 */
export function extractMarkers(content: string): MinimapMarker[] {
  const markers: MinimapMarker[] = [];
  const lines = content.split('\n');

  const patterns: Record<MinimapMarker['type'], RegExp> = {
    comment: /<!-- comment(-start)?: /,
    propose: /<!-- (status: proposed|propose-start) -->/,
    approve: /<!-- (status: approved|approve-start) -->/,
    reject: /<!-- (status: rejected|reject-start): /,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [type, pattern] of Object.entries(patterns) as [MinimapMarker['type'], RegExp][]) {
      if (pattern.test(line)) {
        markers.push({ line: i + 1, type });
        break;
      }
    }
  }

  return markers;
}

/**
 * Visual overview of document with annotation markers.
 * Shows colored markers for annotations and viewport indicator.
 */
export const Minimap: React.FC<MinimapProps> = ({
  content,
  lineCount,
  scrollPosition,
  viewportFraction,
  onScrollTo,
  className = '',
}) => {
  const markers = useMemo(() => extractMarkers(content), [content]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const position = clickY / rect.height;
      onScrollTo(position);
    },
    [onScrollTo]
  );

  // Calculate viewport indicator position and height
  const viewportTop = `${scrollPosition * 100}%`;
  const viewportHeight = `${viewportFraction * 100}%`;

  return (
    <div
      className={`${className} relative w-16 bg-gray-100 dark:bg-gray-800 cursor-pointer`}
      onClick={handleClick}
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={scrollPosition * 100}
    >
      {/* Render markers */}
      {markers.map((marker, index) => {
        const markerTop = `${(marker.line / lineCount) * 100}%`;
        const markerColor = getMarkerColor(marker.type);
        return (
          <div
            key={`${marker.line}-${marker.type}-${index}`}
            className={`absolute left-0 right-0 h-1 ${markerColor}`}
            style={{ top: markerTop }}
          />
        );
      })}

      {/* Viewport indicator */}
      <div
        className="absolute left-0 right-0 bg-blue-500/30 border border-blue-500"
        style={{ top: viewportTop, height: viewportHeight }}
      />
    </div>
  );
};

export default Minimap;
