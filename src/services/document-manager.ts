import { readdir, readFile, writeFile, unlink, stat, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import type { Document, DocumentMeta, DocumentListItem } from '../types';
import { config } from '../config';

export class DocumentManager {
  private index: Map<string, DocumentMeta> = new Map();
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || '';
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    await mkdir(this.basePath, { recursive: true });

    const files = await readdir(this.basePath);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const id = basename(file, '.md');
      const path = join(this.basePath, file);
      const stats = await stat(path);

      // Try to restore original name from sidecar metadata file
      let name = id;
      try {
        const metaPath = join(this.basePath, `.${id}.meta.json`);
        const metaContent = await readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent) as { name?: string };
        if (meta.name) name = meta.name;
      } catch {
        // No sidecar or unreadable — use id as fallback (backward compatibility)
      }

      this.index.set(id, {
        name,
        path,
        lastModified: stats.mtimeMs,
      });
    }
  }

  async listDocuments(): Promise<DocumentListItem[]> {
    const documents: DocumentListItem[] = [];

    for (const [id, meta] of this.index.entries()) {
      documents.push({
        id,
        name: meta.name,
        lastModified: meta.lastModified,
      });
    }

    return documents;
  }

  async getDocument(id: string): Promise<Document | null> {
    const meta = this.index.get(id);
    if (!meta) return null;

    const content = await readFile(meta.path, 'utf-8');
    return {
      id,
      name: meta.name,
      content,
      lastModified: meta.lastModified,
    };
  }

  async saveDocument(id: string, content: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Document ${id} not found`);

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Document too large');
    }

    await writeFile(meta.path, content, 'utf-8');
    const stats = await stat(meta.path);
    meta.lastModified = stats.mtimeMs;
  }

  async createDocument(name: string, content: string): Promise<string> {
    const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '-');
    const filename = `${sanitized}.md`;
    const id = sanitized;
    const path = join(this.basePath, filename);

    if (this.index.has(id)) {
      throw new Error(`Document ${id} already exists`);
    }

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Document too large');
    }

    await writeFile(path, content, 'utf-8');
    const stats = await stat(path);

    // Write sidecar metadata so initialize() can restore the original name
    try {
      const metaPath = join(this.basePath, `.${id}.meta.json`);
      await writeFile(metaPath, JSON.stringify({ name }), 'utf-8');
    } catch (error) {
      console.warn(`Failed to write metadata sidecar for document ${id}:`, error);
    }

    this.index.set(id, {
      name: name,
      path,
      lastModified: stats.mtimeMs,
    });

    return id;
  }

  async deleteDocument(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Document ${id} not found`);

    await unlink(meta.path);
    this.index.delete(id);
  }

  async getCleanContent(id: string): Promise<string | null> {
    const doc = await this.getDocument(id);
    if (!doc) return null;

    // Strip all comment and status markers (including inline approvals/rejections)
    return doc.content
      .replace(/<!--\s*status:\s*approved\s*-->\n?/g, '')
      .replace(/<!--\s*status:\s*rejected(?::[^>]*)?\s*-->\n?/g, '')
      .replace(/<!--\s*comment:\s*[^>]*-->\n?/g, '')
      .replace(/<!--\s*comment-start:\s*[^>]*-->/g, '')
      .replace(/<!--\s*comment-end\s*-->/g, '')
      .replace(/<!--\s*reject-start:\s*[^>]*-->/g, '')
      .replace(/<!--\s*reject-end\s*-->/g, '')
      .replace(/<!--\s*approve-start\s*-->/g, '')
      .replace(/<!--\s*approve-end\s*-->/g, '');
  }

  updateIndex(id: string, path: string): void {
    // Preserve the existing name if we already have this entry indexed;
    // otherwise try to read the sidecar metadata, falling back to id.
    const existingName = this.index.get(id)?.name;
    const resolveName = existingName
      ? Promise.resolve(existingName)
      : readFile(join(this.basePath, `.${id}.meta.json`), 'utf-8')
          .then((raw) => {
            const meta = JSON.parse(raw) as { name?: string };
            return meta.name ?? id;
          })
          .catch(() => id);

    Promise.all([stat(path), resolveName])
      .then(([stats, name]) => {
        this.index.set(id, {
          name,
          path,
          lastModified: stats.mtimeMs,
        });
      })
      .catch(error => {
        console.error(`Failed to update index for ${id}:`, error);
      });
  }

  removeFromIndex(id: string): void {
    this.index.delete(id);
  }

  /**
   * Clear the index. Call initialize() after to rebuild with new storage location.
   */
  reset(): void {
    this.index.clear();
  }
}
