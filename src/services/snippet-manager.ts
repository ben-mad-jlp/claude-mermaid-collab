import { readdir, readFile, writeFile, unlink, stat, mkdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import type { Snippet, SnippetMeta, SnippetListItem } from '../types';
import { config } from '../config';
import * as fs from 'fs';

/**
 * Version history entry for a snippet
 */
export interface SnippetVersionEntry {
  timestamp: number;
  content: string;
  hash?: string; // Optional hash for change detection
}

/**
 * SnippetManager handles CRUD operations and version history tracking for code snippets.
 *
 * Storage structure:
 * .collab/sessions/{name}/snippets/
 *   ├── {id}.snippet (current content)
 *   └── .history/
 *       └── {id}.history (version history JSON)
 */
export class SnippetManager {
  private index: Map<string, SnippetMeta> = new Map();
  private basePath: string;
  private historyPath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.historyPath = join(basePath, '.history');
  }

  /**
   * Initialize the manager by scanning the snippets directory
   * and building the in-memory index. Creates necessary directories.
   */
  async initialize(): Promise<void> {
    // Create main and history directories
    await mkdir(this.basePath, { recursive: true });
    await mkdir(this.historyPath, { recursive: true });

    // Scan for snippet files
    const files = await readdir(this.basePath);

    for (const file of files) {
      // Skip directories and non-snippet files
      if (file.startsWith('.') || !file.endsWith('.snippet')) continue;

      const id = basename(file, '.snippet');
      const path = join(this.basePath, file);

      try {
        const stats = await stat(path);
        this.index.set(id, {
          name: id,
          path,
          lastModified: stats.mtimeMs,
        });
      } catch (error) {
        console.error(`Failed to index snippet ${id}:`, error);
      }
    }
  }

  /**
   * List all snippets in the session
   */
  async listSnippets(): Promise<SnippetListItem[]> {
    const snippets: SnippetListItem[] = [];

    for (const [id, meta] of this.index.entries()) {
      snippets.push({
        id,
        name: meta.name,
        lastModified: meta.lastModified,
      });
    }

    return snippets.sort((a, b) => b.lastModified - a.lastModified);
  }

  /**
   * Retrieve a specific snippet by ID
   */
  async getSnippet(id: string): Promise<Snippet | null> {
    const meta = this.index.get(id);
    if (!meta) return null;

    try {
      const content = await readFile(meta.path, 'utf-8');
      return {
        id,
        name: meta.name,
        content,
        lastModified: meta.lastModified,
      };
    } catch (error) {
      console.error(`Failed to read snippet ${id}:`, error);
      return null;
    }
  }

  /**
   * Update an existing snippet's content
   * Validates size and updates metadata and version history
   */
  async saveSnippet(id: string, content: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Snippet ${id} not found`);

    // Validate content size
    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error(`Snippet too large (max ${config.MAX_FILE_SIZE} bytes)`);
    }

    // Write the updated content
    await writeFile(meta.path, content, 'utf-8');

    // Update metadata
    const stats = await stat(meta.path);
    meta.lastModified = stats.mtimeMs;

    // Record version history
    try {
      await this.recordVersion(id, content);
    } catch (error) {
      console.warn(`Failed to record version history for snippet ${id}:`, error);
      // Don't fail the save operation if history recording fails
    }
  }

  /**
   * Create a new snippet with initial content
   * Returns the generated snippet ID
   */
  async createSnippet(name: string, content: string): Promise<string> {
    // Validate inputs
    if (!name || typeof name !== 'string') {
      throw new Error('Snippet name must be a non-empty string');
    }

    if (content === undefined || content === null) {
      throw new Error('Snippet content is required');
    }

    // Validate content size
    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error(`Snippet too large (max ${config.MAX_FILE_SIZE} bytes)`);
    }

    // Generate ID from name
    const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/^-+|-+$/g, '');
    if (!sanitized) {
      throw new Error('Snippet name must contain at least one alphanumeric character');
    }

    const id = sanitized;
    const path = join(this.basePath, `${id}.snippet`);

    // Check for duplicate
    if (this.index.has(id)) {
      throw new Error(`Snippet "${id}" already exists`);
    }

    // Write initial content
    await writeFile(path, content, 'utf-8');
    const stats = await stat(path);

    // Register in index
    this.index.set(id, {
      name: id,
      path,
      lastModified: stats.mtimeMs,
    });

    // Record initial version in history
    try {
      await this.recordVersion(id, content);
    } catch (error) {
      console.warn(`Failed to record initial version for snippet ${id}:`, error);
      // Don't fail creation if history recording fails
    }

    return id;
  }

  /**
   * Delete a snippet and its history
   */
  async deleteSnippet(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Snippet ${id} not found`);

    // Delete the snippet file
    try {
      await unlink(meta.path);
    } catch (error) {
      console.error(`Failed to delete snippet file ${id}:`, error);
      throw new Error(`Failed to delete snippet: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Delete history file
    const historyFile = join(this.historyPath, `${id}.history`);
    try {
      if (fs.existsSync(historyFile)) {
        await unlink(historyFile);
      }
    } catch (error) {
      console.warn(`Failed to delete history for snippet ${id}:`, error);
      // Don't fail the deletion if history cleanup fails
    }

    // Remove from index
    this.index.delete(id);
  }

  /**
   * Record a version entry in the history file
   * Maintains version history with timestamps
   */
  private async recordVersion(id: string, content: string): Promise<void> {
    const historyFile = join(this.historyPath, `${id}.history`);

    // Load existing history or create new
    let history: SnippetVersionEntry[] = [];
    try {
      if (fs.existsSync(historyFile)) {
        const historyContent = await readFile(historyFile, 'utf-8');
        history = JSON.parse(historyContent) as SnippetVersionEntry[];
      }
    } catch (error) {
      console.warn(`Failed to load history for snippet ${id}, starting fresh:`, error);
      history = [];
    }

    // Add new version entry
    const entry: SnippetVersionEntry = {
      timestamp: Date.now(),
      content,
    };

    history.push(entry);

    // Keep history under a reasonable size (keep last 100 versions)
    const MAX_HISTORY_ENTRIES = 100;
    if (history.length > MAX_HISTORY_ENTRIES) {
      history = history.slice(-MAX_HISTORY_ENTRIES);
    }

    // Write updated history
    await writeFile(historyFile, JSON.stringify(history, null, 2), 'utf-8');
  }

  /**
   * Get the version history for a snippet
   */
  async getHistory(id: string): Promise<SnippetVersionEntry[]> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Snippet ${id} not found`);

    const historyFile = join(this.historyPath, `${id}.history`);

    try {
      if (!fs.existsSync(historyFile)) {
        return [];
      }

      const historyContent = await readFile(historyFile, 'utf-8');
      return JSON.parse(historyContent) as SnippetVersionEntry[];
    } catch (error) {
      console.error(`Failed to read history for snippet ${id}:`, error);
      throw new Error(`Failed to retrieve version history: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific version of a snippet by timestamp
   */
  async getVersionAtTimestamp(id: string, timestamp: number): Promise<string | null> {
    const history = await this.getHistory(id);

    // Find the version at or before the timestamp
    let targetVersion: SnippetVersionEntry | null = null;
    for (const entry of history) {
      if (entry.timestamp <= timestamp) {
        targetVersion = entry;
      } else {
        break;
      }
    }

    return targetVersion?.content ?? null;
  }

  /**
   * Update the index entry for a snippet (used by file watchers)
   * Asynchronously loads and caches the metadata
   */
  updateIndex(id: string, path: string): void {
    stat(path)
      .then(stats => {
        this.index.set(id, {
          name: id,
          path,
          lastModified: stats.mtimeMs,
        });
      })
      .catch(error => {
        console.error(`Failed to update index for snippet ${id}:`, error);
      });
  }

  /**
   * Remove a snippet from the index (without deleting the file)
   */
  removeFromIndex(id: string): void {
    this.index.delete(id);
  }

  /**
   * Clear the entire index (used when switching storage locations)
   * Call initialize() after to rebuild with new storage location.
   */
  reset(): void {
    this.index.clear();
  }

  /**
   * Get the current index size (number of indexed snippets)
   */
  getIndexSize(): number {
    return this.index.size;
  }

  /**
   * Check if a snippet exists
   */
  hasSnippet(id: string): boolean {
    return this.index.has(id);
  }
}
