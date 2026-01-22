/**
 * useSession Hook Tests
 *
 * Tests verify:
 * - Hook initialization and state access
 * - Session CRUD operations
 * - Diagram management
 * - Document management
 * - Selection state tracking
 * - Error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSession } from '../useSession';
import { useSessionStore } from '../../stores/sessionStore';
import { Session, Diagram, Document } from '../../types';

describe('useSession', () => {
  beforeEach(() => {
    // Clear store before each test
    useSessionStore.getState().reset();
  });

  describe('Session State', () => {
    it('should initialize with empty session state', () => {
      const { result } = renderHook(() => useSession());

      expect(result.current.currentSession).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set current session', () => {
      const { result } = renderHook(() => useSession());
      const session: Session = {
        project: 'test-project',
        name: 'test-session',
      };

      act(() => {
        result.current.setCurrentSession(session);
      });

      expect(result.current.currentSession).toEqual(session);
    });

    it('should clear current session', () => {
      const { result } = renderHook(() => useSession());
      const session: Session = {
        project: 'test-project',
        name: 'test-session',
      };

      act(() => {
        result.current.setCurrentSession(session);
      });

      expect(result.current.currentSession).toEqual(session);

      act(() => {
        result.current.setCurrentSession(null);
      });

      expect(result.current.currentSession).toBeNull();
    });

    it('should set loading state', () => {
      const { result } = renderHook(() => useSession());

      act(() => {
        result.current.setLoading(true);
      });

      expect(result.current.isLoading).toBe(true);

      act(() => {
        result.current.setLoading(false);
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('should set error state', () => {
      const { result } = renderHook(() => useSession());
      const error = 'Test error';

      act(() => {
        result.current.setError(error);
      });

      expect(result.current.error).toBe(error);

      act(() => {
        result.current.setError(null);
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Diagram Management', () => {
    it('should start with empty diagrams', () => {
      const { result } = renderHook(() => useSession());

      expect(result.current.diagrams).toEqual([]);
      expect(result.current.selectedDiagramId).toBeNull();
    });

    it('should add a diagram', () => {
      const { result } = renderHook(() => useSession());
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        content: 'mermaid code',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDiagram(diagram);
      });

      expect(result.current.diagrams).toContainEqual(diagram);
    });

    it('should update a diagram', () => {
      const { result } = renderHook(() => useSession());
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        content: 'mermaid code',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDiagram(diagram);
      });

      const updated = { name: 'Updated Diagram' };

      act(() => {
        result.current.updateDiagram('diagram-1', updated);
      });

      const updatedDiagram = result.current.diagrams.find((d) => d.id === 'diagram-1');
      expect(updatedDiagram?.name).toBe('Updated Diagram');
    });

    it('should remove a diagram', () => {
      const { result } = renderHook(() => useSession());
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        content: 'mermaid code',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDiagram(diagram);
      });

      expect(result.current.diagrams).toHaveLength(1);

      act(() => {
        result.current.removeDiagram('diagram-1');
      });

      expect(result.current.diagrams).toHaveLength(0);
    });

    it('should select a diagram', () => {
      const { result } = renderHook(() => useSession());
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        content: 'mermaid code',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDiagram(diagram);
        result.current.selectDiagram('diagram-1');
      });

      expect(result.current.selectedDiagramId).toBe('diagram-1');
      expect(result.current.selectedDiagram?.id).toBe('diagram-1');
    });

    it('should clear diagram selection', () => {
      const { result } = renderHook(() => useSession());
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        content: 'mermaid code',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDiagram(diagram);
        result.current.selectDiagram('diagram-1');
      });

      expect(result.current.selectedDiagramId).toBe('diagram-1');

      act(() => {
        result.current.selectDiagram(null);
      });

      expect(result.current.selectedDiagramId).toBeNull();
    });

    it('should clear selection when diagram is removed', () => {
      const { result } = renderHook(() => useSession());
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        content: 'mermaid code',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDiagram(diagram);
        result.current.selectDiagram('diagram-1');
      });

      expect(result.current.selectedDiagramId).toBe('diagram-1');

      act(() => {
        result.current.removeDiagram('diagram-1');
      });

      expect(result.current.selectedDiagramId).toBeNull();
    });
  });

  describe('Document Management', () => {
    it('should start with empty documents', () => {
      const { result } = renderHook(() => useSession());

      expect(result.current.documents).toEqual([]);
      expect(result.current.selectedDocumentId).toBeNull();
    });

    it('should add a document', () => {
      const { result } = renderHook(() => useSession());
      const document: Document = {
        id: 'doc-1',
        name: 'Test Document',
        content: 'markdown content',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDocument(document);
      });

      expect(result.current.documents).toContainEqual(document);
    });

    it('should update a document', () => {
      const { result } = renderHook(() => useSession());
      const document: Document = {
        id: 'doc-1',
        name: 'Test Document',
        content: 'markdown content',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDocument(document);
      });

      const updated = { name: 'Updated Document' };

      act(() => {
        result.current.updateDocument('doc-1', updated);
      });

      const updatedDoc = result.current.documents.find((d) => d.id === 'doc-1');
      expect(updatedDoc?.name).toBe('Updated Document');
    });

    it('should remove a document', () => {
      const { result } = renderHook(() => useSession());
      const document: Document = {
        id: 'doc-1',
        name: 'Test Document',
        content: 'markdown content',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDocument(document);
      });

      expect(result.current.documents).toHaveLength(1);

      act(() => {
        result.current.removeDocument('doc-1');
      });

      expect(result.current.documents).toHaveLength(0);
    });

    it('should select a document', () => {
      const { result } = renderHook(() => useSession());
      const document: Document = {
        id: 'doc-1',
        name: 'Test Document',
        content: 'markdown content',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDocument(document);
        result.current.selectDocument('doc-1');
      });

      expect(result.current.selectedDocumentId).toBe('doc-1');
      expect(result.current.selectedDocument?.id).toBe('doc-1');
    });

    it('should clear document selection', () => {
      const { result } = renderHook(() => useSession());
      const document: Document = {
        id: 'doc-1',
        name: 'Test Document',
        content: 'markdown content',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.addDocument(document);
        result.current.selectDocument('doc-1');
      });

      expect(result.current.selectedDocumentId).toBe('doc-1');

      act(() => {
        result.current.selectDocument(null);
      });

      expect(result.current.selectedDocumentId).toBeNull();
    });
  });

  describe('Utility Methods', () => {
    it('should clear all session data', () => {
      const { result } = renderHook(() => useSession());
      const session: Session = {
        project: 'test-project',
        name: 'test-session',
      };
      const diagram: Diagram = {
        id: 'diagram-1',
        name: 'Test Diagram',
        content: 'mermaid code',
        lastModified: Date.now(),
      };

      act(() => {
        result.current.setCurrentSession(session);
        result.current.addDiagram(diagram);
      });

      expect(result.current.currentSession).not.toBeNull();
      expect(result.current.diagrams).toHaveLength(1);

      act(() => {
        result.current.clearSession();
      });

      expect(result.current.currentSession).toBeNull();
      expect(result.current.diagrams).toHaveLength(0);
    });

    it('should reset store to initial state', () => {
      const { result } = renderHook(() => useSession());
      const session: Session = {
        project: 'test-project',
        name: 'test-session',
      };

      act(() => {
        result.current.setCurrentSession(session);
        result.current.setError('some error');
        result.current.setLoading(true);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.currentSession).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });
});
