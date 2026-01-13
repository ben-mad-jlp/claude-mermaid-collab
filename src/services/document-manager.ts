import { readdir, readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { Document, DocumentMeta } from '../types';
import { config } from '../config';

export class DocumentManager {
  private index: Map<string, DocumentMeta> = new Map();

  async initialize(): Promise<void> {
    const files = await readdir(config.DOCUMENTS_FOLDER);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const id = basename(file, '.md');
      const path = join(config.DOCUMENTS_FOLDER, file);
      const stats = await stat(path);

      this.index.set(id, {
        name: file,
        path,
        lastModified: stats.mtimeMs,
      });
    }
  }

  async listDocuments(): Promise<Document[]> {
    const documents: Document[] = [];

    for (const [id, meta] of this.index.entries()) {
      const content = await readFile(meta.path, 'utf-8');
      documents.push({
        id,
        name: meta.name,
        content,
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
    const path = join(config.DOCUMENTS_FOLDER, filename);

    if (this.index.has(id)) {
      throw new Error(`Document ${id} already exists`);
    }

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Document too large');
    }

    await writeFile(path, content, 'utf-8');
    const stats = await stat(path);

    this.index.set(id, {
      name: filename,
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
    const filename = basename(path);
    stat(path).then(stats => {
      this.index.set(id, {
        name: filename,
        path,
        lastModified: stats.mtimeMs,
      });
    }).catch(error => {
      console.error(`Failed to update index for ${id}:`, error);
    });
  }

  removeFromIndex(id: string): void {
    this.index.delete(id);
  }
}
