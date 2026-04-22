/**
 * API Client - HTTP fetch methods for communicating with the backend
 */

import type { Session, Diagram, Document, CollabState, Snippet, SessionTodo, Image } from '@/types';
import type { Design, Spreadsheet } from '@/stores/sessionStore';
import type { UICodeFile } from '@/types/code-file';
import { getWebSocketClient } from './websocket';

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
  getCodeFiles(project: string, session: string): Promise<UICodeFile[]>;
  getCodeFile(project: string, session: string, id: string): Promise<UICodeFile | null>;
  getSnippet(project: string, session: string, id: string): Promise<Snippet | null>;
  updateSnippet(project: string, session: string, id: string, content: string): Promise<void>;
  deleteSnippet(project: string, session: string, id: string): Promise<void>;
  getSessionTodos(project: string, session: string, includeCompleted?: boolean): Promise<SessionTodo[]>;
  addSessionTodo(project: string, session: string, text: string): Promise<SessionTodo>;
  patchSessionTodo(project: string, session: string, id: number, updates: { text?: string; completed?: boolean; order?: number }): Promise<SessionTodo>;
  removeSessionTodo(project: string, session: string, id: number): Promise<void>;
  reorderSessionTodos(project: string, session: string, orderedIds: number[]): Promise<SessionTodo[]>;
  clearCompletedSessionTodos(project: string, session: string): Promise<{ removedCount: number }>;
  setDeprecated(project: string, session: string, id: string, deprecated: boolean): Promise<void>;
  setPinned(project: string, session: string, id: string, pinned: boolean): Promise<void>;
  setBlueprint(project: string, session: string, id: string, blueprint: boolean): Promise<void>;
  listProjectFiles(project: string, dirPath?: string): Promise<any>;
  listAllProjectFiles(project: string): Promise<{ entries: Array<{ name: string; path: string; relativePath: string; type: 'file' | 'directory'; extension?: string }> }>;
  pushCodeToFile(project: string, session: string, id: string): Promise<any>;
  syncCodeFromDisk(project: string, session: string, id: string): Promise<any>;
  acceptProposedEdit(project: string, session: string, id: string, comment?: string): Promise<{ success: boolean; dirty: boolean }>;
  rejectProposedEdit(project: string, session: string, id: string, comment?: string): Promise<{ success: boolean; noop?: boolean }>;
  getCodeDiff(project: string, session: string, id: string): Promise<any>;
  clearTaskGraph(project: string, session: string): Promise<any>;
  createImage(project: string, session: string, file: File): Promise<{ id: string; name: string; mimeType: string; size: number; uploadedAt: string; success: boolean }>;
  listImages(project: string, session: string): Promise<Image[]>;
  deleteImage(project: string, session: string, id: string): Promise<void>;
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
        'X-Client-Id': getWebSocketClient().clientId,
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

  async getCodeFiles(project: string, session: string): Promise<UICodeFile[]> {
    const url = `/api/code/list?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.files || []).map((f: any): UICodeFile => ({
      id: f.id,
      name: f.name,
      filePath: f.filePath ?? f.name,
      content: '',
      language: f.language ?? '',
      dirty: f.dirty ?? false,
      lastPushedAt: f.lastPushedAt ?? null,
      lastModified: f.lastModified ?? Date.now(),
    }));
  },

  async getCodeFile(project: string, session: string, id: string): Promise<UICodeFile | null> {
    const url = `/api/code/get/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    return {
      id: data.id,
      name: data.name,
      filePath: data.filePath ?? data.name,
      content: data.content ?? '',
      language: data.language ?? '',
      dirty: data.dirty ?? false,
      lastPushedAt: data.lastPushedAt ?? null,
      lastModified: data.lastModified ?? Date.now(),
    };
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
   * Fetch session todos
   */
  async getSessionTodos(project: string, session: string, includeCompleted?: boolean): Promise<SessionTodo[]> {
    const params = new URLSearchParams({ project, session });
    if (includeCompleted === false) {
      params.set('includeCompleted', 'false');
    }
    const response = await fetch(`/api/session-todos?${params}`);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.todos || [];
  },

  /**
   * Add a session todo
   */
  async addSessionTodo(project: string, session: string, text: string): Promise<SessionTodo> {
    const response = await fetch('/api/session-todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session, text }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.todo;
  },

  /**
   * Patch a session todo
   */
  async patchSessionTodo(
    project: string,
    session: string,
    id: number,
    updates: { text?: string; completed?: boolean; order?: number }
  ): Promise<SessionTodo> {
    const response = await fetch(`/api/session-todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session, ...updates }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.todo;
  },

  /**
   * Remove a session todo
   */
  async removeSessionTodo(project: string, session: string, id: number): Promise<void> {
    const url = `/api/session-todos/${id}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },

  /**
   * Reorder session todos
   */
  async reorderSessionTodos(project: string, session: string, orderedIds: number[]): Promise<SessionTodo[]> {
    const response = await fetch('/api/session-todos/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session, orderedIds }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.todos || [];
  },

  /**
   * Clear completed session todos
   */
  async clearCompletedSessionTodos(project: string, session: string): Promise<{ removedCount: number }> {
    const response = await fetch('/api/session-todos/clear-completed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session }),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
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

  async listProjectFiles(project: string, dirPath?: string) {
    const params = new URLSearchParams({ project });
    if (dirPath) params.set('path', dirPath);
    const response = await fetch(`/api/code/files?${params}`);
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  },

  async listAllProjectFiles(
    project: string,
  ): Promise<{ entries: Array<{ name: string; path: string; relativePath: string; type: 'file' | 'directory'; extension?: string }> }> {
    const params = new URLSearchParams({ project, recursive: 'true' });
    const response = await fetch(`/api/code/files?${params}`);
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  },

  async pushCodeToFile(project: string, session: string, id: string) {
    const response = await fetch(`/api/code/push/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  },

  async syncCodeFromDisk(project: string, session: string, id: string) {
    const response = await fetch(`/api/code/sync/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  },

  async acceptProposedEdit(project: string, session: string, id: string, comment?: string) {
    const response = await fetch(`/api/code/proposed-edit/${encodeURIComponent(id)}/accept?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}${comment ? '&comment=' + encodeURIComponent(comment) : ''}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || response.statusText);
    }
    return response.json();
  },

  async rejectProposedEdit(project: string, session: string, id: string, comment?: string) {
    const response = await fetch(`/api/code/proposed-edit/${encodeURIComponent(id)}/reject?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}${comment ? '&comment=' + encodeURIComponent(comment) : ''}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || response.statusText);
    }
    return response.json();
  },

  async getCodeDiff(project: string, session: string, id: string) {
    const response = await fetch(`/api/code/diff/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`);
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  },

  async clearTaskGraph(project: string, session: string) {
    const response = await fetch(
      `/api/session-state/clear-tasks?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`,
      { method: 'POST' }
    );
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  },

  /**
   * Upload a new image
   */
  async createImage(project: string, session: string, file: File): Promise<{ id: string; name: string; mimeType: string; size: number; uploadedAt: string; success: boolean }> {
    const url = `/api/image?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', file.name);
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json();
  },

  /**
   * Fetch images for a specific session
   */
  async listImages(project: string, session: string): Promise<Image[]> {
    const url = `/api/images?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    return data.images || [];
  },

  /**
   * Delete an image
   */
  async deleteImage(project: string, session: string, id: string): Promise<void> {
    const url = `/api/image/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },
};
