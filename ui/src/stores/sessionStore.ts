import { create } from 'zustand';
import { Session, Diagram, Document, CollabState } from '../types';

/**
 * Wireframe type definition
 */
export interface Wireframe {
  id: string;
  name: string;
  content?: string;
  lastModified?: number;
}

/**
 * Diff state for highlighting document patches
 */
export interface DiffState {
  documentId: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
}

/**
 * Session Store State Interface
 * Manages current session, diagrams, documents, and selection state
 */
export interface SessionState {
  // Available sessions
  sessions: Session[];

  // Current session state
  currentSession: Session | null;
  isLoading: boolean;
  error: string | null;

  // Diagrams in current session
  diagrams: Diagram[];
  selectedDiagramId: string | null;

  // Documents in current session
  documents: Document[];
  selectedDocumentId: string | null;

  // Wireframes in current session
  wireframes: Wireframe[];
  selectedWireframeId: string | null;

  // Task graph selection state
  taskGraphSelected: boolean;

  // Collab state for current session
  collabState: CollabState | null;

  // Pending diff state for document patches
  pendingDiff: DiffState | null;

  // Sessions actions
  setSessions: (sessions: Session[]) => void;

  // Session actions
  setCurrentSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Diagram actions
  setDiagrams: (diagrams: Diagram[]) => void;
  addDiagram: (diagram: Diagram) => void;
  updateDiagram: (id: string, diagram: Partial<Diagram>) => void;
  removeDiagram: (id: string) => void;
  selectDiagram: (id: string | null) => void;
  getSelectedDiagram: () => Diagram | undefined;

  // Document actions
  setDocuments: (documents: Document[]) => void;
  addDocument: (document: Document) => void;
  updateDocument: (id: string, document: Partial<Document>) => void;
  removeDocument: (id: string) => void;
  selectDocument: (id: string | null) => void;
  getSelectedDocument: () => Document | undefined;

  // Wireframe actions
  setWireframes: (wireframes: Wireframe[]) => void;
  addWireframe: (wireframe: Wireframe) => void;
  updateWireframe: (id: string, wireframe: Partial<Wireframe>) => void;
  removeWireframe: (id: string) => void;
  selectWireframe: (id: string | null) => void;
  getSelectedWireframe: () => Wireframe | undefined;

  // Collab state actions
  setCollabState: (state: CollabState | null) => void;

  // Task graph selection actions
  selectTaskGraph: () => void;
  clearTaskGraphSelection: () => void;

  // Diff state actions
  setPendingDiff: (diff: DiffState | null) => void;
  clearPendingDiff: () => void;

  // Clear all session data
  clearSession: () => void;

  // Reset store to initial state
  reset: () => void;
}

/**
 * Initial state for the session store
 */
const initialState = {
  sessions: [],
  currentSession: null,
  isLoading: false,
  error: null,
  diagrams: [],
  selectedDiagramId: null,
  documents: [],
  selectedDocumentId: null,
  wireframes: [],
  selectedWireframeId: null,
  taskGraphSelected: false,
  collabState: null,
  pendingDiff: null,
};

/**
 * Zustand store for managing session, diagram, and document state
 *
 * This store provides centralized state management for:
 * - Current active session
 * - List of diagrams in the session
 * - List of documents in the session
 * - Selection state for diagram/document
 * - Loading and error states
 *
 * All state updates are immutable and can be subscribed to for reactivity
 */
export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,

  // Sessions list management
  setSessions: (sessions: Session[]) => set({ sessions }),

  // Session management
  setCurrentSession: (session: Session | null) => {
    const current = get().currentSession;

    // Only clear state if actually changing sessions
    if (current?.project === session?.project && current?.name === session?.name) {
      return;
    }

    // Clear diagrams, documents, wireframes, and related state when session changes
    // This ensures clean state when switching between sessions
    set({
      currentSession: session,
      error: null,
      diagrams: [],
      documents: [],
      wireframes: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedWireframeId: null,
      taskGraphSelected: false,
      collabState: null,
    });
  },

  setLoading: (loading: boolean) => set({ isLoading: loading }),

  setError: (error: string | null) => set({ error }),

  // Diagram management
  setDiagrams: (diagrams: Diagram[]) => {
    set({ diagrams });
    // Clear selected diagram if it's not in the new list
    const { selectedDiagramId } = get();
    if (selectedDiagramId && !diagrams.find((d) => d.id === selectedDiagramId)) {
      set({ selectedDiagramId: null });
    }
  },

  addDiagram: (diagram: Diagram) => {
    const { diagrams } = get();
    // Avoid duplicates
    if (!diagrams.find((d) => d.id === diagram.id)) {
      set({ diagrams: [...diagrams, diagram] });
    }
  },

  updateDiagram: (id: string, updates: Partial<Diagram>) => {
    const { diagrams } = get();
    set({
      diagrams: diagrams.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    });
  },

  removeDiagram: (id: string) => {
    const { diagrams, selectedDiagramId } = get();
    set({
      diagrams: diagrams.filter((d) => d.id !== id),
      selectedDiagramId: selectedDiagramId === id ? null : selectedDiagramId,
    });
  },

  selectDiagram: (id: string | null) => {
    const { diagrams } = get();
    // Only select if diagram exists or if clearing selection
    if (id === null || diagrams.find((d) => d.id === id)) {
      set({ selectedDiagramId: id, selectedDocumentId: null, selectedWireframeId: null, taskGraphSelected: false });
    }
  },

  getSelectedDiagram: () => {
    const { diagrams, selectedDiagramId } = get();
    return diagrams.find((d) => d.id === selectedDiagramId);
  },

  // Document management
  setDocuments: (documents: Document[]) => {
    set({ documents });
    // Clear selected document if it's not in the new list
    const { selectedDocumentId } = get();
    if (selectedDocumentId && !documents.find((d) => d.id === selectedDocumentId)) {
      set({ selectedDocumentId: null });
    }
  },

  addDocument: (document: Document) => {
    const { documents } = get();
    // Avoid duplicates
    if (!documents.find((d) => d.id === document.id)) {
      set({ documents: [...documents, document] });
    }
  },

  updateDocument: (id: string, updates: Partial<Document>) => {
    const { documents } = get();
    set({
      documents: documents.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    });
  },

  removeDocument: (id: string) => {
    const { documents, selectedDocumentId } = get();
    set({
      documents: documents.filter((d) => d.id !== id),
      selectedDocumentId: selectedDocumentId === id ? null : selectedDocumentId,
    });
  },

  selectDocument: (id: string | null) => {
    const { documents } = get();
    // Only select if document exists or if clearing selection
    if (id === null || documents.find((d) => d.id === id)) {
      set({ selectedDocumentId: id, selectedDiagramId: null, selectedWireframeId: null, taskGraphSelected: false });
    }
  },

  getSelectedDocument: () => {
    const { documents, selectedDocumentId } = get();
    return documents.find((d) => d.id === selectedDocumentId);
  },

  // Wireframe management
  setWireframes: (wireframes: Wireframe[]) => {
    set({ wireframes });
    // Clear selected wireframe if it's not in the new list
    const { selectedWireframeId } = get();
    if (selectedWireframeId && !wireframes.find((w) => w.id === selectedWireframeId)) {
      set({ selectedWireframeId: null });
    }
  },

  addWireframe: (wireframe: Wireframe) => {
    const { wireframes } = get();
    // Avoid duplicates
    if (!wireframes.find((w) => w.id === wireframe.id)) {
      set({ wireframes: [...wireframes, wireframe] });
    }
  },

  updateWireframe: (id: string, updates: Partial<Wireframe>) => {
    const { wireframes } = get();
    set({
      wireframes: wireframes.map((w) => (w.id === id ? { ...w, ...updates } : w)),
    });
  },

  removeWireframe: (id: string) => {
    const { wireframes, selectedWireframeId } = get();
    set({
      wireframes: wireframes.filter((w) => w.id !== id),
      selectedWireframeId: selectedWireframeId === id ? null : selectedWireframeId,
    });
  },

  selectWireframe: (id: string | null) => {
    const { wireframes } = get();
    // Only select if wireframe exists or if clearing selection
    if (id === null || wireframes.find((w) => w.id === id)) {
      set({ selectedWireframeId: id, selectedDiagramId: null, selectedDocumentId: null, taskGraphSelected: false });
    }
  },

  getSelectedWireframe: () => {
    const { wireframes, selectedWireframeId } = get();
    return wireframes.find((w) => w.id === selectedWireframeId);
  },

  // Collab state management
  setCollabState: (state: CollabState | null) => {
    set({ collabState: state });
  },

  // Task graph selection
  selectTaskGraph: () => {
    set({ taskGraphSelected: true, selectedDiagramId: null, selectedDocumentId: null, selectedWireframeId: null });
  },

  clearTaskGraphSelection: () => {
    set({ taskGraphSelected: false });
  },

  // Diff state management
  setPendingDiff: (diff: DiffState | null) => {
    set({ pendingDiff: diff });
  },

  clearPendingDiff: () => {
    set({ pendingDiff: null });
  },

  // Clear all session data
  clearSession: () => {
    set({
      currentSession: null,
      diagrams: [],
      documents: [],
      wireframes: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedWireframeId: null,
      taskGraphSelected: false,
      collabState: null,
      error: null,
    });
  },

  // Reset store to initial state
  reset: () => set(initialState),
}));
