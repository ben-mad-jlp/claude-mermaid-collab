/**
 * API Client - HTTP fetch methods for communicating with the backend
 */

import type { Session, Diagram, Document, CollabState, ProjectTodo, Snippet } from '@/types';
import type { TerminalSession, CreateSessionResult } from '@/types/terminal';
import type { Design, Spreadsheet } from '@/stores/sessionStore';

// Word lists for session name generation (matching backend)
const ADJECTIVES = [
  'bright', 'calm', 'swift', 'bold', 'warm', 'cool', 'soft', 'clear',
  'fresh', 'pure', 'wise', 'keen', 'fair', 'true', 'kind', 'brave',
  'deep', 'wide', 'tall', 'light', 'dark', 'loud', 'quiet', 'quick',
  'slow', 'sharp', 'smooth', 'rough', 'wild', 'free', 'open', 'still'
];

const NOUNS = [
  'river', 'mountain', 'forest', 'meadow', 'ocean', 'valley', 'canyon', 'lake',
  'stream', 'hill', 'cliff', 'beach', 'island', 'bridge', 'tower', 'garden',
  'field', 'grove', 'pond', 'spring', 'peak', 'ridge', 'shore', 'delta',
  'harbor', 'bay', 'cape', 'reef', 'dune', 'oasis', 'mesa', 'fjord'
];

/**
 * Generate a memorable session name in adjective-adjective-noun format
 */
export function generateSessionName(): string {
  const adj1 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const adj2 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj1}-${adj2}-${noun}`;
}

/**
 * API client interface defining available HTTP operations
 */
export interface ArchiveResult {
  success: boolean;
  archivePath: string;
  archivedFiles: {
    documents: string[];
    diagrams: string[];
    designs: string[];
    spreadsheets: string[];
    lessons: boolean;
  };
}

export interface ApiClient {
  getSessions(): Promise<Session[]>;
  createSession(project: string, session: string, useRenderUI?: boolean): Promise<Session>;
  deleteSession(project: string, session: string): Promise<boolean>;
  archiveSession(project: string, session: string, options?: { deleteSession?: boolean; timestamp?: boolean }): Promise<ArchiveResult>;
  getDiagrams(project: string, session: string): Promise<Diagram[]>;
  getDocuments(project: string, session: string): Promise<Document[]>;
  getDiagram(project: string, session: string, id: string): Promise<Diagram | null>;
  getDocument(project: string, session: string, id: string): Promise<Document | null>;
  updateDiagram(project: string, session: string, id: string, content: string): Promise<void>;
  updateDocument(project: string, session: string, id: string, content: string): Promise<void>;
  killTerminalSession(sessionName: string): Promise<void>;
  cleanupTerminalSessions(activeSessions: string[]): Promise<{ killed: string[]; kept: string[] }>;
  getTerminalSessions(project: string, session: string): Promise<TerminalSession[]>;
  createTerminalSession(project: string, session: string, name?: string): Promise<CreateSessionResult>;
  deleteTerminalSession(project: string, session: string, id: string): Promise<void>;
  renameTerminalSession(project: string, session: string, id: string, name: string): Promise<void>;
  reorderTerminalSessions(project: string, session: string, orderedIds: string[]): Promise<void>;
  getSessionState(project: string, session: string): Promise<CollabState | null>;
  getUIState(project: string, session: string): Promise<CachedUIState | null>;
  getDesigns(project: string, session: string): Promise<Design[]>;
  getDesign(project: string, session: string, id: string): Promise<Design | null>;
  updateDesign(project: string, session: string, id: string, content: string): Promise<void>;
  getDesignHistory(project: string, session: string, designId: string, signal?: AbortSignal): Promise<any | null>;
  getDesignVersion(project: string, session: string, designId: string, timestamp: string, signal?: AbortSignal): Promise<{ content: string } | null>;
  deleteDiagram(project: string, session: string, id: string): Promise<void>;
  deleteDocument(project: string, session: string, id: string): Promise<void>;
  deleteDesign(project: string, session: string, id: string): Promise<void>;
  getSpreadsheets(project: string, session: string): Promise<Spreadsheet[]>;
  getSpreadsheet(project: string, session: string, id: string): Promise<Spreadsheet | null>;
  updateSpreadsheet(project: string, session: string, id: string, content: string): Promise<void>;
  deleteSpreadsheet(project: string, session: string, id: string): Promise<void>;
  createSnippet(project: string, session: string, name: string, content: string): Promise<{ id: string; success: boolean }>;
  getSnippets(project: string, session: string): Promise<Snippet[]>;
  getSnippet(project: string, session: string, id: string): Promise<Snippet | null>;
  updateSnippet(project: string, session: string, id: string, content: string): Promise<void>;
  deleteSnippet(project: string, session: string, id: string): Promise<void>;
  getTodos(project: string): Promise<ProjectTodo[]>;
  addTodo(project: string, title: string, description: string): Promise<ProjectTodo>;
  updateTodo(project: string, id: number, updates: { title?: string }): Promise<ProjectTodo>;
  removeTodo(project: string, id: number): Promise<void>;
  setDeprecated(project: string, session: string, id: string, deprecated: boolean): Promise<void>;
  setPinned(project: string, session: string, id: string, pinned: boolean): Promise<void>;
  setBlueprint(project: string, session: string, id: string, blueprint: boolean): Promise<void>;
}

export interface CachedUIState {
  uiId: string;
  ui: any;
  blocking: boolean;
  status: 'pending' | 'responded' | 'canceled';
  createdAt: number;
}

/**
 * API client implementation with fetch methods for all backend endpoints
 */
export const api: ApiClient = {
  /**
   * Fetch all available sessions
   */
  async getSessions(): Promise<Session[]> {
    const response = await fetch('/api/sessions');
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    // API returns { sessions: [...] } with 'session' field, map to frontend Session type with 'name'
    return (data.sessions || []).map((s: { project: string; session: string; lastAccess?: string }) => ({
      project: s.project,
      name: s.session,
      lastActivity: s.lastAccess,
    }));
  },

  /**
   * Create a new session
   */
  async createSession(
    project: string,
    session: string,
    useRenderUI?: boolean
  ): Promise<Session> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project, session, useRenderUI }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    // Use the expanded project path from the server response
    return {
      project: data.project,
      name: data.session,
    };
  },

  /**
   * Delete/unregister a session
   */
  async deleteSession(project: string, session: string): Promise<boolean> {
    const response = await fetch('/api/sessions', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project, session }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.success;
  },

  /**
   * Archive a session to docs/designs/
   */
  async archiveSession(
    project: string,
    session: string,
    options?: { deleteSession?: boolean; timestamp?: boolean }
  ): Promise<ArchiveResult> {
    const response = await fetch('/api/sessions/archive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project,
        session,
        deleteSession: options?.deleteSession ?? true,
        timestamp: options?.timestamp ?? false,
      }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || response.statusText);
    }
    return response.json();
  },

  /**
   * Fetch diagrams for a specific session
   */
  async getDiagrams(project: string, session: string): Promise<Diagram[]> {
    const url = `/api/diagrams?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    // API returns { diagrams: [...] }
    return data.diagrams || [];
  },

  /**
   * Fetch documents for a specific session
   */
  async getDocuments(project: string, session: string): Promise<Document[]> {
    const url = `/api/documents?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    // API returns { documents: [...] }
    return data.documents || [];
  },

  /**
   * Fetch a single diagram with full content
   */
  async getDiagram(project: string, session: string, id: string): Promise<Diagram | null> {
    const url = `/api/diagram/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Fetch a single document with full content
   */
  async getDocument(project: string, session: string, id: string): Promise<Document | null> {
    const url = `/api/document/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Update a diagram's content
   */
  async updateDiagram(project: string, session: string, id: string, content: string): Promise<void> {
    const url = `/api/diagrams/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Update a document's content
   */
  async updateDocument(project: string, session: string, id: string, content: string): Promise<void> {
    const url = `/api/documents/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Kill a terminal tmux session
   */
  async killTerminalSession(sessionName: string): Promise<void> {
    const response = await fetch('/api/terminal/kill-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionName }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Cleanup orphaned terminal sessions
   */
  async cleanupTerminalSessions(activeSessions: string[]): Promise<{ killed: string[]; kept: string[] }> {
    const response = await fetch('/api/terminal/cleanup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ activeSessions }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Get all terminal sessions for a collab session
   */
  async getTerminalSessions(project: string, session: string): Promise<TerminalSession[]> {
    const url = `/api/terminal/sessions?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.sessions || [];
  },

  /**
   * Create a new terminal session
   */
  async createTerminalSession(project: string, session: string, name?: string): Promise<CreateSessionResult> {
    const response = await fetch('/api/terminal/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session, name }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Delete a terminal session
   */
  async deleteTerminalSession(project: string, session: string, id: string): Promise<void> {
    const url = `/api/terminal/sessions/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Rename a terminal session
   */
  async renameTerminalSession(project: string, session: string, id: string, name: string): Promise<void> {
    const url = `/api/terminal/sessions/${encodeURIComponent(id)}/rename?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Reorder terminal sessions
   */
  async reorderTerminalSessions(project: string, session: string, orderedIds: string[]): Promise<void> {
    const url = `/api/terminal/sessions/reorder?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Get collab session state
   */
  async getSessionState(project: string, session: string): Promise<CollabState | null> {
    const url = `/api/session-state?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Get cached UI state for reconnection recovery
   */
  async getUIState(project: string, session: string): Promise<CachedUIState | null> {
    const url = `/api/ui-state?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    // API returns { status: 'none' } when no cached UI
    if (data.status === 'none') {
      return null;
    }
    return data as CachedUIState;
  },

  /**
   * Fetch designs for a specific session
   */
  async getDesigns(project: string, session: string): Promise<Design[]> {
    const url = `/api/designs?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.designs || [];
  },

  /**
   * Fetch a single design with full content
   */
  async getDesign(project: string, session: string, id: string): Promise<Design | null> {
    const url = `/api/design/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Update a design's content
   */
  async updateDesign(project: string, session: string, id: string, content: string): Promise<void> {
    const url = `/api/design/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Fetch design history
   */
  async getDesignHistory(project: string, session: string, designId: string, signal?: AbortSignal): Promise<any | null> {
    const params = new URLSearchParams({ project, session });
    const url = `/api/design/${encodeURIComponent(designId)}/history?${params}`;
    const response = await fetch(url, { signal });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Fetch a specific design version by timestamp
   */
  async getDesignVersion(project: string, session: string, designId: string, timestamp: string, signal?: AbortSignal): Promise<{ content: string } | null> {
    const params = new URLSearchParams({ project, session, timestamp });
    const url = `/api/design/${encodeURIComponent(designId)}/version?${params}`;
    const response = await fetch(url, { signal });
    if (!response.ok) {
      return null;
    }
    return response.json();
  },

  /**
   * Delete a diagram
   */
  async deleteDiagram(project: string, session: string, id: string): Promise<void> {
    const url = `/api/diagram/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Delete a document
   */
  async deleteDocument(project: string, session: string, id: string): Promise<void> {
    const url = `/api/document/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Delete a design
   */
  async deleteDesign(project: string, session: string, id: string): Promise<void> {
    const url = `/api/design/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Fetch spreadsheets for a specific session
   */
  async getSpreadsheets(project: string, session: string): Promise<Spreadsheet[]> {
    const url = `/api/spreadsheets?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.spreadsheets || [];
  },

  /**
   * Fetch a single spreadsheet with full content
   */
  async getSpreadsheet(project: string, session: string, id: string): Promise<Spreadsheet | null> {
    const url = `/api/spreadsheet/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Update a spreadsheet's content
   */
  async updateSpreadsheet(project: string, session: string, id: string, content: string): Promise<void> {
    const url = `/api/spreadsheet/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Delete a spreadsheet
   */
  async deleteSpreadsheet(project: string, session: string, id: string): Promise<void> {
    const url = `/api/spreadsheet/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Create a new snippet
   */
  async createSnippet(project: string, session: string, name: string, content: string): Promise<{ id: string; success: boolean }> {
    const url = `/api/snippet?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Fetch snippets for a specific session
   */
  async getSnippets(project: string, session: string): Promise<Snippet[]> {
    const url = `/api/snippets?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.snippets || [];
  },

  /**
   * Fetch a single snippet with full content
   */
  async getSnippet(project: string, session: string, id: string): Promise<Snippet | null> {
    const url = `/api/snippet/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Update a snippet's content
   */
  async updateSnippet(project: string, session: string, id: string, content: string): Promise<void> {
    const url = `/api/snippet/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Delete a snippet
   */
  async deleteSnippet(project: string, session: string, id: string): Promise<void> {
    const url = `/api/snippet/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Fetch project todos
   */
  async getTodos(project: string): Promise<ProjectTodo[]> {
    const url = `/api/todos?project=${encodeURIComponent(project)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.todos || [];
  },

  /**
   * Add a project todo
   */
  async addTodo(project: string, title: string, description: string): Promise<ProjectTodo> {
    const response = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, title, description }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.todo;
  },

  /**
   * Update a project todo
   */
  async updateTodo(project: string, id: number, updates: { title?: string }): Promise<ProjectTodo> {
    const response = await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, ...updates }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.todo;
  },

  /**
   * Remove a project todo
   */
  async removeTodo(project: string, id: number): Promise<void> {
    const url = `/api/todos/${id}?project=${encodeURIComponent(project)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Set deprecated status for an artifact
   */
  async setDeprecated(project: string, session: string, id: string, deprecated: boolean): Promise<void> {
    const url = `/api/metadata/item/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deprecated }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Pin or unpin an artifact (locked = pinned to top of list)
   */
  async setPinned(project: string, session: string, id: string, pinned: boolean): Promise<void> {
    const url = `/api/metadata/item/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  async setBlueprint(project: string, session: string, id: string, blueprint: boolean): Promise<void> {
    const url = `/api/metadata/item/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint, locked: blueprint }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },
};
