/**
 * EditorToolbar Component
 *
 * Toolbar for the editor panel with:
 * - Item name with unsaved changes indicator
 * - Undo/Redo controls
 * - Zoom controls (+/- and percentage display)
 * - Overflow menu for additional actions
 *
 * Integrates with the editor to provide common editing operations.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToolbarAction } from '@/types';
import { HistoryToolbar } from '@/components/editors/HistoryToolbar';
import { HistoryDiffSettingsDropdown } from '@/components/editors/HistoryDiffSettingsDropdown';
import { DiagramHistoryDropdown } from '@/components/editors/DiagramHistoryDropdown';
import { WireframeHistoryDropdown } from '@/components/editors/WireframeHistoryDropdown';

export interface EditorToolbarProps {
  /** Name of the item being edited */
  itemName: string;
  /** Whether the item has unsaved changes */
  hasUnsavedChanges: boolean;
  /** Callback for undo action (diagrams only) */
  onUndo?: () => void;
  /** Callback for redo action (diagrams only) */
  onRedo?: () => void;
  /** Whether undo is available */
  canUndo?: boolean;
  /** Whether redo is available */
  canRedo?: boolean;
  /** Document ID for history (documents only) */
  documentId?: string;
  /** Current document content (documents only) */
  documentContent?: string;
  /** Callback when history version is selected (documents) */
  onHistoryVersionSelect?: (timestamp: string, content: string, previousContent?: string) => void;
  /** Diagram ID for history (diagrams only) */
  diagramId?: string;
  /** Callback when diagram history version is selected */
  onDiagramHistorySelect?: (timestamp: string, content: string) => void;
  /** Wireframe ID for history (wireframes only) */
  wireframeId?: string;
  /** Callback when wireframe history version is selected */
  onWireframeHistorySelect?: (timestamp: string, content: string) => void;
  /** Current zoom level (percentage) */
  zoom: number;
  /** Callback for zoom in action */
  onZoomIn: () => void;
  /** Callback for zoom out action */
  onZoomOut: () => void;
  /** Additional actions for the overflow menu */
  overflowActions: ToolbarAction[];
  /** Callback for export as SVG action */
  onExportSVG?: (filename: string) => void;
  /** Callback for export as PNG action */
  onExportPNG?: (filename: string) => void;
  /** Whether export is available */
  canExport?: boolean;
  /** Callback for format diagram action */
  onFormat?: () => void;
  /** Whether format is available */
  canFormat?: boolean;
  /** Callback for add comment action */
  onAddComment?: (lineStart: number, lineEnd: number) => void;
  /** Callback for approve all proposals */
  onApproveAll?: () => void;
  /** Callback for reject all proposals */
  onRejectAll?: () => void;
  /** Callback for clear proposals */
  onClearProposals?: () => void;
  /** Whether there are proposals to manage */
  hasProposals?: boolean;
  /** Type of item being edited (for context-specific actions) */
  itemType?: 'diagram' | 'document' | 'wireframe';
  /** Callback for rotate/direction toggle action */
  onRotate?: () => void;
  /** Whether rotate is enabled (true for diagrams only) */
  canRotate?: boolean;
  /** Whether to show zoom controls (default true, false for documents) */
  showZoom?: boolean;
  /** Callback for center diagram action */
  onCenter?: () => void;
  /** Callback for fit-to-view action */
  onFitToView?: () => void;
  /** History diff info for inline display banner (documents only) */
  historyDiff?: {
    timestamp: string;
    historicalContent: string;
    viewMode: 'inline' | 'side-by-side';
    compareMode: 'vs-current' | 'vs-previous';
    previousContent?: string;
  } | null;
  /** Callback to clear history diff and return to current version */
  onClearHistoryDiff?: () => void;
  /** Callback when history diff settings change */
  onHistorySettingsChange?: (viewMode: 'inline' | 'side-by-side', compareMode: 'vs-current' | 'vs-previous') => void;
}

/**
 * EditorToolbar component for editing operations
 */
export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  itemName,
  hasUnsavedChanges,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  documentId,
  documentContent,
  onHistoryVersionSelect,
  diagramId,
  onDiagramHistorySelect,
  wireframeId,
  onWireframeHistorySelect,
  zoom,
  onZoomIn,
  onZoomOut,
  overflowActions,
  onExportSVG,
  onExportPNG,
  canExport,
  onFormat,
  canFormat,
  onAddComment,
  onApproveAll,
  onRejectAll,
  onClearProposals,
  hasProposals,
  itemType,
  onRotate,
  canRotate,
  showZoom = true,
  onCenter,
  onFitToView,
  historyDiff,
  onClearHistoryDiff,
  onHistorySettingsChange,
}) => {
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Close overflow menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setIsOverflowOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Close overflow menu on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOverflowOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleToggleOverflow = useCallback(() => {
    setIsOverflowOpen((prev) => !prev);
  }, []);

  const handleActionClick = useCallback((action: ToolbarAction) => {
    action.onClick();
    setIsOverflowOpen(false);
  }, []);

  // Format timestamp to relative time for history banner
  const formatRelativeTime = useCallback((timestamp: string): string => {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 2) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }, []);

  // Build combined actions list with new buttons
  const allActions = useCallback(() => {
    const actions = [...overflowActions];

    // Add export actions
    if (canExport && onExportSVG) {
      actions.push({
        id: 'export-svg',
        label: 'Export as SVG',
        icon: (
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
        ),
        onClick: () => onExportSVG(`diagram-${Date.now()}`),
        disabled: !canExport,
      });
    }

    if (canExport && onExportPNG) {
      actions.push({
        id: 'export-png',
        label: 'Export as PNG',
        icon: (
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        ),
        onClick: () => onExportPNG(`diagram-${Date.now()}`),
        disabled: !canExport,
      });
    }

    // Add format action (diagram only)
    if (canFormat !== undefined && itemType === 'diagram' && onFormat) {
      actions.push({
        id: 'format',
        label: 'Format Diagram',
        icon: (
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        ),
        onClick: () => onFormat?.(),
        disabled: !canFormat,
      });
    }

    // Add collaboration section (if hasProposals is defined)
    if (hasProposals !== undefined) {
      // Add comment button
      if (onAddComment) {
        actions.push({
          id: 'add-comment',
          label: 'Add Comment',
          icon: (
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          ),
          onClick: () => onAddComment?.(0, 0),
          disabled: false,
        });
      }

      // Add approve all button
      if (onApproveAll) {
        actions.push({
          id: 'approve-all',
          label: 'Approve All',
          icon: (
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ),
          onClick: () => onApproveAll?.(),
          disabled: !hasProposals,
        });
      }

      // Add reject all button
      if (onRejectAll) {
        actions.push({
          id: 'reject-all',
          label: 'Reject All',
          icon: (
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ),
          onClick: () => onRejectAll?.(),
          disabled: !hasProposals,
        });
      }

      // Add clear proposals button
      if (onClearProposals) {
        actions.push({
          id: 'clear-proposals',
          label: 'Clear Proposals',
          icon: (
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 4 21 4 23 6" />
              <path d="M19 8v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8m3 0V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          ),
          onClick: () => onClearProposals?.(),
          disabled: !hasProposals,
        });
      }
    }

    return actions;
  }, [overflowActions, canExport, onExportSVG, onExportPNG, canFormat, itemType, onFormat, hasProposals, onAddComment, onApproveAll, onRejectAll, onClearProposals]);

  const finalActions = allActions();

  return (
    <div className="flex flex-col">
      {/* History Viewing Banner */}
      {historyDiff && (
        <div
          data-testid="history-viewing-banner"
          className="flex items-center justify-between gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-amber-600 dark:text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm text-amber-800 dark:text-amber-200">
              Viewing version from {formatRelativeTime(historyDiff.timestamp)}
            </span>
          </div>
          {onHistorySettingsChange && (
            <HistoryDiffSettingsDropdown
              viewMode={historyDiff.viewMode}
              compareMode={historyDiff.compareMode}
              onSettingsChange={onHistorySettingsChange}
              hasPreviousVersion={!!historyDiff.previousContent}
            />
          )}
        </div>
      )}

      {/* Main Toolbar */}
      <div
        data-testid="editor-toolbar"
        className="
          flex items-center gap-2
          h-10 px-3
          bg-white dark:bg-gray-800
          border-b border-gray-200 dark:border-gray-700
        "
      >
      {/* History Controls (documents) or Undo/Redo + History (diagrams/wireframes) - positioned first on far left */}
      {itemType === 'document' && documentId && onHistoryVersionSelect ? (
        <HistoryToolbar
          documentId={documentId}
          currentContent={documentContent || ''}
          onVersionSelect={onHistoryVersionSelect}
        />
      ) : (
        <>
          {/* Undo Button */}
          <button
            data-testid="editor-toolbar-undo"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            className="
              p-1.5
              text-gray-600 dark:text-gray-300
              hover:text-gray-900 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-gray-700
              rounded
              transition-colors
              disabled:opacity-40
              disabled:cursor-not-allowed
              disabled:hover:bg-transparent dark:disabled:hover:bg-transparent
            "
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
            </svg>
          </button>

          {/* Redo Button */}
          <button
            data-testid="editor-toolbar-redo"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            className="
              p-1.5
              text-gray-600 dark:text-gray-300
              hover:text-gray-900 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-gray-700
              rounded
              transition-colors
              disabled:opacity-40
              disabled:cursor-not-allowed
              disabled:hover:bg-transparent dark:disabled:hover:bg-transparent
            "
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13" />
            </svg>
          </button>

          {/* Diagram History Dropdown */}
          {itemType === 'diagram' && diagramId && onDiagramHistorySelect && (
            <DiagramHistoryDropdown
              diagramId={diagramId}
              onVersionSelect={onDiagramHistorySelect}
            />
          )}

          {/* Wireframe History Dropdown */}
          {itemType === 'wireframe' && wireframeId && onWireframeHistorySelect && (
            <WireframeHistoryDropdown
              wireframeId={wireframeId}
              onVersionSelect={onWireframeHistorySelect}
            />
          )}
        </>
      )}

      {/* Divider after history/undo-redo controls */}
      <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

      {/* Item Name + Unsaved Indicator */}
      <div className="flex items-center gap-2 min-w-0" data-testid="editor-toolbar-title">
        <span
          className="
            text-sm font-medium
            text-gray-900 dark:text-white
            truncate
          "
          title={itemName}
        >
          {itemName}
        </span>
        {hasUnsavedChanges && (
          <span
            data-testid="unsaved-indicator"
            className="
              text-accent-500 dark:text-accent-400
              text-lg leading-none
            "
            aria-label="Unsaved changes"
          >
            ●
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Divider before zoom controls */}
      {showZoom && <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />}

      {/* Zoom Controls (hidden for documents) */}
      {showZoom && (
        <>
          {/* Zoom Out Button */}
          <button
            data-testid="editor-toolbar-zoom-out"
            onClick={onZoomOut}
            aria-label="Zoom out"
            className="
              p-1.5
              text-gray-600 dark:text-gray-300
              hover:text-gray-900 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-gray-700
              rounded
              transition-colors
            "
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Zoom Level Display */}
          <span
            data-testid="editor-toolbar-zoom-level"
            className="
              text-xs font-medium
              text-gray-600 dark:text-gray-300
              min-w-[3rem] text-center
            "
          >
            {zoom}%
          </span>

          {/* Zoom In Button */}
          <button
            data-testid="editor-toolbar-zoom-in"
            onClick={onZoomIn}
            aria-label="Zoom in"
            className="
              p-1.5
              text-gray-600 dark:text-gray-300
              hover:text-gray-900 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-gray-700
              rounded
              transition-colors
            "
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Center Button */}
          {onCenter && (
            <button
              data-testid="editor-toolbar-center"
              onClick={onCenter}
              aria-label="Center diagram"
              title="Center diagram (reset pan and zoom)"
              className="
                p-1.5
                text-gray-600 dark:text-gray-300
                hover:text-gray-900 dark:hover:text-white
                hover:bg-gray-100 dark:hover:bg-gray-700
                rounded
                transition-colors
              "
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              </svg>
            </button>
          )}

          {/* Fit to View Button */}
          {onFitToView && (
            <button
              data-testid="editor-toolbar-fit"
              onClick={onFitToView}
              aria-label="Fit to view"
              title="Fit diagram to container"
              className="
                p-1.5
                text-gray-600 dark:text-gray-300
                hover:text-gray-900 dark:hover:text-white
                hover:bg-gray-100 dark:hover:bg-gray-700
                rounded
                transition-colors
              "
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>
          )}

          {/* Divider */}
          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
        </>
      )}

      {/* Rotate Button (diagram only) */}
      {itemType === 'diagram' && canRotate && onRotate && (
        <button
          data-testid="editor-toolbar-rotate"
          onClick={onRotate}
          aria-label="Rotate diagram direction"
          className="
            p-1.5
            text-gray-600 dark:text-gray-300
            hover:text-gray-900 dark:hover:text-white
            hover:bg-gray-100 dark:hover:bg-gray-700
            rounded
            transition-colors
          "
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17.89 7.89L10 15.78M17.89 7.89h5.22v5.22" />
            <path d="M6.11 16.11l7.89-7.89M6.11 16.11H.89v-5.22" />
          </svg>
        </button>
      )}

      {/* Divider (before overflow if rotate button shown) */}
      {itemType === 'diagram' && canRotate && onRotate && (
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
      )}

      {/* Overflow Menu */}
      <div className="relative" ref={overflowRef}>
        <button
          data-testid="editor-toolbar-overflow"
          onClick={handleToggleOverflow}
          aria-expanded={isOverflowOpen}
          aria-haspopup="menu"
          aria-label="More actions"
          className="
            p-1.5
            text-gray-600 dark:text-gray-300
            hover:text-gray-900 dark:hover:text-white
            hover:bg-gray-100 dark:hover:bg-gray-700
            rounded
            transition-colors
          "
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>

        {/* Overflow Dropdown */}
        {isOverflowOpen && finalActions.length > 0 && (
          <div
            data-testid="editor-toolbar-overflow-menu"
            role="menu"
            className="
              absolute right-0 mt-1 w-48
              bg-white dark:bg-gray-800
              border border-gray-200 dark:border-gray-700
              rounded-lg shadow-lg
              z-50 overflow-hidden
              animate-fadeIn
            "
          >
            <ul className="py-1">
              {finalActions.map((action) => (
                <li key={action.id}>
                  <button
                    role="menuitem"
                    data-testid={`overflow-action-${action.id}`}
                    onClick={() => handleActionClick(action)}
                    disabled={action.disabled}
                    className={`
                      w-full px-3 py-2
                      flex items-center gap-2
                      text-left text-sm
                      transition-colors
                      ${
                        action.disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                      }
                      ${
                        action.primary
                          ? 'text-accent-600 dark:text-accent-400 font-medium'
                          : 'text-gray-700 dark:text-gray-200'
                      }
                    `}
                  >
                    {action.icon && (
                      <span className="w-4 h-4 flex-shrink-0">{action.icon}</span>
                    )}
                    <span>{action.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default EditorToolbar;
