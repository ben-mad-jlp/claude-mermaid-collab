/**
 * API Client - HTTP fetch methods for communicating with the backend
 */

import type { Session, Diagram, Document } from '@/types';

/**
 * API client interface defining available HTTP operations
 */
export interface ApiClient {
  getSessions(): Promise<Session[]>;
  getDiagrams(project: string, session: string): Promise<Diagram[]>;
  getDocuments(project: string, session: string): Promise<Document[]>;
  getDiagram(project: string, session: string, id: string): Promise<Diagram | null>;
  getDocument(project: string, session: string, id: string): Promise<Document | null>;
  updateDiagram(project: string, session: string, id: string, content: string): Promise<void>;
  updateDocument(project: string, session: string, id: string, content: string): Promise<void>;
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
};
