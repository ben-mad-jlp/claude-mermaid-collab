import * as vscode from 'vscode';
import {
  CollabApi,
  ArtifactType,
  ArtifactMeta,
  CollabDocument,
  CollabDiagram,
  CollabSnippet,
  CollabDesign,
  CollabImage,
} from './api';

export class SessionStore {
  private documents = new Map<string, CollabDocument>();
  private diagrams = new Map<string, CollabDiagram>();
  private snippets = new Map<string, CollabSnippet>();
  private designs = new Map<string, CollabDesign>();
  private images = new Map<string, CollabImage>();

  private _onDidChange = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private api: CollabApi,
    public readonly project: string,
    public readonly session: string
  ) {}

  async fetchAll(): Promise<void> {
    this.documents.clear();
    this.diagrams.clear();
    this.snippets.clear();
    this.designs.clear();
    this.images.clear();

    const results = await Promise.allSettled([
      this.api.listArtifacts(this.project, this.session, 'documents'),
      this.api.listArtifacts(this.project, this.session, 'diagrams'),
      this.api.listArtifacts(this.project, this.session, 'snippets'),
      this.api.listArtifacts(this.project, this.session, 'designs'),
      this.api.listArtifacts(this.project, this.session, 'images'),
    ]);

    const [docsResult, diagramsResult, snippetsResult, designsResult, imagesResult] = results;

    // Documents — fetch full content per item
    if (docsResult.status === 'fulfilled') {
      const fetched = await Promise.allSettled(
        docsResult.value.map((meta) => this.api.getDocument(meta.id))
      );
      for (const r of fetched) {
        if (r.status === 'fulfilled') {
          this.documents.set(r.value.id, r.value);
        }
      }
    }

    // Diagrams — fetch full content per item
    if (diagramsResult.status === 'fulfilled') {
      const fetched = await Promise.allSettled(
        diagramsResult.value.map((meta) => this.api.getDiagram(meta.id))
      );
      for (const r of fetched) {
        if (r.status === 'fulfilled') {
          this.diagrams.set(r.value.id, r.value);
        }
      }
    }

    // Snippets — fetch full content per item
    if (snippetsResult.status === 'fulfilled') {
      const fetched = await Promise.allSettled(
        snippetsResult.value.map((meta) => this.api.getSnippet(meta.id))
      );
      for (const r of fetched) {
        if (r.status === 'fulfilled') {
          this.snippets.set(r.value.id, r.value);
        }
      }
    }

    // Designs — store as ArtifactMeta from list
    if (designsResult.status === 'fulfilled') {
      for (const meta of designsResult.value) {
        this.designs.set(meta.id, meta as CollabDesign);
      }
    }

    // Images — store as ArtifactMeta from list
    if (imagesResult.status === 'fulfilled') {
      for (const meta of imagesResult.value) {
        this.images.set(meta.id, meta as CollabImage);
      }
    }

    this._onDidChange.fire(undefined);
  }

  patch(msg: { type: string; id: string; [k: string]: unknown }): void {
    const { type, id } = msg;

    // Split on last '_' to extract action and noun
    const lastUnderscore = type.lastIndexOf('_');
    if (lastUnderscore === -1) {
      return;
    }
    const noun = type.slice(0, lastUnderscore);
    const action = type.slice(lastUnderscore + 1) as 'created' | 'updated' | 'deleted';

    if (action === 'deleted') {
      switch (noun) {
        case 'document':
          this.documents.delete(id);
          break;
        case 'diagram':
          this.diagrams.delete(id);
          break;
        case 'snippet':
          this.snippets.delete(id);
          break;
        case 'design':
          this.designs.delete(id);
          break;
        case 'image':
          this.images.delete(id);
          break;
        default:
          return;
      }
      this._onDidChange.fire(id);
      return;
    }

    if (action === 'created' || action === 'updated') {
      switch (noun) {
        case 'document':
          this.api.getDocument(id).then((doc) => {
            this.documents.set(id, doc);
            this._onDidChange.fire(id);
          }).catch(() => { /* ignore per-item errors */ });
          break;
        case 'diagram':
          this.api.getDiagram(id).then((diagram) => {
            this.diagrams.set(id, diagram);
            this._onDidChange.fire(id);
          }).catch(() => { /* ignore per-item errors */ });
          break;
        case 'snippet':
          this.api.getSnippet(id).then((snippet) => {
            this.snippets.set(id, snippet);
            this._onDidChange.fire(id);
          }).catch(() => { /* ignore per-item errors */ });
          break;
        case 'design': {
          const meta = msg as unknown as CollabDesign;
          this.designs.set(id, meta);
          this._onDidChange.fire(id);
          break;
        }
        case 'image': {
          const meta = msg as unknown as CollabImage;
          this.images.set(id, meta);
          this._onDidChange.fire(id);
          break;
        }
        default:
          return;
      }
    }
  }

  getSnippet(id: string): CollabSnippet | undefined { return this.snippets.get(id); }
  getDiagram(id: string): CollabDiagram | undefined { return this.diagrams.get(id); }
  getDocument(id: string): CollabDocument | undefined { return this.documents.get(id); }
  getDesign(id: string): CollabDesign | undefined { return this.designs.get(id); }

  getItemsForSection(type: ArtifactType): ArtifactMeta[] {
    let map: Map<string, ArtifactMeta>;
    switch (type) {
      case 'documents':
        map = this.documents as Map<string, ArtifactMeta>;
        break;
      case 'diagrams':
        map = this.diagrams as Map<string, ArtifactMeta>;
        break;
      case 'snippets':
        map = this.snippets as Map<string, ArtifactMeta>;
        break;
      case 'designs':
        map = this.designs as Map<string, ArtifactMeta>;
        break;
      case 'images':
        map = this.images as Map<string, ArtifactMeta>;
        break;
    }

    const items = Array.from(map.values());

    // Sort into three groups:
    // 0: non-deprecated + pinned
    // 1: non-deprecated + unpinned
    // 2: deprecated
    // Within each group: sort by lastModified descending
    const groupOf = (item: ArtifactMeta): number => {
      if (item.deprecated) return 2;
      if (item.pinned) return 0;
      return 1;
    };

    items.sort((a, b) => {
      const ga = groupOf(a);
      const gb = groupOf(b);
      if (ga !== gb) return ga - gb;
      // Within group: descending by lastModified
      return b.lastModified.localeCompare(a.lastModified);
    });

    return items;
  }
}
