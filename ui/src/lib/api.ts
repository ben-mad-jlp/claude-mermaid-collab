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
    return data;
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
    return data;
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
    return data;
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
