import { create } from 'zustand';
import { Session, Diagram, Document, CollabState, ProjectTodo, Snippet } from '../types';

/**
 * Design type definition
 */
export interface Design {
  id: string;
  name: string;
  content?: string;
  lastModified?: number;
  deprecated?: boolean;
  pinned?: boolean;
}

/**
 * Spreadsheet type definition
 */
export interface Spreadsheet {
  id: string;
  name: string;
  content?: string;
  lastModified?: number;
  deprecated?: boolean;
  pinned?: boolean;
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

  // Designs in current session
  designs: Design[];
  selectedDesignId: string | null;

  // Spreadsheets in current session
  spreadsheets: Spreadsheet[];
  selectedSpreadsheetId: string | null;

  // Snippets in current session
  snippets: Snippet[];
  selectedSnippetId: string | null;

  // Task graph selection state
  taskGraphSelected: boolean;

  // Todos state
  todos: ProjectTodo[];
  todosSelected: boolean;
  todosProject: string | null;

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

  // Design actions
  setDesigns: (designs: Design[]) => void;
  addDesign: (design: Design) => void;
  updateDesign: (id: string, design: Partial<Design>) => void;
  removeDesign: (id: string) => void;
  selectDesign: (id: string | null) => void;
  getSelectedDesign: () => Design | undefined;

  // Spreadsheet actions
  setSpreadsheets: (spreadsheets: Spreadsheet[]) => void;
  addSpreadsheet: (spreadsheet: Spreadsheet) => void;
  updateSpreadsheet: (id: string, spreadsheet: Partial<Spreadsheet>) => void;
  removeSpreadsheet: (id: string) => void;
  selectSpreadsheet: (id: string | null) => void;
  getSelectedSpreadsheet: () => Spreadsheet | undefined;

  // Snippet actions
  setSnippets: (snippets: Snippet[]) => void;
  addSnippet: (snippet: Snippet) => void;
  updateSnippet: (id: string, snippet: Partial<Snippet>) => void;
  removeSnippet: (id: string) => void;
  selectSnippet: (id: string | null) => void;
  getSelectedSnippet: () => Snippet | undefined;

  // Collab state actions
  setCollabState: (state: CollabState | null) => void;

  // Task graph selection actions
  selectTaskGraph: () => void;
  clearTaskGraphSelection: () => void;

  // Todo actions
  setTodos: (todos: ProjectTodo[]) => void;
  addTodo: (todo: ProjectTodo) => void;
  removeTodo: (id: number) => void;
  selectTodos: (project: string) => void;
  selectedTodoId: number | null;
  selectTodo: (id: number | null) => void;
  updateStoreTodo: (id: number, updates: Partial<ProjectTodo>) => void;

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
  designs: [],
  selectedDesignId: null,
  spreadsheets: [],
  selectedSpreadsheetId: null,
  snippets: [],
  selectedSnippetId: null,
  taskGraphSelected: false,
  todos: [],
  todosSelected: false,
  todosProject: null,
  selectedTodoId: null,
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

    // Clear diagrams, documents, designs, spreadsheets, and related state when session changes
    // This ensures clean state when switching between sessions
    set({
      currentSession: session,
      error: null,
      diagrams: [],
      documents: [],
      designs: [],
      spreadsheets: [],
      snippets: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedDesignId: null,
      selectedSpreadsheetId: null,
      selectedSnippetId: null,
      taskGraphSelected: false,
      todosSelected: false,
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
      set({ selectedDiagramId: id, selectedDocumentId: null, selectedDesignId: null, selectedSpreadsheetId: null, selectedSnippetId: null, taskGraphSelected: false });
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
      set({ selectedDocumentId: id, selectedDiagramId: null, selectedDesignId: null, selectedSpreadsheetId: null, selectedSnippetId: null, taskGraphSelected: false });
    }
  },

  getSelectedDocument: () => {
    const { documents, selectedDocumentId } = get();
    return documents.find((d) => d.id === selectedDocumentId);
  },

  // Design management
  setDesigns: (designs: Design[]) => {
    set({ designs });
    // Clear selected design if it's not in the new list
    const { selectedDesignId } = get();
    if (selectedDesignId && !designs.find((w) => w.id === selectedDesignId)) {
      set({ selectedDesignId: null });
    }
  },

  addDesign: (design: Design) => {
    const { designs } = get();
    // Avoid duplicates
    if (!designs.find((w) => w.id === design.id)) {
      set({ designs: [...designs, design] });
    }
  },

  updateDesign: (id: string, updates: Partial<Design>) => {
    const { designs } = get();
    set({
      designs: designs.map((w) => (w.id === id ? { ...w, ...updates } : w)),
    });
  },

  removeDesign: (id: string) => {
    const { designs, selectedDesignId } = get();
    set({
      designs: designs.filter((w) => w.id !== id),
      selectedDesignId: selectedDesignId === id ? null : selectedDesignId,
    });
  },

  selectDesign: (id: string | null) => {
    const { designs } = get();
    // Only select if design exists or if clearing selection
    if (id === null || designs.find((w) => w.id === id)) {
      set({ selectedDesignId: id, selectedDiagramId: null, selectedDocumentId: null, selectedSpreadsheetId: null, selectedSnippetId: null, taskGraphSelected: false });
    }
  },

  getSelectedDesign: () => {
    const { designs, selectedDesignId } = get();
    return designs.find((w) => w.id === selectedDesignId);
  },

  // Spreadsheet management
  setSpreadsheets: (spreadsheets: Spreadsheet[]) => {
    set({ spreadsheets });
    const { selectedSpreadsheetId } = get();
    if (selectedSpreadsheetId && !spreadsheets.find((s) => s.id === selectedSpreadsheetId)) {
      set({ selectedSpreadsheetId: null });
    }
  },

  addSpreadsheet: (spreadsheet: Spreadsheet) => {
    const { spreadsheets } = get();
    if (!spreadsheets.find((s) => s.id === spreadsheet.id)) {
      set({ spreadsheets: [...spreadsheets, spreadsheet] });
    }
  },

  updateSpreadsheet: (id: string, updates: Partial<Spreadsheet>) => {
    const { spreadsheets } = get();
    set({
      spreadsheets: spreadsheets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    });
  },

  removeSpreadsheet: (id: string) => {
    const { spreadsheets, selectedSpreadsheetId } = get();
    set({
      spreadsheets: spreadsheets.filter((s) => s.id !== id),
      selectedSpreadsheetId: selectedSpreadsheetId === id ? null : selectedSpreadsheetId,
    });
  },

  selectSpreadsheet: (id: string | null) => {
    const { spreadsheets } = get();
    if (id === null || spreadsheets.find((s) => s.id === id)) {
      set({ selectedSpreadsheetId: id, selectedDiagramId: null, selectedDocumentId: null, selectedDesignId: null, selectedSnippetId: null, taskGraphSelected: false });
    }
  },

  getSelectedSpreadsheet: () => {
    const { spreadsheets, selectedSpreadsheetId } = get();
    return spreadsheets.find((s) => s.id === selectedSpreadsheetId);
  },

  // Snippet management
  setSnippets: (snippets: Snippet[]) => {
    set({ snippets });
    const { selectedSnippetId } = get();
    if (selectedSnippetId && !snippets.find((s) => s.id === selectedSnippetId)) {
      set({ selectedSnippetId: null });
    }
  },

  addSnippet: (snippet: Snippet) => {
    const { snippets } = get();
    if (!snippets.find((s) => s.id === snippet.id)) {
      set({ snippets: [...snippets, snippet] });
    }
  },

  updateSnippet: (id: string, updates: Partial<Snippet>) => {
    const { snippets } = get();
    set({
      snippets: snippets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    });
  },

  removeSnippet: (id: string) => {
    const { snippets, selectedSnippetId } = get();
    set({
      snippets: snippets.filter((s) => s.id !== id),
      selectedSnippetId: selectedSnippetId === id ? null : selectedSnippetId,
    });
  },

  selectSnippet: (id: string | null) => {
    const { snippets } = get();
    if (id === null || snippets.find((s) => s.id === id)) {
      set({ selectedSnippetId: id, selectedDiagramId: null, selectedDocumentId: null, selectedDesignId: null, selectedSpreadsheetId: null, taskGraphSelected: false });
    }
  },

  getSelectedSnippet: () => {
    const { snippets, selectedSnippetId } = get();
    return snippets.find((s) => s.id === selectedSnippetId);
  },

  // Collab state management
  setCollabState: (state: CollabState | null) => {
    set({ collabState: state });
  },

  // Task graph selection
  selectTaskGraph: () => {
    set({ taskGraphSelected: true, selectedDiagramId: null, selectedDocumentId: null, selectedDesignId: null, selectedSpreadsheetId: null, selectedSnippetId: null });
  },

  clearTaskGraphSelection: () => {
    set({ taskGraphSelected: false });
  },

  // Todo management
  setTodos: (todos: ProjectTodo[]) => {
    set({ todos });
  },

  addTodo: (todo: ProjectTodo) => {
    const { todos } = get();
    set({ todos: [...todos, todo] });
  },

  removeTodo: (id: number) => {
    const { todos } = get();
    set({ todos: todos.filter((t) => t.id !== id) });
  },

  selectTodos: (project: string) => {
    set({
      todosSelected: true,
      todosProject: project,
      selectedTodoId: null,
      currentSession: null,
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedDesignId: null,
      selectedSpreadsheetId: null,
      selectedSnippetId: null,
      taskGraphSelected: false,
      diagrams: [],
      documents: [],
      designs: [],
      spreadsheets: [],
      snippets: [],
      collabState: null,
    });
  },

  selectTodo: (id: number | null) => {
    if (id === null) {
      set({ selectedTodoId: null, currentSession: null, diagrams: [], documents: [], designs: [], spreadsheets: [], snippets: [], collabState: null });
      return;
    }
    const { todos, todosProject } = get();
    const todo = todos.find(t => t.id === id);
    if (!todo || !todosProject) return;
    set({
      selectedTodoId: id,
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedDesignId: null,
      selectedSpreadsheetId: null,
      selectedSnippetId: null,
      taskGraphSelected: false,
      currentSession: { project: todosProject, name: todo.sessionName } as Session,
      diagrams: [],
      documents: [],
      designs: [],
      spreadsheets: [],
      snippets: [],
      collabState: null,
    });
  },

  updateStoreTodo: (id: number, updates: Partial<ProjectTodo>) => {
    const { todos } = get();
    set({ todos: todos.map(t => t.id === id ? { ...t, ...updates } : t) });
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
      designs: [],
      spreadsheets: [],
      snippets: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedDesignId: null,
      selectedSpreadsheetId: null,
      selectedSnippetId: null,
      taskGraphSelected: false,
      todosSelected: false,
      todosProject: null,
      selectedTodoId: null,
      todos: [],
      collabState: null,
      error: null,
    });
  },

  // Reset store to initial state
  reset: () => set(initialState),
}));
