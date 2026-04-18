/**
 * Annotation toolbar for the WYSIWYG (Milkdown / ProseMirror) editor.
 *
 * Unlike the legacy AnnotationToolbar (which mutated the markdown source by
 * inserting HTML-comment markers in CodeMirror), this toolbar produces
 * structured Annotation records keyed by PM anchors. The host component owns
 * the annotations array and persists it as document metadata.
 */

import React, { useCallback } from 'react';
import type { EditorView } from '@milkdown/prose/view';
import {
  type Annotation,
  type AnnotationKind,
  createAnnotationId,
} from './schema';
import { createAnchor } from './anchor';

export interface AnnotationToolbarWysiwygProps {
  editorView: EditorView | null;
  annotations: Annotation[];
  onAnnotationsChange: (next: Annotation[]) => void;
  className?: string;
}

interface ToolbarButtonProps {
  onClick: () => void;
  icon: string;
  title: string;
  color?: 'default' | 'yellow' | 'green' | 'red';
  testId: string;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  icon,
  title,
  color = 'default',
  testId,
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
      data-testid={testId}
    >
      {icon}
    </button>
  );
};

const Divider: React.FC = () => (
  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
);

export const AnnotationToolbarWysiwyg: React.FC<AnnotationToolbarWysiwygProps> = ({
  editorView,
  annotations,
  onAnnotationsChange,
  className = '',
}) => {
  const addAnnotation = useCallback(
    (kind: AnnotationKind, body: string, reason?: string) => {
      if (!editorView) return;
      const { state } = editorView;
      const { from, to } = state.selection;
      if (from === to) return; // require a selection
      const anchor = createAnchor(state.doc, from, to);
      const annotation: Annotation = {
        id: createAnnotationId(),
        kind,
        anchor,
        body,
        createdAt: Date.now(),
        ...(reason ? { reason } : {}),
      };
      onAnnotationsChange([...annotations, annotation]);
    },
    [editorView, annotations, onAnnotationsChange],
  );

  const handleComment = useCallback(() => {
    const body = window.prompt('Comment:');
    if (body == null) return;
    addAnnotation('comment', body);
  }, [addAnnotation]);

  const handlePropose = useCallback(() => {
    addAnnotation('proposed', '');
  }, [addAnnotation]);

  const handleApprove = useCallback(() => {
    addAnnotation('approved', '');
  }, [addAnnotation]);

  const handleReject = useCallback(() => {
    const reason = window.prompt('Enter rejection reason:');
    if (!reason) return;
    addAnnotation('rejected', '', reason);
  }, [addAnnotation]);

  const handleClear = useCallback(() => {
    if (!editorView) return;
    const { from, to } = editorView.state.selection;
    if (from === to) {
      // Clear all — if caller wants a scoped clear they can select first.
      onAnnotationsChange([]);
      return;
    }
    const next = annotations.filter((ann) => {
      const aFrom = ann.anchor.from;
      const aTo = ann.anchor.to;
      // Drop any annotation whose anchor intersects the selection.
      const intersects = !(aTo < from || aFrom > to);
      return !intersects;
    });
    onAnnotationsChange(next);
  }, [editorView, annotations, onAnnotationsChange]);

  return (
    <div
      className={`${className} flex gap-2 items-center px-2 py-1 border-b border-gray-200 dark:border-gray-700`}
      data-testid="annotation-toolbar"
    >
      <ToolbarButton
        onClick={handleComment}
        icon="💬"
        title="Add comment"
        testId="annotation-btn-comment"
      />
      <ToolbarButton
        onClick={handlePropose}
        icon="📝"
        title="Mark as proposed"
        color="yellow"
        testId="annotation-btn-propose"
      />
      <ToolbarButton
        onClick={handleApprove}
        icon="✓"
        title="Mark as approved"
        color="green"
        testId="annotation-btn-approve"
      />
      <ToolbarButton
        onClick={handleReject}
        icon="✗"
        title="Mark as rejected"
        color="red"
        testId="annotation-btn-reject"
      />
      <Divider />
      <ToolbarButton
        onClick={handleClear}
        icon="🧹"
        title="Clear annotations"
        testId="annotation-btn-clear"
      />
    </div>
  );
};

export default AnnotationToolbarWysiwyg;
