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

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AnnotationToolbar,
  insertAnnotation,
  clearAnnotations,
} from '../AnnotationToolbar';
import type * as Monaco from 'monaco-editor';

// Create a mock Monaco IStandaloneCodeEditor for testing
function createMockEditor(
  content: string,
  selectionStart: { lineNumber: number; column: number },
  selectionEnd: { lineNumber: number; column: number }
) {
  const lines = content.split('\n');
  const isEmpty =
    selectionStart.lineNumber === selectionEnd.lineNumber &&
    selectionStart.column === selectionEnd.column;

  const selection = {
    startLineNumber: selectionStart.lineNumber,
    startColumn: selectionStart.column,
    endLineNumber: selectionEnd.lineNumber,
    endColumn: selectionEnd.column,
    isEmpty: () => isEmpty,
  };

  const executeEdits = vi.fn();

  const model = {
    getValueInRange: vi.fn((_range: Monaco.IRange) => {
      // Return the text between start/end columns on the first line for simplicity
      const line = lines[selectionStart.lineNumber - 1] ?? '';
      return line.slice(selectionStart.column - 1, selectionEnd.column - 1);
    }),
    getLineMaxColumn: vi.fn((lineNumber: number) => {
      const line = lines[lineNumber - 1] ?? '';
      return line.length + 1;
    }),
  };

  const editor = {
    getModel: vi.fn(() => model),
    getSelection: vi.fn(() => selection),
    getPosition: vi.fn(() => selectionStart),
    executeEdits: executeEdits,
  } as unknown as Monaco.editor.IStandaloneCodeEditor;

  return { editor, executeEdits, model };
}

describe('AnnotationToolbar', () => {
  describe('Rendering', () => {
    it('should render the toolbar', () => {
      render(<AnnotationToolbar editor={null} />);

      expect(screen.getByTestId('annotation-toolbar')).toBeDefined();
    });

    it('should render comment and clear annotation buttons only', () => {
      render(<AnnotationToolbar editor={null} />);

      expect(screen.getByTestId('annotation-btn-add-comment')).toBeDefined();
      expect(screen.getByTestId('annotation-btn-clear-annotations')).toBeDefined();
      // Propose/Approve/Reject buttons should NOT exist
      expect(screen.queryByTestId('annotation-btn-mark-as-proposed')).toBeNull();
      expect(screen.queryByTestId('annotation-btn-mark-as-approved')).toBeNull();
      expect(screen.queryByTestId('annotation-btn-mark-as-rejected')).toBeNull();
    });

    it('should render with custom className', () => {
      render(<AnnotationToolbar editor={null} className="custom-class" />);

      const toolbar = screen.getByTestId('annotation-toolbar');
      expect(toolbar.className).toContain('custom-class');
    });

    it('should have correct button titles', () => {
      render(<AnnotationToolbar editor={null} />);

      expect(screen.getByTitle('Add comment')).toBeDefined();
      expect(screen.getByTitle('Clear annotations')).toBeDefined();
    });
  });

  describe('Button Click Handlers', () => {
    it('should handle comment button click without crashing', () => {
      render(<AnnotationToolbar editor={null} />);

      expect(() => {
        fireEvent.click(screen.getByTestId('annotation-btn-add-comment'));
      }).not.toThrow();
    });

    it('should handle clear button click without crashing', () => {
      render(<AnnotationToolbar editor={null} />);

      expect(() => {
        fireEvent.click(screen.getByTestId('annotation-btn-clear-annotations'));
      }).not.toThrow();
    });

    it('should call executeEdits when comment button clicked with editor', () => {
      const { editor, executeEdits } = createMockEditor('test content', { lineNumber: 1, column: 1 }, { lineNumber: 1, column: 1 });
      render(<AnnotationToolbar editor={editor} />);

      fireEvent.click(screen.getByTestId('annotation-btn-add-comment'));

      expect(executeEdits).toHaveBeenCalled();
    });
  });
});

describe('insertAnnotation', () => {
  describe('With selection', () => {
    it('should wrap selection with comment markers', () => {
      const { editor, executeEdits } = createMockEditor(
        'Hello World',
        { lineNumber: 1, column: 1 },
        { lineNumber: 1, column: 6 }
      );

      insertAnnotation(editor, 'comment');

      expect(executeEdits).toHaveBeenCalledWith('annotation-toolbar', expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('<!-- comment-start: [comment] -->'),
        }),
      ]));
    });

    it('should include comment-end marker in wrapped selection', () => {
      const { editor, executeEdits } = createMockEditor(
        'Hello World',
        { lineNumber: 1, column: 1 },
        { lineNumber: 1, column: 6 }
      );

      insertAnnotation(editor, 'comment');

      const call = executeEdits.mock.calls[0];
      expect(call[1][0].text).toContain('<!-- comment-end -->');
    });
  });

  describe('Without selection (cursor only)', () => {
    it('should insert comment block at cursor', () => {
      const { editor, executeEdits } = createMockEditor(
        'Hello World',
        { lineNumber: 1, column: 6 },
        { lineNumber: 1, column: 6 }
      );

      insertAnnotation(editor, 'comment');

      expect(executeEdits).toHaveBeenCalledWith('annotation-toolbar', expect.arrayContaining([
        expect.objectContaining({
          text: '<!-- comment: [your comment] -->',
        }),
      ]));
    });
  });

  describe('Edge cases', () => {
    it('should handle null editor gracefully', () => {
      expect(() => {
        insertAnnotation(null as any, 'comment');
      }).not.toThrow();
    });

    it('should handle editor with no model gracefully', () => {
      const editor = {
        getModel: vi.fn(() => null),
        getSelection: vi.fn(() => null),
        executeEdits: vi.fn(),
      } as unknown as Monaco.editor.IStandaloneCodeEditor;

      expect(() => {
        insertAnnotation(editor, 'comment');
      }).not.toThrow();
    });
  });
});

describe('clearAnnotations', () => {
  describe('With selection', () => {
    it('should call executeEdits to remove comment markers', () => {
      const content = '<!-- comment: test --> Hello';
      const { editor, executeEdits } = createMockEditor(
        content,
        { lineNumber: 1, column: 1 },
        { lineNumber: 1, column: content.length + 1 }
      );

      clearAnnotations(editor);

      expect(executeEdits).toHaveBeenCalled();
    });

    it('should produce text without annotation markers', () => {
      const content = '<!-- comment: test --> Hello';
      const { editor, executeEdits, model } = createMockEditor(
        content,
        { lineNumber: 1, column: 1 },
        { lineNumber: 1, column: content.length + 1 }
      );
      // Return the full content from getValueInRange
      model.getValueInRange = vi.fn(() => content);

      clearAnnotations(editor);

      const call = executeEdits.mock.calls[0];
      expect(call[1][0].text).not.toContain('<!-- comment:');
    });
  });

  describe('Without selection (current line)', () => {
    it('should clear annotations from current line', () => {
      const content = 'plain text on line';
      const { editor, executeEdits } = createMockEditor(
        content,
        { lineNumber: 1, column: 5 },
        { lineNumber: 1, column: 5 }
      );

      clearAnnotations(editor);

      expect(executeEdits).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle null editor gracefully', () => {
      expect(() => {
        clearAnnotations(null as any);
      }).not.toThrow();
    });

    it('should handle content without annotations', () => {
      const content = 'Just plain text';
      const { editor, executeEdits, model } = createMockEditor(
        content,
        { lineNumber: 1, column: 1 },
        { lineNumber: 1, column: content.length + 1 }
      );
      model.getValueInRange = vi.fn(() => content);

      clearAnnotations(editor);

      const call = executeEdits.mock.calls[0];
      expect(call[1][0].text).toBe('Just plain text');
    });
  });
});
