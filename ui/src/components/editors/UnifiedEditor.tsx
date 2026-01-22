/**
 * UnifiedEditor Component
 *
 * A unified editor that combines diagram and document editing capabilities:
 * - Automatically detects item type (diagram or document) and renders appropriate preview
 * - Split pane layout with CodeMirror editor and live preview
 * - Supports toggling between raw/preview and preview-only modes
 * - Persists split position via uiStore
 * - Placeholder state when no item is selected
 *
 * This component provides a single editing interface for both Mermaid diagrams
 * and Markdown documents, reducing code duplication and simplifying the UI.
 */

import React from 'react';
import { SplitPane } from '@/components/layout/SplitPane';
import { CodeMirrorWrapper } from '@/components/editors/CodeMirrorWrapper';
import { MermaidPreview } from '@/components/editors/MermaidPreview';
import { MarkdownPreview } from '@/components/editors/MarkdownPreview';
import { Item } from '@/types';
import { useUIStore } from '@/stores/uiStore';

/**
 * Props for the UnifiedEditor component
 */
export interface UnifiedEditorProps {
  /** The item to edit (diagram or document), or null if none selected */
  item: Item | null;
  /** Whether to show the raw editor (split view) or preview only */
  rawVisible: boolean;
  /** Callback when content changes in the editor */
  onContentChange: (content: string) => void;
}

/**
 * UnifiedEditor Component
 *
 * Combines diagram and document editing into a single component that:
 * - Shows a placeholder when no item is selected
 * - Renders CodeMirror + preview in split pane when rawVisible is true
 * - Renders full-width preview when rawVisible is false
 * - Automatically selects MermaidPreview or MarkdownPreview based on item type
 *
 * @example
 * ```tsx
 * function EditorPanel() {
 *   const [item, setItem] = useState<Item | null>(null);
 *   const { rawVisible } = useUIStore();
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
 *       rawVisible={rawVisible}
 *       onContentChange={handleContentChange}
 *     />
 *   );
 * }
 * ```
 */
export const UnifiedEditor: React.FC<UnifiedEditorProps> = ({
  item,
  rawVisible,
  onContentChange,
}) => {
  const { editorSplitPosition, setEditorSplitPosition } = useUIStore();

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
   */
  const renderPreview = () => {
    if (item.type === 'diagram') {
      return (
        <MermaidPreview
          content={item.content}
          className="h-full"
          data-testid="unified-editor-mermaid-preview"
        />
      );
    }

    return (
      <MarkdownPreview
        content={item.content}
        className="h-full"
        data-testid="unified-editor-markdown-preview"
      />
    );
  };

  // Preview-only mode (rawVisible is false)
  if (!rawVisible) {
    return (
      <div
        className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-auto p-4"
        data-testid="unified-editor-preview-only"
      >
        {renderPreview()}
      </div>
    );
  }

  // Split pane mode with editor and preview
  return (
    <div
      className="flex flex-col h-full bg-white dark:bg-gray-900"
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
          <div className="flex flex-col h-full" data-testid="unified-editor-code-panel">
            <CodeMirrorWrapper
              value={item.content}
              onChange={onContentChange}
              language={editorLanguage}
              height="100%"
              placeholder={placeholderText}
              showLineNumbers={true}
              wordWrap={true}
              readOnly={item.locked}
              data-testid="unified-editor-codemirror"
            />
          </div>
        }
        secondaryContent={
          <div
            className="flex flex-col h-full p-4 bg-gray-50 dark:bg-gray-800 overflow-auto"
            data-testid="unified-editor-preview-panel"
          >
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
              Preview
            </h2>
            <div className="flex-1">{renderPreview()}</div>
          </div>
        }
      />
    </div>
  );
};

export default UnifiedEditor;
