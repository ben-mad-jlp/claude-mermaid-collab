/**
 * ReferencesPopover Component
 *
 * Popover that shows references (callers) of a symbol clicked in the CodeEditor.
 * Positioned as a fixed portal under the clicked symbol's DOMRect.
 *
 * Phase 4 scope: same-file references with a sourceLine are clickable and
 * navigate via onNavigateSameFile. Cross-file references to other linked files
 * are displayed as disabled rows (Phase 5 will wire onNavigateLinkedFile).
 * Unlinked file references are shown but not clickable.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ReferenceItem {
  file: string;
  callerMethod: string;
  sourceLine?: number | null;
}

export interface ReferencesPopoverProps {
  references: ReferenceItem[];
  symbolName: string;
  anchorRect: DOMRect;
  /** Pseudo file path of the currently open file (e.g. /project/src/foo.pseudo) */
  currentFilePath: string | null;
  /** Reserved for Phase 5 — set of linked SOURCE file paths in the session */
  linkedSourcePathsInSession: string[];
  onNavigateSameFile: (line: number) => void;
  onNavigateLinkedFile: (sourceFilePath: string, line: number) => void;
  onClose: () => void;
}

function getBaseStem(filePath: string | null | undefined): string {
  if (!filePath) return '';
  const last = filePath.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

export const ReferencesPopover: React.FC<ReferencesPopoverProps> = ({
  references,
  symbolName,
  anchorRect,
  currentFilePath,
  linkedSourcePathsInSession: _linkedSourcePathsInSession, // Phase 5
  onNavigateSameFile,
  onNavigateLinkedFile: _onNavigateLinkedFile, // Phase 5
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const position = useMemo(() => ({
    top: anchorRect.bottom + 8,
    left: anchorRect.left,
  }), [anchorRect]);

  const currentBaseStem = useMemo(() => getBaseStem(currentFilePath), [currentFilePath]);

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
    // Listen on capture to catch scrolls inside any ancestor
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [onClose]);

  const handleRowClick = (ref: ReferenceItem) => {
    // TODO(phase5): resolve pseudo file → source file mapping for cross-file navigation
    if (ref.sourceLine == null) return;
    if (getBaseStem(ref.file) === currentBaseStem) {
      onNavigateSameFile(ref.sourceLine);
    }
    // Cross-file navigation deferred to Phase 5
  };

  const card = (
    <div
      ref={containerRef}
      data-testid="references-popover"
      className="w-80 bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 rounded-md shadow-lg text-sm"
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
          References to <span className="font-mono text-stone-950 dark:text-white">"{symbolName}"</span>
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
        {references.map((ref, idx) => {
          const isClickable =
            ref.sourceLine != null && getBaseStem(ref.file) === currentBaseStem;
          const key = `${ref.file}:${ref.callerMethod}:${ref.sourceLine ?? 'x'}:${idx}`;
          const rowContent = (
            <>
              <div className="font-mono text-xs text-stone-900 dark:text-gray-100">
                {ref.callerMethod}
              </div>
              <div className="font-mono text-[10px] text-stone-500 dark:text-gray-400 truncate">
                {ref.file}{ref.sourceLine != null ? `:${ref.sourceLine}` : ''}
              </div>
            </>
          );
          if (isClickable) {
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleRowClick(ref)}
                className="w-full text-left px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-gray-700 cursor-pointer"
              >
                {rowContent}
              </button>
            );
          }
          return (
            <div
              key={key}
              className="w-full text-left px-2 py-1 rounded opacity-60 cursor-not-allowed"
              title="Cross-file navigation coming in Phase 5"
            >
              {rowContent}
            </div>
          );
        })}
      </div>
    </div>
  );

  return createPortal(card, document.body);
};

ReferencesPopover.displayName = 'ReferencesPopover';

export default ReferencesPopover;
