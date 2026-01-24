/**
 * useDocumentHistory Hook Tests
 *
 * Tests verify:
 * - Hook initialization with correct default state
 * - Recording changes between old and new content
 * - Clearing diff state
 * - Proper diff detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDocumentHistory } from '../useDocumentHistory';

describe('useDocumentHistory', () => {
  beforeEach(() => {
    // Clear any state before each test
  });

  describe('Initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      expect(result.current.history).toEqual({
        previous: null,
        current: '',
        hasDiff: false,
      });
    });

    it('should have recordChange function', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      expect(typeof result.current.recordChange).toBe('function');
    });

    it('should have clearDiff function', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      expect(typeof result.current.clearDiff).toBe('function');
    });
  });

  describe('Recording Changes', () => {
    it('should record a change from empty to content', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('', 'new content');
      });

      expect(result.current.history.previous).toBe('');
      expect(result.current.history.current).toBe('new content');
      expect(result.current.history.hasDiff).toBe(true);
    });

    it('should record a change from content to different content', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('old content', 'new content');
      });

      expect(result.current.history.previous).toBe('old content');
      expect(result.current.history.current).toBe('new content');
      expect(result.current.history.hasDiff).toBe(true);
    });

    it('should detect no diff when old and new content are the same', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('same content', 'same content');
      });

      expect(result.current.history.previous).toBe('same content');
      expect(result.current.history.current).toBe('same content');
      expect(result.current.history.hasDiff).toBe(false);
    });

    it('should handle multiline content', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));
      const oldContent = 'line 1\nline 2\nline 3';
      const newContent = 'line 1\nmodified line 2\nline 3';

      act(() => {
        result.current.recordChange(oldContent, newContent);
      });

      expect(result.current.history.previous).toBe(oldContent);
      expect(result.current.history.current).toBe(newContent);
      expect(result.current.history.hasDiff).toBe(true);
    });

    it('should handle empty old content', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('', 'new content');
      });

      expect(result.current.history.previous).toBe('');
      expect(result.current.history.current).toBe('new content');
      expect(result.current.history.hasDiff).toBe(true);
    });

    it('should handle empty new content', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('old content', '');
      });

      expect(result.current.history.previous).toBe('old content');
      expect(result.current.history.current).toBe('');
      expect(result.current.history.hasDiff).toBe(true);
    });
  });

  describe('Clearing Diff', () => {
    it('should clear the diff state', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('old content', 'new content');
      });

      expect(result.current.history.hasDiff).toBe(true);

      act(() => {
        result.current.clearDiff();
      });

      expect(result.current.history.previous).toBe(null);
      expect(result.current.history.hasDiff).toBe(false);
    });

    it('should maintain current content when clearing diff', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('old content', 'new content');
      });

      act(() => {
        result.current.clearDiff();
      });

      expect(result.current.history.current).toBe('new content');
    });

    it('should be idempotent', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('old content', 'new content');
      });

      act(() => {
        result.current.clearDiff();
        result.current.clearDiff();
      });

      expect(result.current.history.previous).toBe(null);
      expect(result.current.history.hasDiff).toBe(false);
      expect(result.current.history.current).toBe('new content');
    });
  });

  describe('Sequential Changes', () => {
    it('should handle multiple recordChange calls', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('initial', 'version 1');
      });

      expect(result.current.history.current).toBe('version 1');

      act(() => {
        result.current.recordChange('version 1', 'version 2');
      });

      expect(result.current.history.previous).toBe('version 1');
      expect(result.current.history.current).toBe('version 2');
      expect(result.current.history.hasDiff).toBe(true);
    });

    it('should handle record -> clear -> record sequence', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('old', 'new');
      });

      expect(result.current.history.hasDiff).toBe(true);

      act(() => {
        result.current.clearDiff();
      });

      expect(result.current.history.hasDiff).toBe(false);

      act(() => {
        result.current.recordChange('new', 'updated');
      });

      expect(result.current.history.hasDiff).toBe(true);
      expect(result.current.history.previous).toBe('new');
      expect(result.current.history.current).toBe('updated');
    });
  });

  describe('Different Document IDs', () => {
    it('should maintain separate state for different document IDs', () => {
      const { result: result1 } = renderHook(() =>
        useDocumentHistory('doc-1')
      );
      const { result: result2 } = renderHook(() =>
        useDocumentHistory('doc-2')
      );

      act(() => {
        result1.current.recordChange('old1', 'new1');
      });

      act(() => {
        result2.current.recordChange('old2', 'new2');
      });

      expect(result1.current.history.current).toBe('new1');
      expect(result2.current.history.current).toBe('new2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle whitespace-only content changes', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));

      act(() => {
        result.current.recordChange('   ', '    ');
      });

      expect(result.current.history.hasDiff).toBe(true);
    });

    it('should handle special characters', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));
      const oldContent = 'content with\n\ttabs\nand special!@#$%chars';
      const newContent = 'content with\n\ttabs\nand modified special!@#$%chars';

      act(() => {
        result.current.recordChange(oldContent, newContent);
      });

      expect(result.current.history.previous).toBe(oldContent);
      expect(result.current.history.current).toBe(newContent);
      expect(result.current.history.hasDiff).toBe(true);
    });

    it('should handle very long content', () => {
      const { result } = renderHook(() => useDocumentHistory('test-doc-1'));
      const longContent = 'x'.repeat(10000);
      const longContentModified = longContent + 'y';

      act(() => {
        result.current.recordChange(longContent, longContentModified);
      });

      expect(result.current.history.previous).toBe(longContent);
      expect(result.current.history.current).toBe(longContentModified);
      expect(result.current.history.hasDiff).toBe(true);
    });
  });
});
