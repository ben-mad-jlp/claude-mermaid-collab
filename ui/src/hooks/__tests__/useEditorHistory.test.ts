/**
 * useMonacoHistory Hook Tests
 *
 * (Historically useEditorHistory, for the CodeMirror editor. The editor was
 * migrated to Monaco; the undo/redo history hook is now `useMonacoHistory`.
 * Unlike the old hook it does not expose an `editorRef` — the editor is held
 * internally — so behavior is verified through the public surface:
 *   setEditor / undo / redo / canUndo / canRedo.)
 *
 * Tests verify:
 * - Hook initialization (canUndo/canRedo false, functions provided)
 * - Setting / clearing the editor reference
 * - Undo / redo are safe to call without an editor
 * - Cleanup / reset when editor is removed
 * - Independent state across hook instances
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMonacoHistory } from '../useMonacoHistory';

// Minimal Monaco editor stand-in: getModel() returns a model with the
// alternative-version-id + onDidChangeContent surface the hook touches.
function createMockEditor() {
  const model = {
    getAlternativeVersionId: vi.fn(() => 1),
    onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
  };
  const mockEditor = {
    getModel: vi.fn(() => model),
    trigger: vi.fn(),
  } as any;
  return mockEditor;
}

describe('useMonacoHistory', () => {
  describe('Initialization', () => {
    it('should initialize with canUndo as false', () => {
      const { result } = renderHook(() => useMonacoHistory());

      expect(result.current.canUndo).toBe(false);
    });

    it('should initialize with canRedo as false', () => {
      const { result } = renderHook(() => useMonacoHistory());

      expect(result.current.canRedo).toBe(false);
    });

    it('should provide setEditor function', () => {
      const { result } = renderHook(() => useMonacoHistory());

      expect(typeof result.current.setEditor).toBe('function');
    });

    it('should provide undo function', () => {
      const { result } = renderHook(() => useMonacoHistory());

      expect(typeof result.current.undo).toBe('function');
    });

    it('should provide redo function', () => {
      const { result } = renderHook(() => useMonacoHistory());

      expect(typeof result.current.redo).toBe('function');
    });
  });

  describe('setEditor Function', () => {
    it('should accept an editor without throwing', () => {
      const { result } = renderHook(() => useMonacoHistory());
      const mockEditor = createMockEditor();

      expect(() => {
        act(() => {
          result.current.setEditor(mockEditor);
        });
      }).not.toThrow();
    });

    it('should subscribe to model content changes when given an editor', () => {
      const { result } = renderHook(() => useMonacoHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      expect(mockEditor.getModel().onDidChangeContent).toHaveBeenCalled();
    });

    it('should reset canUndo and canRedo when editor is null', () => {
      const { result } = renderHook(() => useMonacoHistory());
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
      const { result } = renderHook(() => useMonacoHistory());
      const editor1 = createMockEditor();
      const editor2 = createMockEditor();

      expect(() => {
        act(() => {
          result.current.setEditor(editor1);
          result.current.setEditor(null);
          result.current.setEditor(editor2);
        });
      }).not.toThrow();
    });
  });

  describe('Undo Function', () => {
    it('should not crash when undo called without editor', () => {
      const { result } = renderHook(() => useMonacoHistory());

      expect(() => {
        act(() => {
          result.current.undo();
        });
      }).not.toThrow();
    });

    it('should not crash when undo called with canUndo false', () => {
      const { result } = renderHook(() => useMonacoHistory());
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
      const { result } = renderHook(() => useMonacoHistory());

      expect(typeof result.current.undo).toBe('function');

      act(() => {
        result.current.undo();
      });
    });
  });

  describe('Redo Function', () => {
    it('should not crash when redo called without editor', () => {
      const { result } = renderHook(() => useMonacoHistory());

      expect(() => {
        act(() => {
          result.current.redo();
        });
      }).not.toThrow();
    });

    it('should not crash when redo called with canRedo false', () => {
      const { result } = renderHook(() => useMonacoHistory());
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
      const { result } = renderHook(() => useMonacoHistory());

      expect(typeof result.current.redo).toBe('function');

      act(() => {
        result.current.redo();
      });
    });
  });

  describe('Return Object', () => {
    it('should return all required properties', () => {
      const { result } = renderHook(() => useMonacoHistory());

      expect(result.current).toHaveProperty('setEditor');
      expect(result.current).toHaveProperty('undo');
      expect(result.current).toHaveProperty('redo');
      expect(result.current).toHaveProperty('canUndo');
      expect(result.current).toHaveProperty('canRedo');
    });

    it('should have correct return type', () => {
      const { result } = renderHook(() => useMonacoHistory());

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
      const { result } = renderHook(() => useMonacoHistory());

      expect(() => {
        act(() => {
          result.current.setEditor(null);
          result.current.setEditor(null);
          result.current.setEditor(null);
        });
      }).not.toThrow();
    });

    it('should handle setEditor then immediate undo', () => {
      const { result } = renderHook(() => useMonacoHistory());
      const mockEditor = createMockEditor();

      expect(() => {
        act(() => {
          result.current.setEditor(mockEditor);
          result.current.undo();
        });
      }).not.toThrow();
    });

    it('should handle setEditor then immediate redo', () => {
      const { result } = renderHook(() => useMonacoHistory());
      const mockEditor = createMockEditor();

      expect(() => {
        act(() => {
          result.current.setEditor(mockEditor);
          result.current.redo();
        });
      }).not.toThrow();
    });

    it('should maintain hook state across updates', () => {
      const { result, rerender } = renderHook(() => useMonacoHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      const canUndoBefore = result.current.canUndo;

      rerender();

      expect(result.current.canUndo).toBe(canUndoBefore);
    });
  });

  describe('Independent Hook Instances', () => {
    it('should have independent state across instances', () => {
      const { result: result1 } = renderHook(() => useMonacoHistory());
      const { result: result2 } = renderHook(() => useMonacoHistory());

      const editor1 = createMockEditor();
      const editor2 = createMockEditor();

      act(() => {
        result1.current.setEditor(editor1);
        result2.current.setEditor(editor2);
      });

      // Each instance subscribed to its own editor's model.
      expect(editor1.getModel().onDidChangeContent).toHaveBeenCalled();
      expect(editor2.getModel().onDidChangeContent).toHaveBeenCalled();
      expect(result1.current.canUndo).toBe(false);
      expect(result2.current.canUndo).toBe(false);
    });

    it('should not affect other instances when one clears editor', () => {
      const { result: result1 } = renderHook(() => useMonacoHistory());
      const { result: result2 } = renderHook(() => useMonacoHistory());

      const editor1 = createMockEditor();
      const editor2 = createMockEditor();

      act(() => {
        result1.current.setEditor(editor1);
        result2.current.setEditor(editor2);
      });

      act(() => {
        result1.current.setEditor(null);
      });

      // Clearing instance 1 must not throw or disturb instance 2.
      expect(result1.current.canUndo).toBe(false);
      expect(result2.current.canUndo).toBe(false);
    });
  });

  describe('Undo and Redo Callbacks', () => {
    it('should maintain stable references across re-renders without state changes', () => {
      const { result, rerender } = renderHook(() => useMonacoHistory());

      const setEditorBefore = result.current.setEditor;

      rerender();

      // setEditor has no reactive deps, so it stays referentially stable.
      expect(result.current.setEditor).toBe(setEditorBefore);
    });

    it('should expose canUndo as a boolean after setting an editor', () => {
      const { result } = renderHook(() => useMonacoHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      expect(typeof result.current.canUndo).toBe('boolean');
    });

    it('should expose canRedo as a boolean after setting an editor', () => {
      const { result } = renderHook(() => useMonacoHistory());
      const mockEditor = createMockEditor();

      act(() => {
        result.current.setEditor(mockEditor);
      });

      expect(typeof result.current.canRedo).toBe('boolean');
    });
  });
});
