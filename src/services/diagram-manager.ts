import { readdir, readFile, writeFile, unlink, stat, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import type { Diagram, DiagramMeta, DiagramListItem } from '../types';
import { config } from '../config';

export class DiagramManager {
  private index: Map<string, DiagramMeta> = new Map();
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || this.basePath;
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    await mkdir(this.basePath, { recursive: true });

    // Scan diagrams folder and build index
    const files = await readdir(this.basePath);

    for (const file of files) {
      if (!file.endsWith('.mmd')) continue;

      const id = basename(file, '.mmd');
      const path = join(this.basePath, file);
      const stats = await stat(path);

      this.index.set(id, {
        name: file,
        path,
        lastModified: stats.mtimeMs,
      });
    }
  }

  async listDiagrams(): Promise<DiagramListItem[]> {
    const diagrams: DiagramListItem[] = [];

    for (const [id, meta] of this.index.entries()) {
      diagrams.push({
        id,
        name: meta.name,
        lastModified: meta.lastModified,
      });
    }

    return diagrams;
  }

  async getDiagram(id: string): Promise<Diagram | null> {
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

  async saveDiagram(id: string, content: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Diagram ${id} not found`);

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Diagram too large');
    }

    await writeFile(meta.path, content, 'utf-8');
    const stats = await stat(meta.path);
    meta.lastModified = stats.mtimeMs;
  }

  async createDiagram(name: string, content: string): Promise<string> {
    // Sanitize filename
    const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '-');
    const filename = `${sanitized}.mmd`;
    const id = sanitized;
    const path = join(this.basePath, filename);

    if (this.index.has(id)) {
      throw new Error(`Diagram ${id} already exists`);
    }

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Diagram too large');
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

  async deleteDiagram(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Diagram ${id} not found`);

    await unlink(meta.path);
    this.index.delete(id);
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
      // Optionally: this.index.delete(id);
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
