/**
 * UnifiedEditor Component
 *
 * A unified editor that combines diagram and document editing capabilities:
 * - Automatically detects item type (diagram or document) and renders appropriate preview
 * - Split pane layout with CodeMirror editor and live preview
 * - Supports toggling between raw/preview and preview-only modes
 * - Persists split position via uiStore
 * - Placeholder state when no item is selected
 * - Integrates undo/redo history tracking
 * - Integrates diagram export (SVG/PNG) functionality
 * - Integrates Mermaid syntax formatting
 * - Integrates collaborative proposal/comment system
 *
 * This component provides a single editing interface for both Mermaid diagrams
 * and Markdown documents, reducing code duplication and simplifying the UI.
 */

import React, { useCallback, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { SplitPane } from '@/components/layout/SplitPane';
import { CodeMirrorWrapper } from '@/components/editors/CodeMirrorWrapper';
import { MermaidPreview, MermaidPreviewRef } from '@/components/editors/MermaidPreview';
import { MarkdownPreview } from '@/components/editors/MarkdownPreview';
import { Item } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { useEditorHistory } from '@/hooks/useEditorHistory';
import { useExportDiagram } from '@/hooks/useExportDiagram';
import { useProposalStore } from '@/stores/proposalStore';
import { formatMermaid, canFormat } from '@/lib/mermaidFormatter';

/**
 * Props for the UnifiedEditor component
 */
export interface UnifiedEditorProps {
  /** The item to edit (diagram or document), or null if none selected */
  item: Item | null;
  /** Whether to show the editor (split view) or preview only */
  editMode: boolean;
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
}

/**
 * UnifiedEditor Component
 *
 * Combines diagram and document editing into a single component that:
 * - Shows a placeholder when no item is selected
 * - Renders CodeMirror + preview in split pane when editMode is true
 * - Renders full-width preview when editMode is false
 * - Automatically selects MermaidPreview or MarkdownPreview based on item type
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
export const UnifiedEditor: React.FC<UnifiedEditorProps> = ({
  item,
  editMode,
  onContentChange,
  zoomLevel = 100,
  onZoomIn,
  onZoomOut,
  onSetZoom,
  previewRef,
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

  // Determine editor language based on item type
  const editorLanguage = item.type === 'diagram' ? 'yaml' : 'markdown';

  // Determine placeholder text based on item type
  const placeholderText =
    item.type === 'diagram'
      ? 'Enter Mermaid diagram syntax...'
      : 'Enter Markdown content...';

  /**
   * Renders the appropriate preview component based on item type
   * Uses key={item.id} to maintain instance across editMode toggles
   * For diagrams, wires the SVG container ref callback for export functionality
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
  ) : (
    <MarkdownPreview
      key={item.id}
      content={item.content}
      className="h-full"
    />
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
