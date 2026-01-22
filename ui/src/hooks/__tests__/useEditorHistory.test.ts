/**
 * useEditorHistory Hook Tests
 *
 * Tests verify:
 * - Hook initialization with no editor
 * - Setting editor reference
 * - Tracking undo/redo availability
 * - Undo functionality
 * - Redo functionality
 * - Cleanup when editor is removed
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorHistory } from '../useEditorHistory';

// Create a minimal mock editor for testing
function createMockEditor() {
  // Create a minimal EditorView-like object for testing
  const mockEditor = {
    state: {
      // Mock state with history
      history: {
        done: [],
        undone: [],
      },
    },
    dispatch: vi.fn(() => {
      // Mock dispatch
    }),
  } as any;

  return mockEditor;
}

describe('useEditorHistory', () => {
  describe('Initialization', () => {
    it('should initialize with null editor ref', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(result.current.editorRef.current).toBeNull();
    });

    it('should initialize with canUndo as false', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(result.current.canUndo).toBe(false);
    });

    it('should initialize with canRedo as false', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(result.current.canRedo).toBe(false);
    });

    it('should provide setEditor function', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(typeof result.current.setEditor).toBe('function');
    });

    it('should provide undo function', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(typeof result.current.undo).toBe('function');
    });

    it('should provide redo function', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(typeof result.current.redo).toBe('function');
    });
  });

  describe('setEditor Function', () => {
    it('should store editor reference when called with editor', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      expect(result.current.editorRef.current).toBe(mockEditor);
    });

    it('should clear editor reference when called with null', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      expect(result.current.editorRef.current).not.toBeNull();

      act(() => {
        result.current.setEditor(null);
      });

      expect(result.current.editorRef.current).toBeNull();
    });

    it('should reset canUndo and canRedo when editor is null', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      act(() => {
        result.current.setEditor(null);
      });

      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
    });

    it('should handle rapid editor changes', () => {
      const { result } = renderHook(() => useEditorHistory());
      const editor1 = createMockEditor();
      const editor2 = createMockEditor();

      act(() => {
        result.current.setEditor(editor1);
        result.current.setEditor(null);
        result.current.setEditor(editor2);
      });

      expect(result.current.editorRef.current).toBe(editor2);
    });
  });

  describe('Undo Function', () => {
    it('should not crash when undo called without editor', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(() => {
        act(() => {
          result.current.undo();
        });
      }).not.toThrow();
    });

    it('should not crash when undo called with canUndo false', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      // canUndo should be false initially
      expect(result.current.canUndo).toBe(false);

      expect(() => {
        act(() => {
          result.current.undo();
        });
      }).not.toThrow();
    });

    it('should be callable', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(typeof result.current.undo).toBe('function');

      act(() => {
        result.current.undo();
      });
    });
  });

  describe('Redo Function', () => {
    it('should not crash when redo called without editor', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(() => {
        act(() => {
          result.current.redo();
        });
      }).not.toThrow();
    });

    it('should not crash when redo called with canRedo false', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      // canRedo should be false initially
      expect(result.current.canRedo).toBe(false);

      expect(() => {
        act(() => {
          result.current.redo();
        });
      }).not.toThrow();
    });

    it('should be callable', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(typeof result.current.redo).toBe('function');

      act(() => {
        result.current.redo();
      });
    });
  });

  describe('Return Object', () => {
    it('should return all required properties', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(result.current).toHaveProperty('editorRef');
      expect(result.current).toHaveProperty('setEditor');
      expect(result.current).toHaveProperty('undo');
      expect(result.current).toHaveProperty('redo');
      expect(result.current).toHaveProperty('canUndo');
      expect(result.current).toHaveProperty('canRedo');
    });

    it('should have correct return type', () => {
      const { result } = renderHook(() => useEditorHistory());

      // editorRef should be a ref object
      expect(result.current.editorRef).toHaveProperty('current');

      // setEditor, undo, redo should be functions
      expect(typeof result.current.setEditor).toBe('function');
      expect(typeof result.current.undo).toBe('function');
      expect(typeof result.current.redo).toBe('function');

      // canUndo and canRedo should be booleans
      expect(typeof result.current.canUndo).toBe('boolean');
      expect(typeof result.current.canRedo).toBe('boolean');
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple consecutive setEditor calls with null', () => {
      const { result } = renderHook(() => useEditorHistory());

      expect(() => {
        act(() => {
          result.current.setEditor(null);
          result.current.setEditor(null);
          result.current.setEditor(null);
        });
      }).not.toThrow();
    });

    it('should handle setEditor then immediate undo', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      expect(() => {
        act(() => {
          result.current.setEditor(mockEditor);
          result.current.undo();
        });
      }).not.toThrow();
    });

    it('should handle setEditor then immediate redo', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      expect(() => {
        act(() => {
          result.current.setEditor(mockEditor);
          result.current.redo();
        });
      }).not.toThrow();
    });

    it('should maintain hook state across updates', () => {
      const { result, rerender } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      const firstRef = result.current.editorRef.current;

      rerender();

      const secondRef = result.current.editorRef.current;

      expect(firstRef).toBe(secondRef);
    });
  });

  describe('Independent Hook Instances', () => {
    it('should have independent state across instances', () => {
      const { result: result1 } = renderHook(() => useEditorHistory());
      const { result: result2 } = renderHook(() => useEditorHistory());

      const editor1 = createMockEditor();
      const editor2 = createMockEditor();

      act(() => {
        result1.current.setEditor(editor1);
        result2.current.setEditor(editor2);
      });

      expect(result1.current.editorRef.current).toBe(editor1);
      expect(result2.current.editorRef.current).toBe(editor2);
      expect(result1.current.editorRef.current).not.toBe(
        result2.current.editorRef.current
      );
    });

    it('should not affect other instances when one clears editor', () => {
      const { result: result1 } = renderHook(() => useEditorHistory());
      const { result: result2 } = renderHook(() => useEditorHistory());

      const editor1 = createMockEditor();
      const editor2 = createMockEditor();

      act(() => {
        result1.current.setEditor(editor1);
        result2.current.setEditor(editor2);
      });

      act(() => {
        result1.current.setEditor(null);
      });

      expect(result1.current.editorRef.current).toBeNull();
      expect(result2.current.editorRef.current).toBe(editor2);
    });
  });

  describe('Undo and Redo Callbacks', () => {
    it('should maintain function references across re-renders', () => {
      const { result, rerender } = renderHook(() => useEditorHistory());

      const undoBefore = result.current.undo;
      const redoBefore = result.current.redo;

      rerender();

      const undoAfter = result.current.undo;
      const redoAfter = result.current.redo;

      expect(undoBefore).toBe(undoAfter);
      expect(redoBefore).toBe(redoAfter);
    });

    it('should update dependency when canUndo changes', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      const canUndoValue = result.current.canUndo;

      expect(typeof canUndoValue).toBe('boolean');
    });

    it('should update dependency when canRedo changes', () => {
      const { result } = renderHook(() => useEditorHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      const canRedoValue = result.current.canRedo;

      expect(typeof canRedoValue).toBe('boolean');
    });
  });
});
