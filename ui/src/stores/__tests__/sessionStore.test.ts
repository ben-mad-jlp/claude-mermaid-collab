import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore, type SessionState } from '../sessionStore';
import { Session, Diagram, Document, CollabState } from '../../types';

describe('useSessionStore', () => {
  beforeEach(() => {
    // Clear the store before each test
    useSessionStore.getState().reset();
  });

  // Test data factories
  const createMockSession = (overrides?: Partial<Session>): Session => ({
    project: 'test-project',
    name: 'Test Session',
    lastActivity: new Date().toISOString(),
    itemCount: 5,
    ...overrides,
  });

  const createMockDiagram = (overrides?: Partial<Diagram>): Diagram => ({
    id: 'diagram-1',
    name: 'Test Diagram',
    content: 'graph TD\n  A --> B',
    lastModified: Date.now(),
    folder: 'diagrams',
    locked: false,
    ...overrides,
  });

  const createMockDocument = (overrides?: Partial<Document>): Document => ({
    id: 'doc-1',
    name: 'Test Document',
    content: '# Test Document\n\nContent here',
    lastModified: Date.now(),
    folder: 'documents',
    locked: false,
    ...overrides,
  });

  const createMockCollabState = (overrides?: Partial<CollabState>): CollabState => ({
    lastActivity: new Date().toISOString(),
    currentItem: 1,
    ...overrides,
  });

  describe('Initial State', () => {
    it('should initialize with null session', () => {
      const state = useSessionStore.getState();
      expect(state.currentSession).toBeNull();
    });

    it('should initialize with empty diagrams array', () => {
      const state = useSessionStore.getState();
      expect(state.diagrams).toEqual([]);
    });

    it('should initialize with empty documents array', () => {
      const state = useSessionStore.getState();
      expect(state.documents).toEqual([]);
    });

    it('should initialize with loading false and error null', () => {
      const state = useSessionStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should initialize with no selected diagram or document', () => {
      const state = useSessionStore.getState();
      expect(state.selectedDiagramId).toBeNull();
      expect(state.selectedDocumentId).toBeNull();
    });

    it('should initialize with null collab state', () => {
      const state = useSessionStore.getState();
      expect(state.collabState).toBeNull();
    });
  });

  describe('Session Management', () => {
    it('should set current session', () => {
      const session = createMockSession();
      useSessionStore.getState().setCurrentSession(session);
      expect(useSessionStore.getState().currentSession).toEqual(session);
    });

    it('should clear session with null', () => {
      const session = createMockSession();
      useSessionStore.getState().setCurrentSession(session);
      useSessionStore.getState().setCurrentSession(null);
      expect(useSessionStore.getState().currentSession).toBeNull();
    });

    it('should clear diagrams and documents when session changes', () => {
      const diagram = createMockDiagram();
      const document = createMockDocument();
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().addDocument(document);

      const session = createMockSession();
      useSessionStore.getState().setCurrentSession(session);
      useSessionStore.getState().setCurrentSession(null);

      const state = useSessionStore.getState();
      expect(state.diagrams).toEqual([]);
      expect(state.documents).toEqual([]);
      expect(state.selectedDiagramId).toBeNull();
      expect(state.selectedDocumentId).toBeNull();
    });

    it('should clear error when setting new session', () => {
      useSessionStore.getState().setError('Some error');
      expect(useSessionStore.getState().error).toBe('Some error');

      const session = createMockSession();
      useSessionStore.getState().setCurrentSession(session);
      expect(useSessionStore.getState().error).toBeNull();
    });

    it('should set loading state', () => {
      useSessionStore.getState().setLoading(true);
      expect(useSessionStore.getState().isLoading).toBe(true);

      useSessionStore.getState().setLoading(false);
      expect(useSessionStore.getState().isLoading).toBe(false);
    });

    it('should set error state', () => {
      const errorMsg = 'Failed to load session';
      useSessionStore.getState().setError(errorMsg);
      expect(useSessionStore.getState().error).toBe(errorMsg);

      useSessionStore.getState().setError(null);
      expect(useSessionStore.getState().error).toBeNull();
    });
  });

  describe('Diagram Management', () => {
    it('should add single diagram', () => {
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);
      expect(useSessionStore.getState().diagrams).toContainEqual(diagram);
    });

    it('should add multiple diagrams', () => {
      const diagram1 = createMockDiagram({ id: 'diagram-1' });
      const diagram2 = createMockDiagram({ id: 'diagram-2' });
      useSessionStore.getState().addDiagram(diagram1);
      useSessionStore.getState().addDiagram(diagram2);

      const diagrams = useSessionStore.getState().diagrams;
      expect(diagrams).toHaveLength(2);
      expect(diagrams).toContainEqual(diagram1);
      expect(diagrams).toContainEqual(diagram2);
    });

    it('should prevent duplicate diagrams', () => {
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().addDiagram(diagram);

      expect(useSessionStore.getState().diagrams).toHaveLength(1);
    });

    it('should set diagrams array', () => {
      const diagrams = [
        createMockDiagram({ id: 'diagram-1' }),
        createMockDiagram({ id: 'diagram-2' }),
      ];
      useSessionStore.getState().setDiagrams(diagrams);

      expect(useSessionStore.getState().diagrams).toEqual(diagrams);
    });

    it('should update diagram properties', () => {
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);

      const newName = 'Updated Diagram';
      useSessionStore.getState().updateDiagram(diagram.id, { name: newName });

      const updated = useSessionStore.getState().diagrams[0];
      expect(updated.name).toBe(newName);
      expect(updated.id).toBe(diagram.id);
      expect(updated.content).toBe(diagram.content);
    });

    it('should remove diagram by id', () => {
      const diagram1 = createMockDiagram({ id: 'diagram-1' });
      const diagram2 = createMockDiagram({ id: 'diagram-2' });
      useSessionStore.getState().addDiagram(diagram1);
      useSessionStore.getState().addDiagram(diagram2);

      useSessionStore.getState().removeDiagram('diagram-1');

      const diagrams = useSessionStore.getState().diagrams;
      expect(diagrams).toHaveLength(1);
      expect(diagrams[0].id).toBe('diagram-2');
    });

    it('should clear diagram selection when removing selected diagram', () => {
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().selectDiagram(diagram.id);

      expect(useSessionStore.getState().selectedDiagramId).toBe(diagram.id);

      useSessionStore.getState().removeDiagram(diagram.id);
      expect(useSessionStore.getState().selectedDiagramId).toBeNull();
    });

    it('should clear selected diagram if not in new list when setting diagrams', () => {
      const diagram1 = createMockDiagram({ id: 'diagram-1' });
      const diagram2 = createMockDiagram({ id: 'diagram-2' });
      useSessionStore.getState().addDiagram(diagram1);
      useSessionStore.getState().selectDiagram('diagram-1');

      useSessionStore.getState().setDiagrams([diagram2]);
      expect(useSessionStore.getState().selectedDiagramId).toBeNull();
    });
  });

  describe('Diagram Selection', () => {
    it('should select diagram by id', () => {
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().selectDiagram(diagram.id);

      expect(useSessionStore.getState().selectedDiagramId).toBe(diagram.id);
    });

    it('should clear diagram selection with null', () => {
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().selectDiagram(diagram.id);
      useSessionStore.getState().selectDiagram(null);

      expect(useSessionStore.getState().selectedDiagramId).toBeNull();
    });

    it('should not select non-existent diagram', () => {
      useSessionStore.getState().selectDiagram('non-existent');
      expect(useSessionStore.getState().selectedDiagramId).toBeNull();
    });

    it('should get selected diagram', () => {
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().selectDiagram(diagram.id);

      const selected = useSessionStore.getState().getSelectedDiagram();
      expect(selected).toEqual(diagram);
    });

    it('should return undefined if no diagram selected', () => {
      const selected = useSessionStore.getState().getSelectedDiagram();
      expect(selected).toBeUndefined();
    });

    it('should switch diagram selection', () => {
      const diagram1 = createMockDiagram({ id: 'diagram-1' });
      const diagram2 = createMockDiagram({ id: 'diagram-2' });
      useSessionStore.getState().addDiagram(diagram1);
      useSessionStore.getState().addDiagram(diagram2);

      useSessionStore.getState().selectDiagram('diagram-1');
      expect(useSessionStore.getState().selectedDiagramId).toBe('diagram-1');

      useSessionStore.getState().selectDiagram('diagram-2');
      expect(useSessionStore.getState().selectedDiagramId).toBe('diagram-2');
    });
  });

  describe('Document Management', () => {
    it('should add single document', () => {
      const document = createMockDocument();
      useSessionStore.getState().addDocument(document);
      expect(useSessionStore.getState().documents).toContainEqual(document);
    });

    it('should add multiple documents', () => {
      const document1 = createMockDocument({ id: 'doc-1' });
      const document2 = createMockDocument({ id: 'doc-2' });
      useSessionStore.getState().addDocument(document1);
      useSessionStore.getState().addDocument(document2);

      const documents = useSessionStore.getState().documents;
      expect(documents).toHaveLength(2);
      expect(documents).toContainEqual(document1);
      expect(documents).toContainEqual(document2);
    });

    it('should prevent duplicate documents', () => {
      const document = createMockDocument();
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().addDocument(document);

      expect(useSessionStore.getState().documents).toHaveLength(1);
    });

    it('should set documents array', () => {
      const documents = [
        createMockDocument({ id: 'doc-1' }),
        createMockDocument({ id: 'doc-2' }),
      ];
      useSessionStore.getState().setDocuments(documents);

      expect(useSessionStore.getState().documents).toEqual(documents);
    });

    it('should update document properties', () => {
      const document = createMockDocument();
      useSessionStore.getState().addDocument(document);

      const newName = 'Updated Document';
      useSessionStore.getState().updateDocument(document.id, { name: newName });

      const updated = useSessionStore.getState().documents[0];
      expect(updated.name).toBe(newName);
      expect(updated.id).toBe(document.id);
      expect(updated.content).toBe(document.content);
    });

    it('should remove document by id', () => {
      const document1 = createMockDocument({ id: 'doc-1' });
      const document2 = createMockDocument({ id: 'doc-2' });
      useSessionStore.getState().addDocument(document1);
      useSessionStore.getState().addDocument(document2);

      useSessionStore.getState().removeDocument('doc-1');

      const documents = useSessionStore.getState().documents;
      expect(documents).toHaveLength(1);
      expect(documents[0].id).toBe('doc-2');
    });

    it('should clear document selection when removing selected document', () => {
      const document = createMockDocument();
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().selectDocument(document.id);

      expect(useSessionStore.getState().selectedDocumentId).toBe(document.id);

      useSessionStore.getState().removeDocument(document.id);
      expect(useSessionStore.getState().selectedDocumentId).toBeNull();
    });

    it('should clear selected document if not in new list when setting documents', () => {
      const document1 = createMockDocument({ id: 'doc-1' });
      const document2 = createMockDocument({ id: 'doc-2' });
      useSessionStore.getState().addDocument(document1);
      useSessionStore.getState().selectDocument('doc-1');

      useSessionStore.getState().setDocuments([document2]);
      expect(useSessionStore.getState().selectedDocumentId).toBeNull();
    });
  });

  describe('Document Selection', () => {
    it('should select document by id', () => {
      const document = createMockDocument();
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().selectDocument(document.id);

      expect(useSessionStore.getState().selectedDocumentId).toBe(document.id);
    });

    it('should clear document selection with null', () => {
      const document = createMockDocument();
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().selectDocument(document.id);
      useSessionStore.getState().selectDocument(null);

      expect(useSessionStore.getState().selectedDocumentId).toBeNull();
    });

    it('should not select non-existent document', () => {
      useSessionStore.getState().selectDocument('non-existent');
      expect(useSessionStore.getState().selectedDocumentId).toBeNull();
    });

    it('should get selected document', () => {
      const document = createMockDocument();
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().selectDocument(document.id);

      const selected = useSessionStore.getState().getSelectedDocument();
      expect(selected).toEqual(document);
    });

    it('should return undefined if no document selected', () => {
      const selected = useSessionStore.getState().getSelectedDocument();
      expect(selected).toBeUndefined();
    });

    it('should switch document selection', () => {
      const document1 = createMockDocument({ id: 'doc-1' });
      const document2 = createMockDocument({ id: 'doc-2' });
      useSessionStore.getState().addDocument(document1);
      useSessionStore.getState().addDocument(document2);

      useSessionStore.getState().selectDocument('doc-1');
      expect(useSessionStore.getState().selectedDocumentId).toBe('doc-1');

      useSessionStore.getState().selectDocument('doc-2');
      expect(useSessionStore.getState().selectedDocumentId).toBe('doc-2');
    });
  });

  describe('Collab State Management', () => {
    it('should set collab state', () => {
      const collabState = createMockCollabState();
      useSessionStore.getState().setCollabState(collabState);
      expect(useSessionStore.getState().collabState).toEqual(collabState);
    });

    it('should clear collab state with null', () => {
      const collabState = createMockCollabState();
      useSessionStore.getState().setCollabState(collabState);
      useSessionStore.getState().setCollabState(null);
      expect(useSessionStore.getState().collabState).toBeNull();
    });

    it('should update collab state properties', () => {
      const collabState = createMockCollabState();
      useSessionStore.getState().setCollabState(collabState);

      const updatedState = createMockCollabState({ currentItem: 5 });
      useSessionStore.getState().setCollabState(updatedState);

      expect(useSessionStore.getState().collabState?.currentItem).toBe(5);
    });
  });

  describe('Clear Session', () => {
    it('should clear all session data', () => {
      // Setup state
      const session = createMockSession();
      const diagram = createMockDiagram();
      const document = createMockDocument();
      const collabState = createMockCollabState();

      useSessionStore.getState().setCurrentSession(session);
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().selectDiagram(diagram.id);
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().selectDocument(document.id);
      useSessionStore.getState().setCollabState(collabState);
      useSessionStore.getState().setError('Some error');

      // Clear session
      useSessionStore.getState().clearSession();

      // Verify everything is cleared
      const state = useSessionStore.getState();
      expect(state.currentSession).toBeNull();
      expect(state.diagrams).toEqual([]);
      expect(state.documents).toEqual([]);
      expect(state.selectedDiagramId).toBeNull();
      expect(state.selectedDocumentId).toBeNull();
      expect(state.collabState).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe('Reset Store', () => {
    it('should reset store to initial state', () => {
      // Modify various state
      const session = createMockSession();
      const diagram = createMockDiagram();
      const document = createMockDocument();

      useSessionStore.getState().setCurrentSession(session);
      useSessionStore.getState().setLoading(true);
      useSessionStore.getState().setError('Error');
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().selectDiagram(diagram.id);
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().selectDocument(document.id);

      // Reset
      useSessionStore.getState().reset();

      // Verify initial state
      const state = useSessionStore.getState();
      expect(state.currentSession).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.diagrams).toEqual([]);
      expect(state.documents).toEqual([]);
      expect(state.selectedDiagramId).toBeNull();
      expect(state.selectedDocumentId).toBeNull();
      expect(state.collabState).toBeNull();
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed diagram and document operations', () => {
      const session = createMockSession();
      const diagrams = [
        createMockDiagram({ id: 'diagram-1', name: 'Diagram 1' }),
        createMockDiagram({ id: 'diagram-2', name: 'Diagram 2' }),
      ];
      const documents = [
        createMockDocument({ id: 'doc-1', name: 'Document 1' }),
        createMockDocument({ id: 'doc-2', name: 'Document 2' }),
      ];

      useSessionStore.getState().setCurrentSession(session);
      useSessionStore.getState().setDiagrams(diagrams);
      useSessionStore.getState().setDocuments(documents);

      // Select diagram first, then document (mutual exclusion - only last selection kept)
      useSessionStore.getState().selectDiagram('diagram-1');
      useSessionStore.getState().selectDocument('doc-1');

      // Update both
      useSessionStore.getState().updateDiagram('diagram-1', { name: 'Updated Diagram 1' });
      useSessionStore.getState().updateDocument('doc-1', { name: 'Updated Document 1' });

      // Verify only document selection is kept (last selection wins - mutual exclusion)
      const state = useSessionStore.getState();
      expect(state.selectedDiagramId).toBeNull(); // Cleared when document was selected
      expect(state.selectedDocumentId).toBe('doc-1');
      expect(state.diagrams[0].name).toBe('Updated Diagram 1');
      expect(state.documents[0].name).toBe('Updated Document 1');
    });

    it('should handle session switching with preserved selections', () => {
      const session1 = createMockSession({ name: 'Session 1' });
      const session2 = createMockSession({ name: 'Session 2' });
      const diagram1 = createMockDiagram({ id: 'diagram-1' });
      const document1 = createMockDocument({ id: 'doc-1' });

      // Setup session 1
      useSessionStore.getState().setCurrentSession(session1);
      useSessionStore.getState().addDiagram(diagram1);
      useSessionStore.getState().selectDiagram('diagram-1');
      useSessionStore.getState().addDocument(document1);
      useSessionStore.getState().selectDocument('doc-1');

      // Switch to session 2
      useSessionStore.getState().setCurrentSession(session2);

      // Session 2 should be clean
      let state = useSessionStore.getState();
      expect(state.currentSession?.name).toBe('Session 2');
      expect(state.diagrams).toEqual([]);
      expect(state.documents).toEqual([]);
      expect(state.selectedDiagramId).toBeNull();
      expect(state.selectedDocumentId).toBeNull();
    });

    it('should track loading and error states during operations', () => {
      let state = useSessionStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();

      // Simulate loading
      useSessionStore.getState().setLoading(true);
      state = useSessionStore.getState();
      expect(state.isLoading).toBe(true);

      // Simulate error
      useSessionStore.getState().setError('Failed to load');
      state = useSessionStore.getState();
      expect(state.error).toBe('Failed to load');

      // Simulate success
      useSessionStore.getState().setLoading(false);
      useSessionStore.getState().setError(null);
      state = useSessionStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('Pending Diff State', () => {
    it('should initialize pendingDiff as null', () => {
      const state = useSessionStore.getState();
      expect(state.pendingDiff).toBeNull();
    });

    it('should set pendingDiff with diff data', () => {
      const diff = {
        documentId: 'doc-1',
        oldContent: 'old text',
        newContent: 'new text',
        timestamp: Date.now(),
      };
      useSessionStore.getState().setPendingDiff(diff);
      expect(useSessionStore.getState().pendingDiff).toEqual(diff);
    });

    it('should store diff with correct structure', () => {
      const timestamp = Date.now();
      const diff = {
        documentId: 'doc-1',
        oldContent: 'old text',
        newContent: 'new text',
        timestamp,
      };
      useSessionStore.getState().setPendingDiff(diff);
      const pendingDiff = useSessionStore.getState().pendingDiff;
      expect(pendingDiff?.documentId).toBe('doc-1');
      expect(pendingDiff?.oldContent).toBe('old text');
      expect(pendingDiff?.newContent).toBe('new text');
      expect(pendingDiff?.timestamp).toBe(timestamp);
    });

    it('should clear pendingDiff with clearPendingDiff', () => {
      const diff = {
        documentId: 'doc-1',
        oldContent: 'old text',
        newContent: 'new text',
        timestamp: Date.now(),
      };
      useSessionStore.getState().setPendingDiff(diff);
      expect(useSessionStore.getState().pendingDiff).not.toBeNull();

      useSessionStore.getState().clearPendingDiff();
      expect(useSessionStore.getState().pendingDiff).toBeNull();
    });

    it('should set pendingDiff to null explicitly', () => {
      const diff = {
        documentId: 'doc-1',
        oldContent: 'old text',
        newContent: 'new text',
        timestamp: Date.now(),
      };
      useSessionStore.getState().setPendingDiff(diff);
      useSessionStore.getState().setPendingDiff(null);
      expect(useSessionStore.getState().pendingDiff).toBeNull();
    });

    it('should update pendingDiff with new diff data', () => {
      const diff1 = {
        documentId: 'doc-1',
        oldContent: 'old text 1',
        newContent: 'new text 1',
        timestamp: Date.now(),
      };
      useSessionStore.getState().setPendingDiff(diff1);
      expect(useSessionStore.getState().pendingDiff?.documentId).toBe('doc-1');

      const diff2 = {
        documentId: 'doc-2',
        oldContent: 'old text 2',
        newContent: 'new text 2',
        timestamp: Date.now() + 1000,
      };
      useSessionStore.getState().setPendingDiff(diff2);
      expect(useSessionStore.getState().pendingDiff?.documentId).toBe('doc-2');
      expect(useSessionStore.getState().pendingDiff?.oldContent).toBe('old text 2');
    });

    it('should preserve pendingDiff when other state changes', () => {
      const diff = {
        documentId: 'doc-1',
        oldContent: 'old text',
        newContent: 'new text',
        timestamp: Date.now(),
      };
      useSessionStore.getState().setPendingDiff(diff);
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);

      expect(useSessionStore.getState().pendingDiff).toEqual(diff);
    });

    it('should clear pendingDiff when session changes', () => {
      const diff = {
        documentId: 'doc-1',
        oldContent: 'old text',
        newContent: 'new text',
        timestamp: Date.now(),
      };
      useSessionStore.getState().setPendingDiff(diff);
      const session = createMockSession();
      useSessionStore.getState().setCurrentSession(session);

      // pendingDiff should persist across session changes (not auto-cleared)
      expect(useSessionStore.getState().pendingDiff).toEqual(diff);
    });
  });

  describe('Store API', () => {
    it('should expose getState method', () => {
      const state = useSessionStore.getState();
      expect(state).toBeDefined();
      expect(typeof state).toBe('object');
    });

    it('should have all required properties', () => {
      const state = useSessionStore.getState();
      expect(state).toHaveProperty('currentSession');
      expect(state).toHaveProperty('isLoading');
      expect(state).toHaveProperty('error');
      expect(state).toHaveProperty('diagrams');
      expect(state).toHaveProperty('selectedDiagramId');
      expect(state).toHaveProperty('documents');
      expect(state).toHaveProperty('selectedDocumentId');
      expect(state).toHaveProperty('collabState');
      expect(state).toHaveProperty('pendingDiff');
      expect(state).toHaveProperty('taskGraphSelected');
    });

    it('should have all required methods', () => {
      const state = useSessionStore.getState();
      expect(typeof state.setCurrentSession).toBe('function');
      expect(typeof state.setLoading).toBe('function');
      expect(typeof state.setError).toBe('function');
      expect(typeof state.setDiagrams).toBe('function');
      expect(typeof state.addDiagram).toBe('function');
      expect(typeof state.updateDiagram).toBe('function');
      expect(typeof state.removeDiagram).toBe('function');
      expect(typeof state.selectDiagram).toBe('function');
      expect(typeof state.getSelectedDiagram).toBe('function');
      expect(typeof state.setDocuments).toBe('function');
      expect(typeof state.addDocument).toBe('function');
      expect(typeof state.updateDocument).toBe('function');
      expect(typeof state.removeDocument).toBe('function');
      expect(typeof state.selectDocument).toBe('function');
      expect(typeof state.getSelectedDocument).toBe('function');
      expect(typeof state.setCollabState).toBe('function');
      expect(typeof state.clearSession).toBe('function');
      expect(typeof state.reset).toBe('function');
      expect(typeof state.setPendingDiff).toBe('function');
      expect(typeof state.clearPendingDiff).toBe('function');
      expect(typeof state.selectTaskGraph).toBe('function');
      expect(typeof state.clearTaskGraphSelection).toBe('function');
    });
  });

  describe('Task Graph Selection', () => {
    it('should initialize with taskGraphSelected false', () => {
      const state = useSessionStore.getState();
      expect(state.taskGraphSelected).toBe(false);
    });

    it('should select task graph and clear diagram/document selection', () => {
      const diagram = createMockDiagram();
      const document = createMockDocument();
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().selectDiagram(diagram.id);

      useSessionStore.getState().selectTaskGraph();

      const state = useSessionStore.getState();
      expect(state.taskGraphSelected).toBe(true);
      expect(state.selectedDiagramId).toBeNull();
      expect(state.selectedDocumentId).toBeNull();
    });

    it('should clear task graph selection', () => {
      useSessionStore.getState().selectTaskGraph();
      useSessionStore.getState().clearTaskGraphSelection();

      expect(useSessionStore.getState().taskGraphSelected).toBe(false);
    });

    it('should clear task graph selection when selecting a diagram', () => {
      const diagram = createMockDiagram();
      useSessionStore.getState().addDiagram(diagram);
      useSessionStore.getState().selectTaskGraph();

      useSessionStore.getState().selectDiagram(diagram.id);

      const state = useSessionStore.getState();
      expect(state.taskGraphSelected).toBe(false);
      expect(state.selectedDiagramId).toBe(diagram.id);
    });

    it('should clear task graph selection when selecting a document', () => {
      const document = createMockDocument();
      useSessionStore.getState().addDocument(document);
      useSessionStore.getState().selectTaskGraph();

      useSessionStore.getState().selectDocument(document.id);

      const state = useSessionStore.getState();
      expect(state.taskGraphSelected).toBe(false);
      expect(state.selectedDocumentId).toBe(document.id);
    });

    it('should clear task graph selection when session changes', () => {
      useSessionStore.getState().selectTaskGraph();
      const session = createMockSession();

      useSessionStore.getState().setCurrentSession(session);

      expect(useSessionStore.getState().taskGraphSelected).toBe(false);
    });

    it('should clear task graph selection when clearing session', () => {
      useSessionStore.getState().selectTaskGraph();

      useSessionStore.getState().clearSession();

      expect(useSessionStore.getState().taskGraphSelected).toBe(false);
    });
  });
});
