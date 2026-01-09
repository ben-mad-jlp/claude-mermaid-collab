import { readdir, readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { Diagram, DiagramMeta } from '../types';
import { config } from '../config';

export class DiagramManager {
  private index: Map<string, DiagramMeta> = new Map();

  async initialize(): Promise<void> {
    // Scan diagrams folder and build index
    const files = await readdir(config.DIAGRAMS_FOLDER);

    for (const file of files) {
      if (!file.endsWith('.mmd')) continue;

      const id = basename(file, '.mmd');
      const path = join(config.DIAGRAMS_FOLDER, file);
      const stats = await stat(path);

      this.index.set(id, {
        name: file,
        path,
        lastModified: stats.mtimeMs,
      });
    }
  }

  async listDiagrams(): Promise<Diagram[]> {
    const diagrams: Diagram[] = [];

    for (const [id, meta] of this.index.entries()) {
      const content = await readFile(meta.path, 'utf-8');
      diagrams.push({
        id,
        name: meta.name,
        content,
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
    const path = join(config.DIAGRAMS_FOLDER, filename);

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
}
