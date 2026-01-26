/**
 * AnnotationToolbar Component Tests
 *
 * Test coverage includes:
 * - Component rendering
 * - Button click handlers
 * - insertAnnotation function behavior
 * - clearAnnotations function behavior
 * - Selection vs cursor position handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  AnnotationToolbar,
  insertAnnotation,
  clearAnnotations,
} from '../AnnotationToolbar';

// Create a mock EditorView for testing
function createMockEditorView(content: string, selectionFrom: number, selectionTo: number) {
  const state = EditorState.create({
    doc: content,
    selection: { anchor: selectionFrom, head: selectionTo },
  });

  // Track dispatched changes
  const dispatchedChanges: any[] = [];

  const mockView = {
    state,
    dispatch: vi.fn((transaction: any) => {
      dispatchedChanges.push(transaction);
    }),
  } as unknown as EditorView;

  return { view: mockView, dispatchedChanges };
}

describe('AnnotationToolbar', () => {
  describe('Rendering', () => {
    it('should render the toolbar', () => {
      render(<AnnotationToolbar editorView={null} />);

      expect(screen.getByTestId('annotation-toolbar')).toBeDefined();
    });

    it('should render all annotation buttons', () => {
      render(<AnnotationToolbar editorView={null} />);

      expect(screen.getByTestId('annotation-btn-add-comment')).toBeDefined();
      expect(screen.getByTestId('annotation-btn-mark-as-proposed')).toBeDefined();
      expect(screen.getByTestId('annotation-btn-mark-as-approved')).toBeDefined();
      expect(screen.getByTestId('annotation-btn-mark-as-rejected')).toBeDefined();
      expect(screen.getByTestId('annotation-btn-clear-annotations')).toBeDefined();
    });

    it('should render with custom className', () => {
      render(<AnnotationToolbar editorView={null} className="custom-class" />);

      const toolbar = screen.getByTestId('annotation-toolbar');
      expect(toolbar.className).toContain('custom-class');
    });

    it('should have correct button titles', () => {
      render(<AnnotationToolbar editorView={null} />);

      expect(screen.getByTitle('Add comment')).toBeDefined();
      expect(screen.getByTitle('Mark as proposed')).toBeDefined();
      expect(screen.getByTitle('Mark as approved')).toBeDefined();
      expect(screen.getByTitle('Mark as rejected')).toBeDefined();
      expect(screen.getByTitle('Clear annotations')).toBeDefined();
    });
  });

  describe('Button Click Handlers', () => {
    it('should handle comment button click with editorView', () => {
      const { view } = createMockEditorView('test content', 0, 4);
      render(<AnnotationToolbar editorView={view} />);

      fireEvent.click(screen.getByTestId('annotation-btn-add-comment'));

      expect(view.dispatch).toHaveBeenCalled();
    });

    it('should handle propose button click with editorView', () => {
      const { view } = createMockEditorView('test content', 0, 4);
      render(<AnnotationToolbar editorView={view} />);

      fireEvent.click(screen.getByTestId('annotation-btn-mark-as-proposed'));

      expect(view.dispatch).toHaveBeenCalled();
    });

    it('should handle approve button click with editorView', () => {
      const { view } = createMockEditorView('test content', 0, 4);
      render(<AnnotationToolbar editorView={view} />);

      fireEvent.click(screen.getByTestId('annotation-btn-mark-as-approved'));

      expect(view.dispatch).toHaveBeenCalled();
    });

    it('should handle clear button click with editorView', () => {
      const { view } = createMockEditorView('<!-- status: approved -->', 0, 0);
      render(<AnnotationToolbar editorView={view} />);

      fireEvent.click(screen.getByTestId('annotation-btn-clear-annotations'));

      expect(view.dispatch).toHaveBeenCalled();
    });

    it('should not crash when clicking buttons with null editorView', () => {
      render(<AnnotationToolbar editorView={null} />);

      expect(() => {
        fireEvent.click(screen.getByTestId('annotation-btn-add-comment'));
        fireEvent.click(screen.getByTestId('annotation-btn-mark-as-proposed'));
        fireEvent.click(screen.getByTestId('annotation-btn-mark-as-approved'));
        fireEvent.click(screen.getByTestId('annotation-btn-clear-annotations'));
      }).not.toThrow();
    });
  });
});

describe('insertAnnotation', () => {
  describe('With selection', () => {
    it('should wrap selection with comment markers', () => {
      const { view } = createMockEditorView('Hello World', 0, 5);

      insertAnnotation(view, 'comment');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 0,
          to: 5,
          insert: '<!-- comment-start: [comment] -->\nHello\n<!-- comment-end -->',
        },
      });
    });

    it('should wrap selection with propose markers', () => {
      const { view } = createMockEditorView('Hello World', 0, 5);

      insertAnnotation(view, 'propose');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 0,
          to: 5,
          insert: '<!-- propose-start -->\nHello\n<!-- propose-end -->',
        },
      });
    });

    it('should wrap selection with approve markers', () => {
      const { view } = createMockEditorView('Hello World', 0, 5);

      insertAnnotation(view, 'approve');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 0,
          to: 5,
          insert: '<!-- approve-start -->\nHello\n<!-- approve-end -->',
        },
      });
    });

    it('should wrap selection with reject markers including reason', () => {
      const { view } = createMockEditorView('Hello World', 0, 5);

      insertAnnotation(view, 'reject', 'Not valid');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 0,
          to: 5,
          insert: '<!-- reject-start: Not valid -->\nHello\n<!-- reject-end -->',
        },
      });
    });
  });

  describe('Without selection (cursor only)', () => {
    it('should insert comment block at cursor', () => {
      const { view } = createMockEditorView('Hello World', 5, 5);

      insertAnnotation(view, 'comment');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 5,
          to: 5,
          insert: '<!-- comment: [your comment] -->',
        },
      });
    });

    it('should insert propose status at cursor', () => {
      const { view } = createMockEditorView('Hello World', 5, 5);

      insertAnnotation(view, 'propose');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 5,
          to: 5,
          insert: '<!-- status: proposed -->',
        },
      });
    });

    it('should insert approve status at cursor', () => {
      const { view } = createMockEditorView('Hello World', 5, 5);

      insertAnnotation(view, 'approve');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 5,
          to: 5,
          insert: '<!-- status: approved -->',
        },
      });
    });

    it('should insert reject status with reason at cursor', () => {
      const { view } = createMockEditorView('Hello World', 5, 5);

      insertAnnotation(view, 'reject', 'Wrong approach');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 5,
          to: 5,
          insert: '<!-- status: rejected: Wrong approach -->',
        },
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle null view gracefully', () => {
      expect(() => {
        insertAnnotation(null as any, 'comment');
      }).not.toThrow();
    });

    it('should handle reject without reason', () => {
      const { view } = createMockEditorView('Hello World', 5, 5);

      insertAnnotation(view, 'reject');

      expect(view.dispatch).toHaveBeenCalledWith({
        changes: {
          from: 5,
          to: 5,
          insert: '<!-- status: rejected:  -->',
        },
      });
    });
  });
});

describe('clearAnnotations', () => {
  describe('With selection', () => {
    it('should remove comment markers from selection', () => {
      const content = '<!-- comment: test --> Hello';
      const { view } = createMockEditorView(content, 0, content.length);

      clearAnnotations(view);

      const call = (view.dispatch as any).mock.calls[0][0];
      expect(call.changes.insert).not.toContain('<!-- comment:');
    });

    it('should remove status markers from selection', () => {
      const content = '<!-- status: proposed --> content';
      const { view } = createMockEditorView(content, 0, content.length);

      clearAnnotations(view);

      const call = (view.dispatch as any).mock.calls[0][0];
      expect(call.changes.insert).not.toContain('<!-- status:');
    });

    it('should remove block markers from selection', () => {
      const content = '<!-- propose-start -->\ncode\n<!-- propose-end -->';
      const { view } = createMockEditorView(content, 0, content.length);

      clearAnnotations(view);

      const call = (view.dispatch as any).mock.calls[0][0];
      expect(call.changes.insert).not.toContain('<!-- propose-start -->');
      expect(call.changes.insert).not.toContain('<!-- propose-end -->');
    });

    it('should collapse multiple newlines after clearing', () => {
      const content = '<!-- comment: test -->\n\n\n\nHello';
      const { view } = createMockEditorView(content, 0, content.length);

      clearAnnotations(view);

      const call = (view.dispatch as any).mock.calls[0][0];
      // Should collapse 4 newlines to 2
      expect(call.changes.insert).not.toContain('\n\n\n');
    });
  });

  describe('Without selection (current line)', () => {
    it('should clear annotations from current line', () => {
      const content = '<!-- status: approved --> code';
      const { view } = createMockEditorView(content, 5, 5);

      clearAnnotations(view);

      expect(view.dispatch).toHaveBeenCalled();
      const call = (view.dispatch as any).mock.calls[0][0];
      // Should process the line containing the cursor
      expect(call.changes.from).toBe(0);
      expect(call.changes.to).toBe(content.length);
    });
  });

  describe('Edge cases', () => {
    it('should handle null view gracefully', () => {
      expect(() => {
        clearAnnotations(null as any);
      }).not.toThrow();
    });

    it('should handle content without annotations', () => {
      const content = 'Just plain text';
      const { view } = createMockEditorView(content, 0, content.length);

      clearAnnotations(view);

      const call = (view.dispatch as any).mock.calls[0][0];
      expect(call.changes.insert).toBe('Just plain text');
    });
  });
});
