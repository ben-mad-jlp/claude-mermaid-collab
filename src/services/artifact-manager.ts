import { readdir, readFile, writeFile, unlink, stat, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { config } from '../config';
import * as fs from 'fs';

/**
 * Version history entry for an artifact
 */
export interface ArtifactVersionEntry {
  timestamp: number;
  content: string;
  hash?: string; // Optional hash for change detection
}

/**
 * Minimum shape a record type must satisfy
 */
export interface ArtifactRecord {
  id: string;
  name: string;
  lastModified: number;
}

/**
 * Internal index metadata (not exposed as T)
 */
export interface ArtifactMeta {
  name: string;
  path: string;
  lastModified: number;
}

/**
 * Generic base class for CRUD + version-history artifact managers.
 *
 * Storage structure:
 *   {basePath}/
 *     ├── {id}.{fileExtension}   (current content)
 *     └── .history/
 *         └── {id}.history       (version history JSON)
 *
 * Subclasses implement `buildRecord` to construct the concrete record type T.
 */
export abstract class ArtifactManager<T extends ArtifactRecord> {
  protected index: Map<string, ArtifactMeta> = new Map();
  protected basePath: string;
  protected historyPath: string;
  protected fileExtension: string;

  constructor(basePath: string, fileExtension: string) {
    this.basePath = basePath;
    this.fileExtension = fileExtension;
    this.historyPath = join(basePath, '.history');
  }

  /**
   * Initialize the manager by scanning the artifacts directory
   * and building the in-memory index. Creates necessary directories.
   */
  async initialize(): Promise<void> {
    // Create main and history directories
    await mkdir(this.basePath, { recursive: true });
    await mkdir(this.historyPath, { recursive: true });

    // Scan for artifact files
    const files = await readdir(this.basePath);
    const suffix = `.${this.fileExtension}`;

    for (const file of files) {
      // Skip directories and non-artifact files
      if (file.startsWith('.') || !file.endsWith(suffix)) continue;

      const id = basename(file, suffix);
      const path = join(this.basePath, file);

      try {
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
      } catch (error) {
        console.error(`Failed to index artifact ${id}:`, error);
      }
    }
  }

  /**
   * Subclass hook — construct the concrete record type from raw data.
   */
  abstract buildRecord(id: string, content: string, lastModified: number): T;

  /**
   * Retrieve a specific artifact by ID
   */
  async get(id: string): Promise<T | null> {
    const meta = this.index.get(id);
    if (!meta) return null;

    try {
      const content = await readFile(meta.path, 'utf-8');
      return this.buildRecord(id, content, meta.lastModified);
    } catch (error) {
      console.error(`Failed to read artifact ${id}:`, error);
      return null;
    }
  }

  /**
   * List all artifacts
   */
  async list(): Promise<T[]> {
    const records: T[] = [];

    for (const [id, meta] of this.index.entries()) {
      try {
        const content = await readFile(meta.path, 'utf-8');
        records.push(this.buildRecord(id, content, meta.lastModified));
      } catch {
        records.push(this.buildRecord(id, '', meta.lastModified));
      }
    }

    return records.sort((a, b) => b.lastModified - a.lastModified);
  }

  /**
   * Update an existing artifact's content.
   * Validates size, writes file, updates index, records history.
   */
  async save(id: string, content: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Artifact ${id} not found`);

    // Validate content size
    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error(`Artifact too large (max ${config.MAX_FILE_SIZE} bytes)`);
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
      console.warn(`Failed to record version history for artifact ${id}:`, error);
      // Don't fail the save operation if history recording fails
    }
  }

  /**
   * Create a new artifact with initial content.
   * Sanitizes name to id, checks for duplicates, writes, returns id.
   */
  async create(name: string, content: string): Promise<string> {
    // Validate inputs
    if (!name || typeof name !== 'string') {
      throw new Error('Artifact name must be a non-empty string');
    }

    if (content === undefined || content === null) {
      throw new Error('Artifact content is required');
    }

    // Validate content size
    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error(`Artifact too large (max ${config.MAX_FILE_SIZE} bytes)`);
    }

    // Generate ID from name
    const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/^-+|-+$/g, '');
    if (!sanitized) {
      throw new Error('Artifact name must contain at least one alphanumeric character');
    }

    const id = sanitized;
    const path = join(this.basePath, `${id}.${this.fileExtension}`);

    // Check for duplicate
    if (this.index.has(id)) {
      throw new Error(`Artifact "${id}" already exists`);
    }

    // Write initial content
    await writeFile(path, content, 'utf-8');
    const stats = await stat(path);

    // Write sidecar metadata so initialize() can restore the original name
    try {
      const metaPath = join(this.basePath, `.${id}.meta.json`);
      await writeFile(metaPath, JSON.stringify({ name }), 'utf-8');
    } catch (error) {
      console.warn(`Failed to write metadata sidecar for artifact ${id}:`, error);
    }

    // Register in index
    this.index.set(id, {
      name: name,
      path,
      lastModified: stats.mtimeMs,
    });

    // Record initial version in history
    try {
      await this.recordVersion(id, content);
    } catch (error) {
      console.warn(`Failed to record initial version for artifact ${id}:`, error);
      // Don't fail creation if history recording fails
    }

    return id;
  }

  /**
   * Delete an artifact and its history
   */
  async delete(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Artifact ${id} not found`);

    // Delete the artifact file
    try {
      await unlink(meta.path);
    } catch (error) {
      console.error(`Failed to delete artifact file ${id}:`, error);
      throw new Error(`Failed to delete artifact: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Delete history file
    const historyFile = join(this.historyPath, `${id}.history`);
    try {
      if (fs.existsSync(historyFile)) {
        await unlink(historyFile);
      }
    } catch (error) {
      console.warn(`Failed to delete history for artifact ${id}:`, error);
      // Don't fail the deletion if history cleanup fails
    }

    // Remove from index
    this.index.delete(id);
  }

  /**
   * Get the version history for an artifact
   */
  async getHistory(id: string): Promise<ArtifactVersionEntry[]> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Artifact ${id} not found`);

    const historyFile = join(this.historyPath, `${id}.history`);

    try {
      if (!fs.existsSync(historyFile)) {
        return [];
      }

      const historyContent = await readFile(historyFile, 'utf-8');
      return JSON.parse(historyContent) as ArtifactVersionEntry[];
    } catch (error) {
      console.error(`Failed to read history for artifact ${id}:`, error);
      throw new Error(`Failed to retrieve version history: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific version of an artifact by timestamp
   */
  async getVersionAtTimestamp(id: string, timestamp: number): Promise<string | null> {
    const history = await this.getHistory(id);

    // Sort ascending by timestamp to ensure correct traversal regardless of
    // storage order, then find the latest entry at or before the given timestamp.
    const sorted = history.slice().sort((a, b) => a.timestamp - b.timestamp);

    let targetVersion: ArtifactVersionEntry | null = null;
    for (const entry of sorted) {
      if (entry.timestamp <= timestamp) {
        targetVersion = entry;
      } else {
        break;
      }
    }

    return targetVersion?.content ?? null;
  }

  /**
   * Record a version entry in the history file.
   * Maintains version history with timestamps; keeps last 100 versions.
   */
  private async recordVersion(id: string, content: string): Promise<void> {
    const historyFile = join(this.historyPath, `${id}.history`);

    // Load existing history or create new
    let history: ArtifactVersionEntry[] = [];
    try {
      if (fs.existsSync(historyFile)) {
        const historyContent = await readFile(historyFile, 'utf-8');
        history = JSON.parse(historyContent) as ArtifactVersionEntry[];
      }
    } catch (error) {
      console.warn(`Failed to load history for artifact ${id}, starting fresh:`, error);
      history = [];
    }

    // Add new version entry
    const entry: ArtifactVersionEntry = {
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
   * Update the index entry for an artifact (used by file watchers).
   * Asynchronously loads and caches the metadata.
   */
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
        console.error(`Failed to update index for artifact ${id}:`, error);
      });
  }

  /**
   * Remove an artifact from the index (without deleting the file)
   */
  removeFromIndex(id: string): void {
    this.index.delete(id);
  }

  /**
   * Clear the entire index (used when switching storage locations).
   * Call initialize() after to rebuild with new storage location.
   */
  reset(): void {
    this.index.clear();
  }

  /**
   * Get the current index size (number of indexed artifacts)
   */
  getIndexSize(): number {
    return this.index.size;
  }

  /**
   * Check if an artifact exists
   */
  has(id: string): boolean {
    return this.index.has(id);
  }
}
