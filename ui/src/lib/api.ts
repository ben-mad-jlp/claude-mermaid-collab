/**
 * API Client - HTTP fetch methods for communicating with the backend
 */

import type { Session, Diagram, Document, CollabState } from '@/types';
import type { TerminalSession, CreateSessionResult } from '@/types/terminal';
import type { Wireframe } from '@/stores/sessionStore';

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
  };
}

export interface ApiClient {
  getSessions(): Promise<Session[]>;
  createSession(project: string, session: string, sessionType?: 'structured' | 'vibe', useRenderUI?: boolean): Promise<Session>;
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
  getWireframes(project: string, session: string): Promise<Wireframe[]>;
  getWireframe(project: string, session: string, id: string): Promise<Wireframe | null>;
  updateWireframe(project: string, session: string, id: string, content: string): Promise<void>;
  deleteDiagram(project: string, session: string, id: string): Promise<void>;
  deleteDocument(project: string, session: string, id: string): Promise<void>;
  deleteWireframe(project: string, session: string, id: string): Promise<void>;
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
    sessionType?: 'structured' | 'vibe',
    useRenderUI?: boolean
  ): Promise<Session> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project, session, sessionType, useRenderUI }),
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
   * Fetch wireframes for a specific session
   */
  async getWireframes(project: string, session: string): Promise<Wireframe[]> {
    const url = `/api/wireframes?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    // API returns { wireframes: [...] }
    return data.wireframes || [];
  },

  /**
   * Fetch a single wireframe with full content
   */
  async getWireframe(project: string, session: string, id: string): Promise<Wireframe | null> {
    const url = `/api/wireframe/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
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
   * Update a wireframe's content
   */
  async updateWireframe(project: string, session: string, id: string, content: string): Promise<void> {
    const url = `/api/wireframe/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
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
   * Delete a wireframe
   */
  async deleteWireframe(project: string, session: string, id: string): Promise<void> {
    const url = `/api/wireframe/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
  },
};
