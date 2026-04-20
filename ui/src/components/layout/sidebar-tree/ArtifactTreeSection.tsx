import React, { useState, type ReactNode } from 'react';
import type { ForcedType } from '../../../lib/importArtifact';

interface ArtifactTreeSectionProps {
  id: string;
  title: string;
  count?: number;
  collapsed: boolean;
  forceExpanded?: boolean;
  onToggle: () => void;
  headerActions?: ReactNode;
  dropHint?: 'valid' | 'invalid' | null;
  acceptedTypes?: ForcedType[];
  onDrop?: (files: File[]) => void | Promise<void>;
  children?: ReactNode;
  'data-testid'?: string;
}

function ArtifactTreeSection(props: ArtifactTreeSectionProps) {
  const {
    id,
    title,
    count,
    collapsed,
    forceExpanded,
    onToggle,
    headerActions,
    dropHint,
    onDrop,
    children,
  } = props;

  const effectiveCollapsed = collapsed && !forceExpanded;
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = onDrop
    ? (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) {
          setIsDragOver(true);
        }
      }
    : undefined;

  const handleDragLeave = onDrop
    ? (_e: React.DragEvent<HTMLDivElement>) => {
        setIsDragOver(false);
      }
    : undefined;

  const handleDrop = onDrop
    ? async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) {
          await onDrop(files);
        }
      }
    : undefined;

  let ringClass = '';
  if (dropHint === 'valid') {
    ringClass = 'ring-2 ring-inset ring-blue-400';
  } else if (dropHint === 'invalid') {
    ringClass = 'ring-2 ring-inset ring-red-400';
  } else if (isDragOver && onDrop) {
    ringClass = 'ring-2 ring-inset ring-blue-400';
  }

  return (
    <div
      data-testid={props['data-testid'] ?? `tree-section-${id}`}
      data-drop-valid={dropHint === 'valid' || undefined}
      data-drop-invalid={dropHint === 'invalid' || undefined}
      className={`border-b border-gray-200 dark:border-gray-700 ${ringClass}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span>{title}</span>
          {typeof count === 'number' && (
            <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">{count}</span>
          )}
          <svg
            className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${effectiveCollapsed ? '-rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {headerActions}
      </div>
      {!effectiveCollapsed && <div className="space-y-1 px-2 pb-2">{children}</div>}
    </div>
  );
}

ArtifactTreeSection.displayName = 'ArtifactTreeSection';

export { ArtifactTreeSection };
export default ArtifactTreeSection;
