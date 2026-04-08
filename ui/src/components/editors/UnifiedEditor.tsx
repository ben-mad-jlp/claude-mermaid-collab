/**
 * UnifiedEditor Component
 *
 * A unified editor that handles all artifact types:
 * - Diagrams: Renders with CodeMirror + MermaidPreview in split pane
 * - Documents: Renders with CodeMirror + MarkdownPreview in split pane
 * - Snippets: Delegates to SnippetEditor for full-width code editing
 * - Designs: Delegates to DesignEditor for visual design editing
 * - Spreadsheets: Delegates to SpreadsheetEditor for tabular data editing
 * - Automatically detects item type and renders appropriate editor
 * - Split pane layout with CodeMirror editor and live preview (diagrams/documents)
 * - Supports toggling between raw/preview and preview-only modes
 * - Persists split position via uiStore
 * - Placeholder state when no item is selected
 * - Integrates undo/redo history tracking
 * - Integrates diagram export (SVG/PNG) functionality
 * - Integrates Mermaid syntax formatting
 * - Integrates collaborative proposal/comment system
 *
 * This component provides a unified editing interface for all artifact types,
 * reducing code duplication and simplifying the UI.
 */

import React, { useCallback, useRef, useMemo } from 'react';
import { EditorView } from '@codemirror/view';
import { SplitPane } from '@/components/layout/SplitPane';
import { CodeMirrorWrapper } from '@/components/editors/CodeMirrorWrapper';
import { MermaidPreview, MermaidPreviewRef } from '@/components/editors/MermaidPreview';
import { MarkdownPreview } from '@/components/editors/MarkdownPreview';
import { DiffView } from '@/components/ai-ui/display/DiffView';
import { DiagramHistoryPreview } from '@/components/editors/DiagramHistoryPreview';
import { Item, isDiagram, isDocument, isDesign, isSpreadsheet, isSnippet, Snippet } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { useEditorHistory } from '@/hooks/useEditorHistory';
import { useExportDiagram } from '@/hooks/useExportDiagram';
import { useProposalStore } from '@/stores/proposalStore';
import { formatMermaid, canFormat } from '@/lib/mermaidFormatter';
import { DesignEditor } from '@/components/design-editor/DesignEditor';
import { SpreadsheetEditor } from '@/components/editors/SpreadsheetEditor';
import { SnippetEditor } from '@/components/editors/SnippetEditor';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';

/**
 * Props for the UnifiedEditor component
 */
export interface UnifiedEditorProps {
  /** The item to edit (diagram or document), or null if none selected */
  item: Item | null;
  /** Whether to show the editor (split view) or preview only */
  editMode: boolean;
  /** Project path for resolving embedded assets */
  project?: string;
  /** Session name for resolving embedded assets */
  session?: string;
  /** Callback when content changes in the editor */
  onContentChange: (content: string) => void;
  /** Current zoom level (percentage) */
  zoomLevel?: number;
  /** Callback for zoom in */
  onZoomIn?: () => void;
  /** Callback for zoom out */
  onZoomOut?: () => void;
  /** Callback for setting zoom to specific level */
  onSetZoom?: (level: number) => void;
  /** Ref to access MermaidPreview methods (center, fitToView) */
  previewRef?: React.RefObject<MermaidPreviewRef>;
  /** History diff for inline document comparison (documents only) */
  historyDiff?: {
    timestamp: string;
    historicalContent: string;
    viewMode: 'inline' | 'side-by-side';
    compareMode: 'vs-current' | 'vs-previous';
    previousContent?: string;
  } | null;
  /** Callback to clear the history diff view */
  onClearHistoryDiff?: () => void;
  /** Diagram history preview state (diagrams only) */
  diagramHistoryPreview?: {
    timestamp: string;
    historicalContent: string;
  } | null;
  /** Callback to revert diagram to historical version */
  onDiagramRevert?: () => void;
  /** Callback to clear diagram history preview */
  onClearDiagramHistoryPreview?: () => void;
  /** Design history preview state (designs only) */
  designHistoryPreview?: {
    timestamp: string;
    historicalContent: string;
  } | null;
  /** Callback to revert design to historical version */
  onDesignRevert?: () => void;
  /** Callback to clear design history preview */
  onClearDesignHistoryPreview?: () => void;
  /** Callback when snippet is saved */
  onSnippetSave?: (id: string, content: string) => void;
  /** Callback for snippet toolbar controls to be rendered in EditorToolbar */
  onSnippetToolbarControls?: (controls: React.ReactNode) => void;
}

/**
 * UnifiedEditor Component
 *
 * Unified editor for all artifact types:
 * - Shows a placeholder when no item is selected
 * - For diagrams/documents: Renders CodeMirror + preview in split pane when editMode is true
 * - For snippets: Delegates to SnippetEditor with full-width layout
 * - For designs: Delegates to DesignEditor with full-width layout
 * - For spreadsheets: Delegates to SpreadsheetEditor with full-width layout
 * - Renders full-width preview when editMode is false (diagrams/documents)
 * - Automatically selects appropriate editor based on item type
 *
 * @example
 * ```tsx
 * function EditorPanel() {
 *   const [item, setItem] = useState<Item | null>(null);
 *   const { editMode } = useUIStore();
 *
 *   const handleContentChange = (content: string) => {
 *     if (item) {
 *       setItem({ ...item, content });
 *     }
 *   };
 *
 *   return (
 *     <UnifiedEditor
 *       item={item}
 *       editMode={editMode}
 *       onContentChange={handleContentChange}
 *     />
 *   );
 * }
 * ```
 */
/**
 * SnippetGroupView — renders a single snippet or a tabbed group of linked snippets
 */
const SnippetGroupView: React.FC<{
  item: Item;
  onSnippetSave?: (id: string, content: string) => void;
  onContentChange?: (content: string) => void;
  onToolbarControls?: (controls: React.ReactNode) => void;
}> = ({ item, onSnippetSave, onContentChange, onToolbarControls }) => {
  const snippets = useSessionStore((state) => state.snippets);
  const selectSnippet = useSessionStore((state) => state.selectSnippet);
  const removeSnippet = useSessionStore((state) => state.removeSnippet);
  const currentSession = useSessionStore((state) => state.currentSession);

  const handleSnippetSave = useCallback(
    (snippet: Snippet) => onSnippetSave?.(snippet.id, snippet.content),
    [onSnippetSave]
  );

  // Parse the selected snippet's groupId
  const groupId = useMemo(() => {
    try {
      const parsed = JSON.parse(item.content || '');
      return typeof parsed.groupId === 'string' ? parsed.groupId : null;
    } catch {
      return null;
    }
  }, [item.content]);

  // Find all snippets in the same group
  const groupSnippets = useMemo(() => {
    if (!groupId) return [item];
    return snippets
      .filter((s) => {
        try {
          const parsed = JSON.parse(s.content || '');
          return parsed.groupId === groupId;
        } catch {
          return false;
        }
      })
      .map((s) => ({ ...s, type: 'snippet' as const }));
  }, [groupId, snippets, item]);

  const handleDeleteSnippet = useCallback(
    async (e: React.MouseEvent, snippetId: string) => {
      e.stopPropagation();
      if (!currentSession) return;
      await api.deleteSnippet(currentSession.project, currentSession.name, snippetId);
      removeSnippet(snippetId);
      if (snippetId === item.id) {
        const remaining = groupSnippets.filter((s) => s.id !== snippetId);
        if (remaining.length > 0) selectSnippet(remaining[0].id);
      }
    },
    [currentSession, removeSnippet, item.id, groupSnippets, selectSnippet]
  );

  if (groupSnippets.length <= 1) {
    // Single snippet — no tabs
    return (
      <div className="flex-1 flex flex-col h-full" data-testid="unified-editor-snippet">
        <SnippetEditor
          key={item.id}
          snippetId={item.id}
          onSave={handleSnippetSave}
          onChange={onContentChange}
          onToolbarControls={onToolbarControls}
        />
      </div>
    );
  }

  // Grouped snippets — tabs
  return (
    <div className="flex-1 flex flex-col h-full" data-testid="unified-editor-snippet-group">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-x-auto">
        {groupSnippets.map((s) => {
          const isActive = s.id === item.id;
          return (
            <div
              key={s.id}
              className={`group/tab flex items-center border-b-2 transition-colors ${
                isActive
                  ? 'border-indigo-500'
                  : 'border-transparent hover:border-gray-300'
              }`}
            >
              <button
                onClick={() => selectSnippet(s.id)}
                className={`pl-4 pr-2 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {s.name}
              </button>
              <button
                onClick={(e) => handleDeleteSnippet(e, s.id)}
                className="mr-2 p-0.5 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover/tab:opacity-100 transition-opacity"
                title={`Delete ${s.name}`}
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      {/* Active editor */}
      <div className="flex-1 min-h-0">
        <SnippetEditor
          key={item.id}
          snippetId={item.id}
          onSave={handleSnippetSave}
          onChange={onContentChange}
          onToolbarControls={onToolbarControls}
        />
      </div>
    </div>
  );
};

export const UnifiedEditor: React.FC<UnifiedEditorProps> = ({
  item,
  editMode,
  project,
  session,
  onContentChange,
  zoomLevel = 100,
  onZoomIn,
  onZoomOut,
  onSetZoom,
  previewRef,
  historyDiff,
  onClearHistoryDiff,
  diagramHistoryPreview,
  onDiagramRevert,
  onClearDiagramHistoryPreview,
  designHistoryPreview,
  onDesignRevert,
  onClearDesignHistoryPreview,
  onSnippetSave,
  onSnippetToolbarControls,
}) => {
  const { editorSplitPosition, setEditorSplitPosition } = useUIStore();

  // Initialize hooks for editor features
  const { setEditor, undo, redo, canUndo, canRedo } = useEditorHistory();
  const { svgContainerRef, exportAsSVG, exportAsPNG, canExport } = useExportDiagram();

  // Get proposal store functions
  const {
    proposals: allProposals,
    addProposal,
    approveProposal,
    rejectProposal,
    clearProposals,
    getProposalsForItem,
  } = useProposalStore((state) => ({
    proposals: state.proposals,
    addProposal: state.addProposal,
    approveProposal: state.approveProposal,
    rejectProposal: state.rejectProposal,
    clearProposals: state.clearProposals,
    getProposalsForItem: state.getProposalsForItem,
  }));

  // Get proposals for current item
  const itemProposals = item ? getProposalsForItem(item.id) : [];

  // Format handler function
  const handleFormat = useCallback(() => {
    if (!item || item.type !== 'diagram') return;

    const result = formatMermaid(item.content);
    if (result.success) {
      onContentChange(result.formatted);
    }
    // If error, silently skip (graceful error handling)
  }, [item, onContentChange]);

  // Placeholder when no item is selected
  if (!item) {
    return (
      <div
        className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900"
        data-testid="unified-editor-empty"
      >
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            Select an item to edit
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Choose a diagram or document from the sidebar
          </p>
        </div>
      </div>
    );
  }

  // Diagram history preview mode - show side-by-side comparison
  if (item.type === 'diagram' && diagramHistoryPreview && onDiagramRevert && onClearDiagramHistoryPreview) {
    return (
      <DiagramHistoryPreview
        currentContent={item.content}
        historicalContent={diagramHistoryPreview.historicalContent}
        historicalTimestamp={diagramHistoryPreview.timestamp}
        onRevert={onDiagramRevert}
        onClose={onClearDiagramHistoryPreview}
      />
    );
  }


  // Design items get their own full-width layout (no SplitPane with CodeMirror)
  if (item.type === 'design') {
    // Design history preview mode
    if (designHistoryPreview && onDesignRevert && onClearDesignHistoryPreview) {
      return (
        <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-900">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
            <span className="text-sm text-amber-800 dark:text-amber-200">
              Viewing version from {new Date(designHistoryPreview.timestamp).toLocaleString()}
            </span>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={onDesignRevert}
                className="px-3 py-1 text-sm bg-amber-600 text-white rounded hover:bg-amber-700"
              >
                Revert to this version
              </button>
              <button
                onClick={onClearDesignHistoryPreview}
                className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                Dismiss
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <DesignEditor key={item.id} designId={item.id} />
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col h-full">
        <DesignEditor key={item.id} designId={item.id} />
      </div>
    );
  }

  // Spreadsheet items get their own full-width layout
  if (item.type === 'spreadsheet') {
    return (
      <div className="flex-1 flex flex-col h-full">
        <SpreadsheetEditor key={item.id} spreadsheetId={item.id} />
      </div>
    );
  }

  // Snippet items render with SnippetEditor (with group support)
  if (item.type === 'snippet') {
    return <SnippetGroupView item={item} onSnippetSave={onSnippetSave} onContentChange={onContentChange} onToolbarControls={onSnippetToolbarControls} />;
  }

  // Determine editor language based on item type
  const editorLanguage = item.type === 'diagram' ? 'yaml' : 'markdown';

  // Determine placeholder text based on item type
  const placeholderText =
    item.type === 'diagram'
      ? 'Enter Mermaid diagram syntax...'
      : 'Enter Markdown content...';

  /**
   * Computes the before/after content for diff based on compare mode
   */
  const getDiffContents = () => {
    if (!historyDiff) return null;

    if (historyDiff.compareMode === 'vs-current') {
      // Selected (old) vs Current (new)
      return {
        before: historyDiff.historicalContent,
        after: item.content,
      };
    } else {
      // Previous (old) vs Selected (new)
      return {
        before: historyDiff.previousContent || '',
        after: historyDiff.historicalContent,
      };
    }
  };

  /**
   * Renders the appropriate preview component based on item type
   * Uses key={item.id} to maintain instance across editMode toggles
   * For diagrams, wires the SVG container ref callback for export functionality
   * For designs, renders a placeholder
   * For documents, passes historyDiff for inline diff display
   */
  const previewComponent = item.type === 'diagram' ? (
    <MermaidPreview
      key={item.id}
      content={item.content}
      className="h-full"
      zoomLevel={zoomLevel}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onSetZoom={onSetZoom}
      onContainerRef={svgContainerRef}
      previewRef={previewRef}
    />
  ) : historyDiff?.viewMode === 'side-by-side' ? (
    // Side-by-side diff view using DiffView component
    (() => {
      const diffContents = getDiffContents();
      return diffContents ? (
        <div className="h-full" key={`${item.id}-diff`}>
          <DiffView
            before={diffContents.before}
            after={diffContents.after}
            fileName={item.name}
            mode="split"
            language="markdown"
            fullHeight={true}
          />
        </div>
      ) : (
        <MarkdownPreview
          key={item.id}
          content={item.content}
          className="h-full"
          project={project}
          session={session}
          collapsibleSections
          onContentChange={onContentChange}
        />
      );
    })()
  ) : (
    // Inline diff view using MarkdownPreview
    (() => {
      const diffContents = getDiffContents();
      return (
        <MarkdownPreview
          key={item.id}
          content={item.content}
          className="h-full"
          project={project}
          session={session}
          collapsibleSections
          onContentChange={onContentChange}
          diff={diffContents ? {
            oldContent: diffContents.before,
            newContent: diffContents.after,
          } : null}
          onClearDiff={onClearHistoryDiff}
        />
      );
    })()
  );

  // Preview-only mode (editMode is false)
  if (!editMode) {
    return (
      <div
        className="flex flex-col h-full min-h-0 bg-white dark:bg-gray-900 overflow-hidden p-4"
        data-testid="unified-editor-preview-only"
      >
        <div className="flex-1 min-h-0">
          {previewComponent}
        </div>
      </div>
    );
  }

  // Split pane mode with editor and preview
  return (
    <div
      className="flex flex-col h-full min-h-0 bg-white dark:bg-gray-900"
      data-testid="unified-editor"
    >
      <SplitPane
        direction="horizontal"
        defaultPrimarySize={editorSplitPosition}
        minPrimarySize={20}
        maxPrimarySize={80}
        minSecondarySize={20}
        storageId="unified-editor-split"
        onSizeChange={setEditorSplitPosition}
        primaryContent={
          <div className="flex flex-col h-full min-h-0" data-testid="unified-editor-code-panel">
            <CodeMirrorWrapper
              value={item.content}
              onChange={onContentChange}
              language={editorLanguage}
              height="100%"
              placeholder={placeholderText}
              showLineNumbers={true}
              wordWrap={true}
              readOnly={item.locked}
              onEditorReady={setEditor}
              data-testid="unified-editor-codemirror"
            />
          </div>
        }
        secondaryContent={
          <div
            className="flex flex-col h-full bg-gray-50 dark:bg-gray-800 overflow-hidden"
            data-testid="unified-editor-preview-panel"
          >
            <div className="flex-1 min-h-0 p-4">{previewComponent}</div>
          </div>
        }
      />
    </div>
  );
};

export default UnifiedEditor;
