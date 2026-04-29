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

  async getDocument(id: string): Promise<CollabDocument> {
    return this.request<CollabDocument>(`/api/documents/${encodeURIComponent(id)}`);
  }

  async getDiagram(id: string): Promise<CollabDiagram> {
    return this.request<CollabDiagram>(`/api/diagrams/${encodeURIComponent(id)}`);
  }

  async getSnippet(id: string): Promise<CollabSnippet> {
    return this.request<CollabSnippet>(`/api/snippets/${encodeURIComponent(id)}`);
  }

  async updateDocument(id: string, content: string): Promise<void> {
    await this.request<void>(`/api/documents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async updateSnippet(id: string, content: string): Promise<void> {
    await this.request<void>(`/api/snippets/${encodeURIComponent(id)}`, {
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
