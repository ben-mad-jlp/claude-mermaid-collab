import { mkdir, readFile, writeFile, rename, unlink, open } from 'fs/promises';
import * as fs from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';

export interface Session {
  project: string;
  session: string;
  lastAccess: string;
}

export interface SessionRegistryData {
  sessions: Session[];
}

const DATA_DIR = join(homedir(), '.mermaid-collab');
const REGISTRY_PATH = join(DATA_DIR, 'sessions.json');

/**
 * Thrown when sessions.json exists but is unreadable/corrupt and the
 * sessions.json.bak rolling backup cannot be used to recover. The caller
 * (MCP/HTTP handler) should log this loudly and surface it to the
 * operator — manual recovery from the .bak path in the message is the
 * intended recourse. We explicitly do NOT silently return an empty
 * registry, because doing so would cause the very data-loss bug this
 * class is protecting against.
 */
export class SessionRegistryCorruptError extends Error {
  public readonly registryPath: string;
  public readonly backupPath: string;

  constructor(registryPath: string, backupPath: string, cause?: unknown) {
    super(
      `sessions.json is corrupt and could not be recovered from backup. ` +
      `Inspect and manually restore from ${backupPath} if present. ` +
      `Original path: ${registryPath}. Cause: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = 'SessionRegistryCorruptError';
    this.registryPath = registryPath;
    this.backupPath = backupPath;
  }
}

/**
 * Simple promise-chain mutex for in-process serialization of
 * read-modify-write sequences. Note: this does NOT guard against
 * cross-process races (e.g. two servers writing the same registry
 * file concurrently). That is out of scope for this class and would
 * require file locking.
 */
class Mutex {
  private chain: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let resolveNext!: () => void;
    this.chain = new Promise(r => {
      resolveNext = r;
    });
    try {
      await prev;
      return await fn();
    } finally {
      resolveNext();
    }
  }
}

export class SessionRegistry {
  private registryPath: string;
  // Serializes all load→mutate→save sequences within a single process.
  // Cross-process concurrency is NOT covered by this mutex.
  private writeMutex = new Mutex();

  constructor(registryPath: string = REGISTRY_PATH) {
    this.registryPath = registryPath;
  }

  private get backupPath(): string {
    return `${this.registryPath}.bak`;
  }

  private get tmpPath(): string {
    return `${this.registryPath}.tmp`;
  }

  private async createFileIfNotExists(filePath: string, content: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }
  }

  private parseRegistryContent(content: string): SessionRegistryData {
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)) {
      throw new Error('Invalid sessions.json shape: missing sessions array');
    }
    return data as SessionRegistryData;
  }

  /**
   * Load the session registry from disk.
   *
   * Semantics:
   * - If sessions.json does not exist → returns empty registry (fresh install).
   * - If sessions.json exists but is unreadable/unparseable → attempts to
   *   recover from sessions.json.bak. If .bak loads successfully, returns it.
   * - If neither the primary file nor the backup is usable → throws
   *   SessionRegistryCorruptError. Callers must decide whether to degrade
   *   gracefully (list) or refuse to write (register/unregister).
   */
  async load(): Promise<SessionRegistryData> {
    // Fresh install: primary missing is always legitimate.
    if (!fs.existsSync(this.registryPath)) {
      return { sessions: [] };
    }

    let primaryError: unknown;
    try {
      const content = await readFile(this.registryPath, 'utf-8');
      return this.parseRegistryContent(content);
    } catch (error: any) {
      // ENOENT race: file vanished between existsSync and readFile.
      if (error && error.code === 'ENOENT') {
        return { sessions: [] };
      }
      primaryError = error;
      console.warn(
        `Failed to load ${this.registryPath}, attempting backup recovery:`,
        error
      );
    }

    // Primary failed — try the rolling backup.
    if (fs.existsSync(this.backupPath)) {
      try {
        const backupContent = await readFile(this.backupPath, 'utf-8');
        const recovered = this.parseRegistryContent(backupContent);
        console.warn(
          `Recovered session registry from backup: ${this.backupPath}`
        );
        return recovered;
      } catch (backupError) {
        console.warn(
          `Backup at ${this.backupPath} is also unreadable:`,
          backupError
        );
      }
    }

    throw new SessionRegistryCorruptError(
      this.registryPath,
      this.backupPath,
      primaryError
    );
  }

  /**
   * Save the session registry to disk atomically.
   *
   * Sequence:
   *   1. Write new content to <path>.tmp
   *   2. fsync the tmp file (durable on disk before rename)
   *   3. If <path> exists, rename it to <path>.bak (rolling backup)
   *   4. Rename <path>.tmp → <path>
   *
   * This eliminates the mid-write-crash window where a partial
   * sessions.json could be observed. An operator can always recover
   * from <path>.bak if something has gone wrong.
   */
  async save(registry: SessionRegistryData): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true });

    const tmpPath = this.tmpPath;
    const backupPath = this.backupPath;
    const serialized = JSON.stringify(registry, null, 2);

    // 1. Write to tmp
    await writeFile(tmpPath, serialized, 'utf-8');

    // 2. fsync to make the write durable before we rename over the real file.
    // Node's fs/promises does not expose fsync directly; go through a handle.
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(tmpPath, 'r+');
      await handle.sync();
    } catch (syncError) {
      // fsync failure is not fatal on its own; log and continue — we still
      // prefer an atomic rename over leaving the tmp file lying around.
      console.warn('fsync on sessions.json.tmp failed:', syncError);
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
    }

    // 3. Rotate existing file to backup.
    if (fs.existsSync(this.registryPath)) {
      try {
        await rename(this.registryPath, backupPath);
      } catch (rotateError) {
        // If rotation fails, we still try the final rename — but clean up tmp
        // first so we don't leave stale state on disk.
        console.warn('Failed to rotate sessions.json to .bak:', rotateError);
      }
    }

    // 4. Atomic swap.
    try {
      await rename(tmpPath, this.registryPath);
    } catch (renameError) {
      // Best-effort: try to clean up the tmp file so we don't accumulate junk.
      try {
        await unlink(tmpPath);
      } catch {
        /* ignore */
      }
      throw renameError;
    }
  }

  /**
   * Register a session. Idempotent - updates lastAccess if already exists.
   * Also ensures the session directories exist.
   * Returns { created: true } if a new session was created, { created: false } if already existed.
   */
  async register(
    project: string,
    session: string,
    useRenderUI?: boolean
  ): Promise<{ created: boolean }> {
    // Validate inputs
    if (!project || !project.startsWith('/')) {
      throw new Error('Invalid project path: must be an absolute path');
    }
    if (!session || !/^[a-zA-Z0-9-]+$/.test(session)) {
      throw new Error('Invalid session name: must be alphanumeric with hyphens only');
    }

    // The entire load→mutate→save sequence runs under the mutex so that
    // concurrent register/unregister calls cannot step on each other.
    // A corrupt-load exception is intentionally rethrown — we must not
    // destructively overwrite the registry file when we can't read it.
    return this.writeMutex.run(async () => {
      const registry = await this.load();
      const now = new Date().toISOString();

      // Check if session already exists
      const existingIndex = registry.sessions.findIndex(
        s => s.project === project && s.session === session
      );

      let created = false;
      if (existingIndex >= 0) {
        // Update lastAccess
        registry.sessions[existingIndex].lastAccess = now;
      } else {
        // Add new session
        registry.sessions.push({ project, session, lastAccess: now });
        created = true;
      }

      await this.save(registry);

      // Ensure directories exist (new structure: .collab/sessions/<name>/)
      const sessionPath = join(project, '.collab', 'sessions', session);
      await mkdir(join(sessionPath, 'diagrams'), { recursive: true });
      await mkdir(join(sessionPath, 'documents'), { recursive: true });
      await mkdir(join(sessionPath, 'designs'), { recursive: true });
      await mkdir(join(sessionPath, 'spreadsheets'), { recursive: true });
      await mkdir(join(sessionPath, 'snippets'), { recursive: true });
      await mkdir(join(sessionPath, 'images'), { recursive: true });
      await mkdir(join(sessionPath, 'code-files'), { recursive: true });

      // Create session files if they don't exist
      const collabStatePath = join(sessionPath, 'collab-state.json');
      const collabStateContent = JSON.stringify({
        lastActivity: now,
        useRenderUI: useRenderUI ?? true
      }, null, 2);
      await this.createFileIfNotExists(collabStatePath, collabStateContent);

      return { created };
    });
  }

  /**
   * Register a session only if it isn't already present. Used by the
   * server startup path so we don't trigger a destructive write on
   * every boot. Gracefully swallows SessionRegistryCorruptError on the
   * pre-check path — if the registry is corrupt, we fall through to
   * register() which will surface the error to the caller.
   */
  async registerIfAbsent(
    project: string,
    session: string,
    useRenderUI?: boolean
  ): Promise<{ created: boolean; alreadyPresent: boolean }> {
    try {
      const registry = await this.load();
      const already = registry.sessions.some(
        s => s.project === project && s.session === session
      );
      if (already) {
        return { created: false, alreadyPresent: true };
      }
    } catch (error) {
      if (error instanceof SessionRegistryCorruptError) {
        // Rethrow so the caller can log loudly and decide to continue.
        throw error;
      }
      throw error;
    }

    const result = await this.register(project, session, useRenderUI);
    return { created: result.created, alreadyPresent: false };
  }

  /**
   * List all registered sessions.
   * Validates each session directory exists and auto-cleans stale entries.
   */
  async list(): Promise<Session[]> {
    // list() is a user-facing read path. If the registry is corrupt we
    // degrade gracefully rather than blowing up the UI — callers that
    // must refuse to write on corrupt state use load() directly.
    let registry: SessionRegistryData;
    try {
      registry = await this.load();
    } catch (error) {
      if (error instanceof SessionRegistryCorruptError) {
        console.error(
          'SessionRegistry.list(): registry is corrupt, returning empty list.',
          error.message
        );
        return [];
      }
      throw error;
    }

    const validSessions: Session[] = [];
    const staleSessions: Session[] = [];

    // Validate each session's existence (check both new and old locations)
    for (const session of registry.sessions) {
      try {
        // Check new location first
        const newSessionPath = join(session.project, '.collab', 'sessions', session.session);
        // Check todos directory
        const todosSessionPath = join(session.project, '.collab', 'todos', session.session);
        // Then old location for backwards compatibility
        const oldSessionPath = join(session.project, '.collab', session.session);

        if (fs.existsSync(newSessionPath) || fs.existsSync(todosSessionPath) || fs.existsSync(oldSessionPath)) {
          validSessions.push(session);
        } else {
          staleSessions.push(session);
        }
      } catch (error) {
        // If existsSync throws (permission issues), treat as invalid
        staleSessions.push(session);
      }
    }

    // Auto-clean stale sessions if any were found. This is a
    // read-modify-write sequence so it goes through the mutex, and we
    // re-load under the lock to avoid racing with other writers.
    if (staleSessions.length > 0) {
      await this.writeMutex.run(async () => {
        let freshRegistry: SessionRegistryData;
        try {
          freshRegistry = await this.load();
        } catch (error) {
          if (error instanceof SessionRegistryCorruptError) {
            console.warn(
              'Skipping stale session auto-clean because registry became corrupt mid-list'
            );
            return;
          }
          throw error;
        }

        const staleKeys = new Set(
          staleSessions.map(s => `${s.project}\u0000${s.session}`)
        );
        freshRegistry.sessions = freshRegistry.sessions.filter(
          s => !staleKeys.has(`${s.project}\u0000${s.session}`)
        );

        try {
          await this.save(freshRegistry);
          const staleNames = staleSessions
            .map(s => `${basename(s.project)}/${s.session}`)
            .join(', ');
          console.log(`Removed stale sessions from registry: ${staleNames}`);
        } catch (error) {
          console.warn(
            'Failed to save registry after cleaning stale sessions:',
            error
          );
          // Continue - don't let save failure prevent returning valid sessions
        }
      });
    }

    // Sort by lastAccess descending (most recent first)
    return validSessions.sort(
      (a, b) => new Date(b.lastAccess).getTime() - new Date(a.lastAccess).getTime()
    );
  }

  /**
   * Resolve the path for a session's artifact folder (diagrams, documents, designs, spreadsheets, or snippets).
   * Checks new location first, then old location for backwards compatibility.
   */
  resolvePath(project: string, session: string, type: 'diagrams' | 'documents' | 'designs' | 'spreadsheets' | 'snippets' | 'embeds' | 'images' | 'code-files' | '.'): string {
    if (!project || !project.startsWith('/')) {
      throw new Error('Invalid project path: must be an absolute path');
    }
    if (!session) {
      throw new Error('Invalid session name');
    }
    if (type !== 'diagrams' && type !== 'documents' && type !== 'designs' && type !== 'spreadsheets' && type !== 'snippets' && type !== 'embeds' && type !== 'images' && type !== 'code-files' && type !== '.') {
      throw new Error('Invalid type: must be "diagrams", "documents", "designs", "spreadsheets", "snippets", "embeds", "images", "code-files", or "."');
    }

    // Check regular sessions first
    const newPath = join(project, '.collab', 'sessions', session, type);
    if (fs.existsSync(newPath)) {
      return newPath;
    }

    // Check todos directory
    const todosPath = join(project, '.collab', 'todos', session, type);
    if (fs.existsSync(todosPath)) {
      return todosPath;
    }

    // Check old location for backwards compatibility
    const oldPath = join(project, '.collab', session, type);
    if (fs.existsSync(oldPath)) {
      return oldPath;
    }

    // Default to regular sessions location
    return newPath;
  }

  /**
   * Ensure snippet directories exist for a session.
   * Creates the snippets folder if it doesn't exist.
   */
  async ensureSnippetsDir(project: string, session: string): Promise<void> {
    if (!project || !project.startsWith('/')) {
      throw new Error('Invalid project path: must be an absolute path');
    }
    if (!session || !/^[a-zA-Z0-9-]+$/.test(session)) {
      throw new Error('Invalid session name: must be alphanumeric with hyphens only');
    }

    const snippetsPath = join(project, '.collab', 'sessions', session, 'snippets');
    await mkdir(snippetsPath, { recursive: true });
  }

  /**
   * Get the snippets directory path for a session.
   * Automatically resolves to the correct location (new or old structure).
   */
  getSnippetsPath(project: string, session: string): string {
    return this.resolvePath(project, session, 'snippets');
  }

  /**
   * Register a new snippet artifact in a session.
   * Creates snippet metadata and ensures directory structure exists.
   * Returns the snippet ID for reference.
   */
  async registerSnippet(
    project: string,
    session: string,
    snippetId: string,
    metadata: {
      name: string;
      type?: string;
      locked?: boolean;
      folder?: string;
    }
  ): Promise<{ success: boolean; id: string }> {
    if (!project || !project.startsWith('/')) {
      throw new Error('Invalid project path: must be an absolute path');
    }
    if (!session || !/^[a-zA-Z0-9-]+$/.test(session)) {
      throw new Error('Invalid session name: must be alphanumeric with hyphens only');
    }
    if (!snippetId || typeof snippetId !== 'string') {
      throw new Error('Invalid snippet ID: must be a non-empty string');
    }
    if (!metadata.name || typeof metadata.name !== 'string') {
      throw new Error('Invalid snippet name: must be a non-empty string');
    }

    // Ensure snippets directory exists
    await this.ensureSnippetsDir(project, session);

    // Snippet registration is complete - metadata is typically managed by a snippet manager
    // This method ensures the directory structure is in place
    return { success: true, id: snippetId };
  }

  /**
   * Unregister a snippet artifact (does not delete files, just registration).
   */
  async unregisterSnippet(project: string, session: string, snippetId: string): Promise<boolean> {
    if (!project || !project.startsWith('/')) {
      throw new Error('Invalid project path: must be an absolute path');
    }
    if (!session || !/^[a-zA-Z0-9-]+$/.test(session)) {
      throw new Error('Invalid session name: must be alphanumeric with hyphens only');
    }
    if (!snippetId || typeof snippetId !== 'string') {
      throw new Error('Invalid snippet ID: must be a non-empty string');
    }

    // Snippet unregistration is a no-op at the registry level
    // The actual file management is handled by the snippet manager
    return true;
  }

  /**
   * Remove a session from the registry (does not delete files).
   */
  async unregister(project: string, session: string): Promise<boolean> {
    // Like register(), the load→mutate→save runs under the mutex and
    // a corrupt-load intentionally rethrows — we must not destructively
    // rewrite the registry when we can't read it.
    return this.writeMutex.run(async () => {
      const registry = await this.load();
      const initialLength = registry.sessions.length;

      registry.sessions = registry.sessions.filter(
        s => !(s.project === project && s.session === session)
      );

      if (registry.sessions.length < initialLength) {
        await this.save(registry);
        return true;
      }
      return false;
    });
  }
}

// Singleton instance for convenience
export const sessionRegistry = new SessionRegistry();
