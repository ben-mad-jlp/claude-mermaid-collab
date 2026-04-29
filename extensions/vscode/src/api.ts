export type ArtifactType = 'documents' | 'diagrams' | 'snippets' | 'designs' | 'images';

export interface ArtifactMeta {
  id: string;
  name: string;
  lastModified: string;
  deprecated: boolean;
  pinned: boolean;
}

export interface CollabDocument extends ArtifactMeta {
  content: string;
}

export interface CollabDiagram extends ArtifactMeta {
  content: string;
}

export interface CollabSnippet extends ArtifactMeta {
  content: string;
}

export interface CollabDesign extends ArtifactMeta {}

export interface CollabImage extends ArtifactMeta {
  url: string;
}

export class CollabApi {
  private apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }
    return response.json() as Promise<T>;
  }

  async listArtifacts(project: string, session: string, type: ArtifactType): Promise<ArtifactMeta[]> {
    const params = new URLSearchParams({ project, session });
    return this.request<ArtifactMeta[]>(`/api/${type}?${params}`);
  }

  async getDocument(id: string, project: string, session: string): Promise<CollabDocument> {
    return this.request<CollabDocument>(`/api/document/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`);
  }

  async getDiagram(id: string, project: string, session: string): Promise<CollabDiagram> {
    return this.request<CollabDiagram>(`/api/diagram/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`);
  }

  async getSnippet(id: string, project: string, session: string): Promise<CollabSnippet> {
    return this.request<CollabSnippet>(`/api/snippet/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`);
  }

  async updateDocument(id: string, content: string, project: string, session: string): Promise<void> {
    await this.request<void>(`/api/document/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async updateSnippet(id: string, content: string, project: string, session: string): Promise<void> {
    await this.request<void>(`/api/snippet/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async createDocument(project: string, session: string, name: string): Promise<{ id: string }> {
    return this.request<{ id: string }>('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session, name, content: '' }),
    });
  }

  async createDiagram(project: string, session: string, name: string): Promise<{ id: string }> {
    return this.request<{ id: string }>('/api/diagrams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session, name, content: '' }),
    });
  }

  async createSnippet(project: string, session: string, name: string): Promise<{ id: string }> {
    return this.request<{ id: string }>('/api/snippets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session, name, content: '' }),
    });
  }

  async deprecateArtifact(id: string, type: ArtifactType, deprecated: boolean): Promise<void> {
    await this.request<void>(`/api/${type}/${encodeURIComponent(id)}/deprecate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deprecated }),
    });
  }
}
