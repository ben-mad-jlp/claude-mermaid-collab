/**
 * DefinitionPickerPopover Component
 *
 * Portal popover shown when multiple definition candidates exist for a
 * clicked symbol. Lists each candidate's source file + line number +
 * export badge. Click a row to navigate.
 *
 * Positioned as a fixed portal under the clicked symbol's DOMRect, matching
 * the pattern in ReferencesPopover.tsx.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { SourceLinkCandidate } from '@/lib/pseudo-api';

export interface DefinitionPickerPopoverProps {
  candidates: SourceLinkCandidate[];
  symbolName: string;
  anchorRect: DOMRect;
  onPick: (candidate: SourceLinkCandidate) => void;
  onClose: () => void;
}

function basename(p: string): string {
  return p.split('/').pop() || p;
}

export const DefinitionPickerPopover: React.FC<DefinitionPickerPopoverProps> = ({
  candidates,
  symbolName,
  anchorRect,
  onPick,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const position = useMemo(() => ({
    top: anchorRect.bottom + 8,
    left: anchorRect.left,
  }), [anchorRect]);

  // Outside click → close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Escape → close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close on scroll (anchor rect would go stale)
  useEffect(() => {
    const handleScroll = () => onClose();
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [onClose]);

  const card = (
    <div
      ref={containerRef}
      data-testid="definition-picker-popover"
      className="w-96 bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 rounded-md shadow-lg text-sm"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 50,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-stone-200 dark:border-gray-700">
        <div className="text-xs text-stone-700 dark:text-gray-300 font-medium">
          Multiple definitions for <span className="font-mono text-stone-950 dark:text-white">"{symbolName}"</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-stone-400 hover:text-stone-700 dark:hover:text-white text-lg leading-none px-1"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="max-h-64 overflow-y-auto p-2">
        {candidates.map((candidate, idx) => (
          <button
            key={`${candidate.sourceFilePath}:${candidate.sourceLine}:${idx}`}
            type="button"
            onClick={() => onPick(candidate)}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-stone-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${candidate.isExported ? 'bg-green-500' : 'bg-transparent border border-gray-300 dark:border-gray-600'}`}
              title={candidate.isExported ? 'exported' : 'internal'}
            />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-stone-900 dark:text-gray-100 truncate">
                {basename(candidate.sourceFilePath)}
                {candidate.sourceLine != null && (
                  <span className="text-stone-500 dark:text-gray-400">:{candidate.sourceLine}</span>
                )}
              </div>
              <div className="font-mono text-[10px] text-stone-500 dark:text-gray-400 truncate">
                {candidate.sourceFilePath}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  return createPortal(card, document.body);
};

DefinitionPickerPopover.displayName = 'DefinitionPickerPopover';

export default DefinitionPickerPopover;
