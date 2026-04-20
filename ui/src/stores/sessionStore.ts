import { create } from 'zustand';
import { Session, Diagram, Document, CollabState, Snippet, Embed, SessionTodo, Image } from '../types';
import { api } from '../lib/api';

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

  // Embeds in current session
  embeds: Embed[];

  // Images in current session
  images: Image[];

  // Session todos state (per-session, not per-project)
  sessionTodos: SessionTodo[];
  sessionTodosShowCompleted: boolean;
  sessionTodosFetchSeq: number;

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

  // Embed actions
  setEmbeds: (embeds: Embed[]) => void;
  addEmbed: (embed: Embed) => void;
  removeEmbed: (id: string) => void;

  // Image actions
  setImages: (images: Image[]) => void;
  addImage: (image: Image) => void;
  updateImage: (id: string, image: Partial<Image>) => void;
  removeImage: (id: string) => void;

  // Collab state actions
  setCollabState: (state: CollabState | null) => void;

  // Session todo actions
  setSessionTodos: (todos: SessionTodo[]) => void;
  upsertSessionTodo: (todo: SessionTodo) => void;
  removeSessionTodoLocal: (id: number) => void;
  setSessionTodosList: (todos: SessionTodo[]) => void;
  setSessionTodosShowCompleted: (value: boolean) => void;

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
  embeds: [],
  images: [],
  sessionTodos: [],
  sessionTodosShowCompleted: false,
  sessionTodosFetchSeq: 0,
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

    const target = session;

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
      embeds: [],
      images: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedDesignId: null,
      selectedSpreadsheetId: null,
      selectedSnippetId: null,
      sessionTodos: [],
      collabState: null,
    });

    // Fire-and-forget fetch of session todos for the new session
    if (target && target.project && target.name) {
      const seq = get().sessionTodosFetchSeq + 1;
      set({ sessionTodosFetchSeq: seq });
      api
        .getSessionTodos(target.project, target.name, true)
        .then((todos) => {
          if (get().sessionTodosFetchSeq === seq) {
            set({ sessionTodos: todos });
          }
        })
        .catch((err) => {
          console.error('Failed to load session todos:', err);
        });
    }
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
    // Set unconditionally — selectedItem gracefully handles missing artifacts,
    // and guarding here causes tab clicks to silently no-op when the list hasn't
    // been loaded yet, leaving the viewer showing the previously-selected item.
    set({ selectedDiagramId: id, selectedDocumentId: null, selectedDesignId: null, selectedSpreadsheetId: null, selectedSnippetId: null });
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
    set({ selectedDocumentId: id, selectedDiagramId: null, selectedDesignId: null, selectedSpreadsheetId: null, selectedSnippetId: null });
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
    set({ selectedDesignId: id, selectedDiagramId: null, selectedDocumentId: null, selectedSpreadsheetId: null, selectedSnippetId: null });
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
    set({ selectedSpreadsheetId: id, selectedDiagramId: null, selectedDocumentId: null, selectedDesignId: null, selectedSnippetId: null });
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
    set({ selectedSnippetId: id, selectedDiagramId: null, selectedDocumentId: null, selectedDesignId: null, selectedSpreadsheetId: null });
  },

  getSelectedSnippet: () => {
    const { snippets, selectedSnippetId } = get();
    return snippets.find((s) => s.id === selectedSnippetId);
  },

  // Embed management
  setEmbeds: (embeds) => set({ embeds }),
  addEmbed: (embed) => set((state) => ({
    embeds: state.embeds.some((e) => e.id === embed.id)
      ? state.embeds
      : [...state.embeds, embed],
  })),
  removeEmbed: (id) => set((state) => ({
    embeds: state.embeds.filter((e) => e.id !== id),
  })),
  // Image management
  setImages: (images) => {
    set({ images });
  },

  addImage: (image) => {
    const { images } = get();
    if (!images.find((img) => img.id === image.id)) {
      set({ images: [...images, image] });
    }
  },

  updateImage: (id, updates) => {
    const { images } = get();
    set({
      images: images.map((img) => (img.id === id ? { ...img, ...updates } : img)),
    });
  },

  removeImage: (id) => {
    const { images } = get();
    set({
      images: images.filter((img) => img.id !== id),
    });
  },

  // Collab state management
  setCollabState: (state: CollabState | null) => {
    set({ collabState: state });
  },

  // Session todo management
  setSessionTodos: (todos: SessionTodo[]) => {
    set({ sessionTodos: todos });
  },

  upsertSessionTodo: (todo: SessionTodo) => {
    const { sessionTodos } = get();
    const idx = sessionTodos.findIndex((t) => t.id === todo.id);
    if (idx >= 0) {
      const next = sessionTodos.slice();
      next[idx] = todo;
      set({ sessionTodos: next });
    } else {
      set({ sessionTodos: [...sessionTodos, todo] });
    }
  },

  removeSessionTodoLocal: (id: number) => {
    const { sessionTodos } = get();
    set({ sessionTodos: sessionTodos.filter((t) => t.id !== id) });
  },

  setSessionTodosList: (todos: SessionTodo[]) => {
    set({ sessionTodos: todos });
  },

  setSessionTodosShowCompleted: (value: boolean) => {
    set({ sessionTodosShowCompleted: value });
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
      embeds: [],
      images: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedDesignId: null,
      selectedSpreadsheetId: null,
      selectedSnippetId: null,
      sessionTodos: [],
      collabState: null,
      error: null,
    });
  },

  // Reset store to initial state
  reset: () => set(initialState),
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __SESSION_STORE__: typeof useSessionStore }).__SESSION_STORE__ = useSessionStore;
}
