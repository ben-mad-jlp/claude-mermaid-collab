import { readdir, readFile, writeFile, unlink, stat, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import type { Spreadsheet, SpreadsheetMeta, SpreadsheetListItem } from '../types';
import { config } from '../config';

export class SpreadsheetManager {
  private index: Map<string, SpreadsheetMeta> = new Map();
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || '';
  }

  async initialize(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });

    const files = await readdir(this.basePath);

    for (const file of files) {
      if (!file.endsWith('.spreadsheet.json')) continue;

      const id = basename(file, '.spreadsheet.json');
      const path = join(this.basePath, file);
      const stats = await stat(path);

      this.index.set(id, {
        name: id,
        path,
        lastModified: stats.mtimeMs,
      });
    }
  }

  async listSpreadsheets(): Promise<SpreadsheetListItem[]> {
    const spreadsheets: SpreadsheetListItem[] = [];

    for (const [id, meta] of this.index.entries()) {
      spreadsheets.push({
        id,
        name: meta.name,
        lastModified: meta.lastModified,
      });
    }

    return spreadsheets;
  }

  async getSpreadsheet(id: string): Promise<Spreadsheet | null> {
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

  async saveSpreadsheet(id: string, content: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Spreadsheet ${id} not found`);

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Spreadsheet too large');
    }

    // Validate JSON
    try {
      JSON.parse(content);
    } catch {
      throw new Error('Spreadsheet content must be valid JSON');
    }

    await writeFile(meta.path, content, 'utf-8');
    const stats = await stat(meta.path);
    meta.lastModified = stats.mtimeMs;
  }

  async createSpreadsheet(name: string, content: string): Promise<string> {
    const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '-');
    const filename = `${sanitized}.spreadsheet.json`;
    const id = sanitized;
    const path = join(this.basePath, filename);

    if (this.index.has(id)) {
      throw new Error(`Spreadsheet ${id} already exists`);
    }

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Spreadsheet too large');
    }

    // Validate JSON
    try {
      JSON.parse(content);
    } catch {
      throw new Error('Spreadsheet content must be valid JSON');
    }

    await writeFile(path, content, 'utf-8');
    const stats = await stat(path);

    this.index.set(id, {
      name: id,
      path,
      lastModified: stats.mtimeMs,
    });

    return id;
  }

  async deleteSpreadsheet(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Spreadsheet ${id} not found`);

    await unlink(meta.path);
    this.index.delete(id);
  }

  updateIndex(id: string, path: string): void {
    stat(path).then(stats => {
      this.index.set(id, {
        name: id,
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

  reset(): void {
    this.index.clear();
  }
}
