/**
 * AnnotationToolbar Component
 *
 * Provides toolbar buttons for adding annotations to document content:
 * - Comment: Add a comment annotation (Monaco gutter annotation)
 * - Clear: Remove annotations from selection or current line
 *
 * Works with Monaco editor to insert/remove annotation markers.
 */

import React, { useCallback } from 'react';
import type * as Monaco from 'monaco-editor';

/**
 * Props for the AnnotationToolbar component
 */
export interface AnnotationToolbarProps {
  /** Monaco editor instance */
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  /** Custom CSS class name for the container */
  className?: string;
}

/**
 * Annotation type for insertAnnotation function
 */
export type AnnotationType = 'comment';

/**
 * Insert an annotation at the current selection or cursor position
 *
 * @param editor - Monaco editor instance
 * @param type - Type of annotation to insert
 * @param reason - Optional reason (used for reject annotations)
 */
export function insertAnnotation(
  editor: Monaco.editor.IStandaloneCodeEditor,
  type: AnnotationType
): void {
  if (!editor) return;

  const model = editor.getModel();
  if (!model) return;

  const selection = editor.getSelection();
  if (!selection) return;

  const hasSelection = !selection.isEmpty();
  const selectedText = hasSelection ? model.getValueInRange(selection) : '';

  let newText: string;

  if (hasSelection) {
    // Wrap selection with start/end markers
    const prefix = '<!-- comment-start: [comment] -->';
    const suffix = '<!-- comment-end -->';
    newText = prefix + '\n' + selectedText + '\n' + suffix;
  } else {
    // Insert block marker at cursor
    newText = '<!-- comment: [your comment] -->';
  }

  editor.executeEdits('annotation-toolbar', [
    { range: selection, text: newText },
  ]);
}

/**
 * Clear annotations from the current selection or current line
 *
 * @param editor - Monaco editor instance
 */
export function clearAnnotations(editor: Monaco.editor.IStandaloneCodeEditor): void {
  if (!editor) return;

  const model = editor.getModel();
  if (!model) return;

  const selection = editor.getSelection();
  if (!selection) return;

  // Get text range to process (selection or current line)
  let range: Monaco.IRange;

  if (selection.isEmpty()) {
    const position = editor.getPosition();
    if (!position) return;
    const lineNumber = position.lineNumber;
    range = {
      startLineNumber: lineNumber,
      startColumn: 1,
      endLineNumber: lineNumber,
      endColumn: model.getLineMaxColumn(lineNumber),
    };
  } else {
    range = selection;
  }

  const text = model.getValueInRange(range);

  // Remove all annotation patterns
  const patterns = [
    /<!-- comment: .+? -->/g,
    /<!-- comment-start: .+? -->/g,
    /<!-- comment-end -->/g,
    /<!-- status: (proposed|approved) -->/g,
    /<!-- status: rejected: .+? -->/g,
    /<!-- (propose|approve)-start -->/g,
    /<!-- (propose|approve)-end -->/g,
    /<!-- reject-start: .+? -->/g,
    /<!-- reject-end -->/g,
  ];

  let cleanedText = text;
  for (const pattern of patterns) {
    cleanedText = cleanedText.replace(pattern, '');
  }

  // Collapse multiple newlines
  cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');

  editor.executeEdits('annotation-toolbar', [
    { range, text: cleanedText },
  ]);
}

/**
 * Button props for toolbar buttons
 */
interface ToolbarButtonProps {
  onClick: () => void;
  icon: string;
  title: string;
  color?: 'default' | 'yellow' | 'green' | 'red';
}

/**
 * Simple toolbar button component
 */
const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  icon,
  title,
  color = 'default',
}) => {
  const colorClasses = {
    default:
      'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300',
    yellow:
      'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400',
    green:
      'bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-400',
    red: 'bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400',
  };

  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${colorClasses[color]}`}
      data-testid={`annotation-btn-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {icon}
    </button>
  );
};

/**
 * Divider component for toolbar
 */
const Divider: React.FC = () => (
  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
);

/**
 * AnnotationToolbar Component
 *
 * Provides a toolbar for adding and clearing annotations in a Monaco editor.
 *
 * @example
 * ```tsx
 * function EditorWithAnnotations() {
 *   const [editor, setEditor] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
 *
 *   return (
 *     <div>
 *       <AnnotationToolbar editor={editor} />
 *       <MonacoWrapper onEditorReady={setEditor} ... />
 *     </div>
 *   );
 * }
 * ```
 */
export const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  editor,
  className = '',
}) => {
  const handleComment = useCallback(() => {
    if (editor) {
      insertAnnotation(editor, 'comment');
    }
  }, [editor]);

  const handleClear = useCallback(() => {
    if (editor) {
      clearAnnotations(editor);
    }
  }, [editor]);

  return (
    <div
      className={`${className} flex gap-2 items-center`}
      data-testid="annotation-toolbar"
    >
      <ToolbarButton onClick={handleComment} icon="💬" title="Add comment" />
      <Divider />
      <ToolbarButton onClick={handleClear} icon="🧹" title="Clear annotations" />
    </div>
  );
};

export default AnnotationToolbar;
