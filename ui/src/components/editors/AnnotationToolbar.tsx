/**
 * AnnotationToolbar Component
 *
 * Provides toolbar buttons for adding annotations to document content:
 * - Comment: Add a comment annotation
 * - Propose: Mark content as proposed
 * - Approve: Mark content as approved
 * - Reject: Mark content as rejected with a reason
 * - Clear: Remove annotations from selection or current line
 *
 * Works with CodeMirror EditorView to insert/remove annotation markers.
 */

import React, { useCallback } from 'react';
import { EditorView } from '@codemirror/view';

/**
 * Props for the AnnotationToolbar component
 */
export interface AnnotationToolbarProps {
  /** CodeMirror EditorView instance */
  editorView: EditorView | null;
  /** Custom CSS class name for the container */
  className?: string;
}

/**
 * Annotation type for insertAnnotation function
 */
export type AnnotationType = 'comment' | 'propose' | 'approve' | 'reject';

/**
 * Insert an annotation at the current selection or cursor position
 *
 * @param view - CodeMirror EditorView instance
 * @param type - Type of annotation to insert
 * @param reason - Optional reason (used for reject annotations)
 */
export function insertAnnotation(
  view: EditorView,
  type: AnnotationType,
  reason?: string
): void {
  if (!view) return;

  const state = view.state;
  const selection = state.selection.main;
  const hasSelection = selection.from !== selection.to;
  const selectedText = state.sliceDoc(selection.from, selection.to);

  let newText: string;

  if (hasSelection) {
    // Wrap selection with start/end markers
    let prefix: string;
    let suffix: string;

    switch (type) {
      case 'comment':
        prefix = '<!-- comment-start: [comment] -->';
        suffix = '<!-- comment-end -->';
        break;
      case 'propose':
        prefix = '<!-- propose-start -->';
        suffix = '<!-- propose-end -->';
        break;
      case 'approve':
        prefix = '<!-- approve-start -->';
        suffix = '<!-- approve-end -->';
        break;
      case 'reject':
        prefix = `<!-- reject-start: ${reason || ''} -->`;
        suffix = '<!-- reject-end -->';
        break;
    }

    newText = prefix + '\n' + selectedText + '\n' + suffix;
  } else {
    // Insert block marker at cursor
    switch (type) {
      case 'comment':
        newText = '<!-- comment: [your comment] -->';
        break;
      case 'propose':
        newText = '<!-- status: proposed -->';
        break;
      case 'approve':
        newText = '<!-- status: approved -->';
        break;
      case 'reject':
        newText = `<!-- status: rejected: ${reason || ''} -->`;
        break;
    }
  }

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: newText },
  });
}

/**
 * Clear annotations from the current selection or current line
 *
 * @param view - CodeMirror EditorView instance
 */
export function clearAnnotations(view: EditorView): void {
  if (!view) return;

  const state = view.state;
  const selection = state.selection.main;

  // Get text range to process (selection or current line)
  let from: number;
  let to: number;

  if (selection.from === selection.to) {
    const line = state.doc.lineAt(selection.from);
    from = line.from;
    to = line.to;
  } else {
    from = selection.from;
    to = selection.to;
  }

  const text = state.sliceDoc(from, to);

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

  view.dispatch({
    changes: { from, to, insert: cleanedText },
  });
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
 * Provides a toolbar for adding and clearing annotations in a CodeMirror editor.
 *
 * @example
 * ```tsx
 * function EditorWithAnnotations() {
 *   const [editorView, setEditorView] = useState<EditorView | null>(null);
 *
 *   return (
 *     <div>
 *       <AnnotationToolbar editorView={editorView} />
 *       <CodeMirrorWrapper onEditorReady={setEditorView} ... />
 *     </div>
 *   );
 * }
 * ```
 */
export const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  editorView,
  className = '',
}) => {
  const handleComment = useCallback(() => {
    if (editorView) {
      insertAnnotation(editorView, 'comment');
    }
  }, [editorView]);

  const handlePropose = useCallback(() => {
    if (editorView) {
      insertAnnotation(editorView, 'propose');
    }
  }, [editorView]);

  const handleApprove = useCallback(() => {
    if (editorView) {
      insertAnnotation(editorView, 'approve');
    }
  }, [editorView]);

  const handleReject = useCallback(() => {
    const reason = prompt('Enter rejection reason:');
    if (reason && editorView) {
      insertAnnotation(editorView, 'reject', reason);
    }
  }, [editorView]);

  const handleClear = useCallback(() => {
    if (editorView) {
      clearAnnotations(editorView);
    }
  }, [editorView]);

  return (
    <div
      className={`${className} flex gap-2 items-center`}
      data-testid="annotation-toolbar"
    >
      <ToolbarButton onClick={handleComment} icon="💬" title="Add comment" />
      <ToolbarButton
        onClick={handlePropose}
        icon="📝"
        title="Mark as proposed"
        color="yellow"
      />
      <ToolbarButton
        onClick={handleApprove}
        icon="✓"
        title="Mark as approved"
        color="green"
      />
      <ToolbarButton
        onClick={handleReject}
        icon="✗"
        title="Mark as rejected"
        color="red"
      />
      <Divider />
      <ToolbarButton onClick={handleClear} icon="🧹" title="Clear annotations" />
    </div>
  );
};

export default AnnotationToolbar;
