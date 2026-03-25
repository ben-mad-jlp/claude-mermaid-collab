/**
 * CallsPopover Component
 *
 * Renders a fixed-positioned portal card displaying information about a called module.
 * Shows the target file stem, title/subtitle lines, and exported functions.
 *
 * Props:
 * - content: Raw pseudo text of target file
 * - fileStem: File identifier for display
 * - position: Fixed positioning (top, left in pixels)
 * - onNavigate: Callback to navigate to file stem
 * - onMouseEnter/onMouseLeave: Grace period handlers
 */

import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { parsePseudo } from './parsePseudo';

export type CallsPopoverProps = {
  content?: string;
  fileStem: string;
  position?: { top: number; left: number };
  anchorRect?: DOMRect;
  visible?: boolean;
  onNavigate?: (stem: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

export default function CallsPopover(props: CallsPopoverProps): JSX.Element | null {
  const {
    content = '',
    fileStem,
    position,
    anchorRect,
    visible,
    onMouseEnter,
    onMouseLeave
  } = props;

  // Support both old and new API - compute position from anchorRect if provided
  const computedPosition = useMemo(() => {
    if (position) return position;
    if (anchorRect) {
      return {
        top: anchorRect.bottom + 8,
        left: anchorRect.left
      };
    }
    return { top: 0, left: 0 };
  }, [position, anchorRect]);

  // If using old API with visible flag, respect it
  if (visible === false) {
    return null;
  }

  // Parse the pseudo content
  const parsed = useMemo(() => parsePseudo(content), [content]);

  // Extract exported functions
  const exportedFunctions = useMemo(() => {
    return parsed.functions.filter((fn) => fn.isExport);
  }, [parsed.functions]);

  const cardContent = (
    <div
      data-testid="calls-popover"
      data-file-stem={fileStem}
      className="w-80 bg-white border border-stone-200 rounded-md shadow-lg p-3 text-sm"
      style={{
        position: 'fixed',
        top: `${computedPosition.top}px`,
        left: `${computedPosition.left}px`,
        zIndex: 50
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* File stem (muted mono small) */}
      <div className="font-mono text-xs text-stone-500 mb-2">{fileStem}</div>

      <hr className="border-stone-200" />

      {/* Title (bold) */}
      {parsed.titleLine && (
        <div className="font-bold text-sm text-stone-950 my-2">{parsed.titleLine}</div>
      )}

      {/* Subtitle (muted small) if present */}
      {parsed.subtitleLine && (
        <>
          <div className="text-xs text-stone-500 mb-2">{parsed.subtitleLine}</div>
        </>
      )}

      {/* Only render the section divider and exports if there are exported functions */}
      {exportedFunctions.length > 0 && (
        <>
          <hr className="border-stone-200" />

          {/* Exports label */}
          <div className="text-xs text-stone-600 mt-2 mb-1.5 font-medium">Exports:</div>

          {/* Exported functions list (green, small) */}
          <div className="space-y-1">
            {exportedFunctions.map((fn) => (
              <div key={fn.name} className="text-xs text-green-600">{fn.name}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  return createPortal(cardContent, document.body);
}
