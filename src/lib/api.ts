/**
 * HTTP API Client for mermaid-collab server communication
 * Provides type-safe wrappers around REST API endpoints
 */

import type { Diagram, Document, DiagramListItem, DocumentListItem } from '../types';
import type { Session } from '../services/session-registry';

export interface APIError extends Error {
  status?: number;
  data?: any;
}

export interface ListResponse<T> {
  items: T[];
}

export interface CreateResponse<T> {
  id: string;
  success: boolean;
  data?: T;
}

export interface UpdateResponse {
  success: boolean;
}

export interface DeleteResponse {
  success: boolean;
}

export interface SessionListResponse {
  sessions: Session[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
}

export interface TranspileResponse {
  mermaid: string;
}

/**
 * HTTP API client for server communication
 * Handles session operations, diagram operations, document operations, and more
 */
export class APIClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3737') {
    this.baseUrl = baseUrl;
  }

  /**
   * Make a fetch request and handle errors
   */
  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string>;
    }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.append(key, value);
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), fetchOptions);
    } catch (error) {
      const apiError = new Error(`Network error: ${error instanceof Error ? error.message : String(error)}`) as APIError;
      apiError.status = 0;
      throw apiError;
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      const apiError = new Error(`Invalid JSON response from server`) as APIError;
      apiError.status = response.status;
      throw apiError;
    }

    if (!response.ok) {
      const apiError = new Error(data.error || `HTTP ${response.status}`) as APIError;
      apiError.status = response.status;
      apiError.data = data;
      throw apiError;
    }

    return data as T;
  }

  // ============================================
  // Session Operations
  // ============================================

  /**
   * Get a list of all registered sessions
   */
  async getSessions(): Promise<Session[]> {
    const response = await this.request<SessionListResponse>('GET', '/api/sessions');
    return response.sessions;
  }

  /**
   * Create/register a new session
   */
  async createSession(project: string, session: string): Promise<Session> {
    const response = await this.request<{ success: boolean; project: string; session: string }>(
      'POST',
      '/api/sessions',
      { body: { project, session } }
    );
    return { project, session, lastAccess: new Date().toISOString() };
  }

  /**
   * Delete/unregister a session
   */
  async deleteSession(project: string, session: string): Promise<boolean> {
    const response = await this.request<DeleteResponse>(
      'DELETE',
      '/api/sessions',
      { body: { project, session } }
    );
    return response.success;
  }

  // ============================================
  // Diagram Operations
  // ============================================

  /**
   * Get a specific diagram by ID
   */
  async getDiagram(project: string, session: string, id: string): Promise<Diagram> {
    return this.request<Diagram>(
      'GET',
      `/api/diagram/${id}`,
      { query: { project, session } }
    );
  }

  /**
   * List all diagrams in a session
   */
  async listDiagrams(project: string, session: string): Promise<DiagramListItem[]> {
    const response = await this.request<{ diagrams: DiagramListItem[] }>(
      'GET',
      '/api/diagrams',
      { query: { project, session } }
    );
    return response.diagrams;
  }

  /**
   * Create a new diagram
   */
  async createDiagram(
    project: string,
    session: string,
    name: string,
    content: string
  ): Promise<string> {
    const response = await this.request<CreateResponse<Diagram>>(
      'POST',
      '/api/diagram',
      {
        query: { project, session },
        body: { name, content },
      }
    );
    return response.id;
  }

  /**
   * Update an existing diagram
   */
  async updateDiagram(
    project: string,
    session: string,
    id: string,
    content: string
  ): Promise<void> {
    await this.request<UpdateResponse>(
      'POST',
      `/api/diagram/${id}`,
      {
        query: { project, session },
        body: { content },
      }
    );
  }

  /**
   * Update a diagram using patch (search-replace)
   * Only replaces the first occurrence of oldString
   */
  async patchDiagram(
    project: string,
    session: string,
    id: string,
    oldString: string,
    newString: string
  ): Promise<void> {
    await this.request<UpdateResponse>(
      'POST',
      `/api/diagram/${id}`,
      {
        query: { project, session },
        body: {
          content: null, // Will be handled by server
          patch: { oldString, newString },
        },
      }
    );
  }

  /**
   * Delete a diagram
   */
  async deleteDiagram(project: string, session: string, id: string): Promise<void> {
    await this.request<DeleteResponse>(
      'DELETE',
      `/api/diagram/${id}`,
      { query: { project, session } }
    );
  }

  // ============================================
  // Document Operations
  // ============================================

  /**
   * Get a specific document by ID
   */
  async getDocument(project: string, session: string, id: string): Promise<Document> {
    return this.request<Document>(
      'GET',
      `/api/document/${id}`,
      { query: { project, session } }
    );
  }

  /**
   * Get clean content of a document (without formatting)
   */
  async getDocumentClean(project: string, session: string, id: string): Promise<string> {
    const response = await this.request<{ content: string }>(
      'GET',
      `/api/document/${id}/clean`,
      { query: { project, session } }
    );
    return response.content;
  }

  /**
   * List all documents in a session
   */
  async listDocuments(project: string, session: string): Promise<DocumentListItem[]> {
    const response = await this.request<{ documents: DocumentListItem[] }>(
      'GET',
      '/api/documents',
      { query: { project, session } }
    );
    return response.documents;
  }

  /**
   * Create a new document
   */
  async createDocument(
    project: string,
    session: string,
    name: string,
    content: string
  ): Promise<string> {
    const response = await this.request<CreateResponse<Document>>(
      'POST',
      '/api/document',
      {
        query: { project, session },
        body: { name, content },
      }
    );
    return response.id;
  }

  /**
   * Update an existing document
   */
  async updateDocument(
    project: string,
    session: string,
    id: string,
    content: string
  ): Promise<void> {
    await this.request<UpdateResponse>(
      'POST',
      `/api/document/${id}`,
      {
        query: { project, session },
        body: { content },
      }
    );
  }

  /**
   * Update a document using patch (search-replace)
   * Only replaces the first occurrence of oldString
   */
  async patchDocument(
    project: string,
    session: string,
    id: string,
    oldString: string,
    newString: string
  ): Promise<void> {
    await this.request<UpdateResponse>(
      'POST',
      `/api/document/${id}`,
      {
        query: { project, session },
        body: {
          content: null, // Will be handled by server
          patch: { oldString, newString },
        },
      }
    );
  }

  /**
   * Delete a document
   */
  async deleteDocument(project: string, session: string, id: string): Promise<void> {
    await this.request<DeleteResponse>(
      'DELETE',
      `/api/document/${id}`,
      { query: { project, session } }
    );
  }

  // ============================================
  // Validation & Rendering Operations
  // ============================================

  /**
   * Validate Mermaid diagram syntax
   */
  async validateDiagram(content: string): Promise<ValidationResult> {
    return this.request<ValidationResult>(
      'POST',
      '/api/validate',
      { body: { content } }
    );
  }

  /**
   * Render a diagram as SVG
   */
  async renderDiagramSVG(
    project: string,
    session: string,
    id: string,
    theme: string = 'default'
  ): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/api/render/${id}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&theme=${encodeURIComponent(theme)}`
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const apiError = new Error(data.error || `HTTP ${response.status}`) as APIError;
      apiError.status = response.status;
      apiError.data = data;
      throw apiError;
    }

    return response.text();
  }

  /**
   * Get thumbnail for a diagram
   */
  async getDiagramThumbnail(
    project: string,
    session: string,
    id: string
  ): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/api/thumbnail/${id}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const apiError = new Error(data.error || `HTTP ${response.status}`) as APIError;
      apiError.status = response.status;
      apiError.data = data;
      throw apiError;
    }

    return response.text();
  }

  /**
   * Transpile SMACH diagram to Mermaid
   */
  async transpileDiagram(
    project: string,
    session: string,
    id: string
  ): Promise<string> {
    const response = await this.request<TranspileResponse>(
      'GET',
      `/api/transpile/${id}`,
      { query: { project, session } }
    );
    return response.mermaid;
  }

  // ============================================
  // Metadata Operations
  // ============================================

  /**
   * Get metadata for a session
   */
  async getMetadata(project: string, session: string) {
    return this.request(
      'GET',
      '/api/metadata',
      { query: { project, session } }
    );
  }

  /**
   * Update metadata for an item (folder or locked status)
   */
  async updateItemMetadata(
    project: string,
    session: string,
    id: string,
    updates: { folder?: string | null; locked?: boolean }
  ): Promise<void> {
    await this.request<UpdateResponse>(
      'POST',
      `/api/metadata/item/${id}`,
      {
        query: { project, session },
        body: updates,
      }
    );
  }

  /**
   * Manage folders (create, rename, delete)
   */
  async manageFolders(
    project: string,
    session: string,
    action: 'create' | 'rename' | 'delete',
    name: string,
    newName?: string
  ): Promise<{ success: boolean; folders: string[] }> {
    return this.request<{ success: boolean; folders: string[] }>(
      'POST',
      '/api/metadata/folders',
      {
        query: { project, session },
        body: { action, name, ...(newName && { newName }) },
      }
    );
  }
}

/**
 * Create a singleton instance of the API client
 */
export const apiClient = new APIClient();
