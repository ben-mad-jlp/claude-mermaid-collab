import { mkdir, readFile, writeFile, rename, unlink, open } from 'fs/promises';
import * as fs from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { isTransientProjectPath } from './project-registry.js';

export interface Session {
  project: string;
  session: string;
  lastAccess: string;
}

export interface SessionRegistryData {
  sessions: Session[];
}

// MERMAID_DATA_DIR lets tests isolate sessions.json off the real ~/.mermaid-collab
// (else a test's session register() leaks a project into the live app via the
// session-derived project discovery). Mirrors MERMAID_SUPERVISOR_DIR elsewhere.
const DATA_DIR = process.env.MERMAID_DATA_DIR ?? join(homedir(), '.mermaid-collab');
const REGISTRY_PATH = join(DATA_DIR, 'sessions.json');

/**
 * Throttle interval for the on-disk session-discovery/backfill pass inside
 * `list()`. The backfill scan (`collectProjectRoots` + `discoverDiskSessions`)
 * walks EVERY registered project's `.collab/sessions/` dir with synchronous fs
 * calls — O(projects) blocking work on the single event loop. `list()` is polled
 * on the ~30s orchestrator/UI cadence, so running the full disk scan on every
 * call periodically stalled the HTTP endpoint. The registry file itself is the
 * authoritative fast path; disk-discovery only self-heals lost rows and does NOT
 * need 30s freshness. Gate it to at most once per this interval. Exported +
 * clock-injectable (see `list(opts.now)`) for deterministic unit tests.
 */
export const SESSION_BACKFILL_INTERVAL_MS = 15 * 60_000; // 15 min

/**
 * Single chokepoint for the `.collab/<workspaces>/` directory segment.
 *
 * Step 1 of the session→workspace migration: every hardcoded
 * `join(project, '.collab', 'sessions', ...)` literal that creates, scans, or
 * resolves a session/workspace folder routes through this helper so the eventual
 * rename happens in exactly one place. At this step it STILL returns 'sessions'
 * → ZERO behavior change. Do NOT flip this to 'workspaces' yet.
 */
export function getWorkspacesDir(): string {
  return 'sessions';
}

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

/** An artifactless session (no file in any of its workspace subdirs) older than this
 *  is treated as daemon debris and self-cleans out of the registry. Real workspaces
 *  (≥1 artifact file) never expire. */
export const ARTIFACTLESS_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Harness bookkeeping written by register() itself — never counts as an artifact. */
const SESSION_BOOKKEEPING_FILES = new Set(['collab-state.json']);

/** Does this session dir contain ANY user artifact file (bounded walk, early exit)?
 *  The shape register() creates — empty typed subdirs + collab-state.json — counts
 *  as artifactless; dotfiles and bookkeeping are ignored. */
export function sessionDirHasArtifacts(sessionPath: string, depthLimit = 4): boolean {
  const walk = (dir: string, depth: number): boolean => {
    if (depth > depthLimit) return false;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isFile()) {
        if (depth === 0 && SESSION_BOOKKEEPING_FILES.has(e.name)) continue;
        return true;
      }
      if (e.isDirectory() && walk(join(dir, e.name), depth + 1)) return true;
    }
    return false;
  };
  return walk(sessionPath, 0);
}

export class SessionRegistry {
  private registryPath: string;
  // Serializes all load→mutate→save sequences within a single process.
  // Cross-process concurrency is NOT covered by this mutex.
  private writeMutex = new Mutex();
  // Wall-clock (injected clock) of the last on-disk discovery/backfill scan.
  // Gates the O(projects) fs scan in list() to SESSION_BACKFILL_INTERVAL_MS.
  private lastBackfillAt = 0;

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
      const sessionPath = join(project, '.collab', getWorkspacesDir(), session);
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
  async list(opts: { now?: () => number; force?: boolean } = {}): Promise<Session[]> {
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
        // A worker-worktree-local `.collab` (…/.collab/agent-sessions/worktrees/<lane>)
        // is never a real project — it's a per-todo isolation checkout. Such rows
        // get backfilled in as pseudo-projects (e.g. `backend-1/backend-1`); treat
        // them as stale so this read-modify-write self-heals them out of the registry.
        if (isTransientProjectPath(session.project)) {
          staleSessions.push(session);
          continue;
        }
        // Check new location first
        const newSessionPath = join(session.project, '.collab', getWorkspacesDir(), session.session);
        // Check todos directory
        const todosSessionPath = join(session.project, '.collab', 'todos', session.session);
        // Then old location for backwards compatibility
        const oldSessionPath = join(session.project, '.collab', session.session);

        if (fs.existsSync(newSessionPath) || fs.existsSync(todosSessionPath) || fs.existsSync(oldSessionPath)) {
          // ARTIFACTLESS EXPIRY: daemon-spawned sessions (leaf lanes, pool workers)
          // register + mkdir their session dirs but never create an artifact. They
          // aren't real workspaces — after ARTIFACTLESS_SESSION_MAX_AGE_MS of
          // inactivity they self-clean instead of cluttering the add-to-watch
          // picker forever. A session with ANY artifact file is kept indefinitely.
          const age = (opts.now ?? Date.now)() - Date.parse(session.lastAccess || '');
          if (
            (Number.isNaN(age) || age > ARTIFACTLESS_SESSION_MAX_AGE_MS) &&
            fs.existsSync(newSessionPath) &&
            !sessionDirHasArtifacts(newSessionPath)
          ) {
            staleSessions.push(session);
          } else {
            validSessions.push(session);
          }
        } else {
          staleSessions.push(session);
        }
      } catch (error) {
        // If existsSync throws (permission issues), treat as invalid
        staleSessions.push(session);
      }
    }

    // Reconcile WITH disk: the on-disk .collab/ dirs — not the registry
    // file — are the real source of truth. A project whose registry entry
    // was lost (server restart, pre-update onboarding) still has its
    // sessions on disk; discover and backfill them so cross-project
    // enumeration sees live sessions without manual re-onboarding.
    // (DOGFOOD #1)
    //
    // THROTTLED: `collectProjectRoots` + `discoverDiskSessions` do synchronous
    // fs walks across EVERY registered project. On a machine with ~32 projects
    // this is heavy blocking work, and list() is polled on the ~30s cadence, so
    // running the scan every call periodically stalled the HTTP endpoint. Gate
    // it to once per SESSION_BACKFILL_INTERVAL_MS. The registry rows are still
    // validated + returned fresh every call; only the self-healing disk scan is
    // rate-limited (a lost row surfaces within the interval instead of instantly).
    const presentKeys = new Set(
      validSessions.map(s => `${s.project}${s.session}`)
    );
    const now = (opts.now ?? Date.now)();
    let discovered: Session[] = [];
    if (opts.force || now - this.lastBackfillAt >= SESSION_BACKFILL_INTERVAL_MS) {
      this.lastBackfillAt = now;
      discovered = await this.discoverDiskSessions(
        await this.collectProjectRoots(validSessions),
        presentKeys
      );
      for (const s of discovered) {
        validSessions.push(s);
        presentKeys.add(`${s.project}${s.session}`);
      }
    }

    // Auto-clean stale sessions / backfill discovered ones. This is a
    // read-modify-write sequence so it goes through the mutex, and we
    // re-load under the lock to avoid racing with other writers.
    if (staleSessions.length > 0 || discovered.length > 0) {
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

        // Backfill discovered on-disk sessions not already in the registry.
        const known = new Set(
          freshRegistry.sessions.map(s => `${s.project} ${s.session}`)
        );
        for (const s of discovered) {
          const k = `${s.project} ${s.session}`;
          if (!known.has(k)) {
            freshRegistry.sessions.push(s);
            known.add(k);
          }
        }

        try {
          await this.save(freshRegistry);
          if (staleSessions.length > 0) {
            const staleNames = staleSessions
              .map(s => `${basename(s.project)}/${s.session}`)
              .join(', ');
            console.log(`Removed stale sessions from registry: ${staleNames}`);
          }
          if (discovered.length > 0) {
            const newNames = discovered
              .map(s => `${basename(s.project)}/${s.session}`)
              .join(', ');
            console.log(`Backfilled on-disk sessions into registry: ${newNames}`);
          }
        } catch (error) {
          console.warn(
            'Failed to save registry after reconciling sessions:',
            error
          );
          // Continue - don't let save failure prevent returning valid sessions
        }
      });
    }

    // Dedup by (project, session): registry.sessions can hold duplicate rows
    // (corruption, races, or backfill under a differently-shaped key), and the
    // validation loop above pushes every one — so the same session can surface
    // twice (the Watching list shows it twice). Collapse to one row per pair,
    // keeping the freshest lastAccess. Space-joined key matches the existing
    // presentKeys style used for the discovered-session reconcile above.
    const deduped = new Map<string, Session>();
    for (const s of validSessions) {
      const key = `${s.project}${s.session}`;
      const existing = deduped.get(key);
      if (
        !existing ||
        new Date(s.lastAccess).getTime() > new Date(existing.lastAccess).getTime()
      ) {
        deduped.set(key, s);
      }
    }

    // Sort by lastAccess descending (most recent first)
    return Array.from(deduped.values()).sort(
      (a, b) => new Date(b.lastAccess).getTime() - new Date(a.lastAccess).getTime()
    );
  }

  /**
   * Collect the set of project roots to scan for on-disk sessions: the
   * distinct projects already in the session registry, unioned with every
   * project in the project registry (read raw via loadSync() to avoid a
   * list()→list() cycle between the two registries).
   */
  private async collectProjectRoots(known: Session[]): Promise<string[]> {
    const roots = new Set<string>(known.map(s => s.project));
    // Only cross-reference the global project registry for the default
    // singleton. Test instances (and any non-default registryPath) stay
    // isolated to their own file rather than pulling in the real registry.
    if (this.registryPath !== REGISTRY_PATH) {
      return [...roots];
    }
    try {
      // Lazy import to avoid a static import cycle; project-registry does
      // not import session-registry, and we only touch its raw load().
      const { projectRegistry } = await import('./project-registry.js');
      const data = await projectRegistry.load();
      if (data?.projects) {
        for (const p of data.projects) roots.add(p.path);
      }
    } catch {
      // Best-effort: if the project registry can't be read, fall back to
      // the projects we already know about from the session registry.
    }
    return [...roots];
  }

  /**
   * Scan each project's .collab/sessions/ directory for session folders and
   * return Session entries for any not already present (by project+session
   * key). lastAccess is derived from the directory mtime so ordering stays
   * meaningful. Best-effort: unreadable dirs are skipped silently.
   */
  private async discoverDiskSessions(
    projectRoots: string[],
    presentKeys: Set<string>
  ): Promise<Session[]> {
    const found: Session[] = [];
    for (const project of projectRoots) {
      // Never scan a worker-worktree-local `.collab` — it would re-ingest the
      // lane's own session folder as a pseudo-project every reconcile, churning
      // backfill in a loop. Worktree checkouts are not projects.
      if (isTransientProjectPath(project)) continue;
      const sessionsDir = join(project, '.collab', getWorkspacesDir());
      let entries: fs.Dirent[];
      try {
        if (!fs.existsSync(sessionsDir)) continue;
        entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const session = entry.name;
        // Skip names the registry would reject anyway (dotfiles, junk).
        if (!/^[a-zA-Z0-9-]+$/.test(session)) continue;
        const key = `${project} ${session}`;
        if (presentKeys.has(key)) continue;
        const sessionPath = join(sessionsDir, session);
        // Backfill exists to recover LOST rows for real workspaces. An artifactless
        // dir is daemon debris (or an already-deleted lane) — resurrecting it made
        // deletion impossible (DELETE removed the row, this scan re-added it).
        if (!sessionDirHasArtifacts(sessionPath)) continue;
        let lastAccess: string;
        try {
          lastAccess = fs.statSync(sessionPath).mtime.toISOString();
        } catch {
          lastAccess = new Date(0).toISOString();
        }
        found.push({ project, session, lastAccess });
      }
    }
    return found;
  }

  /**
   * Resolve the path for a session's artifact folder (diagrams, documents, designs, spreadsheets, or snippets).
   * Checks new location first, then old location for backwards compatibility.
   */
  resolvePath(project: string, session: string, type: 'diagrams' | 'documents' | 'designs' | 'spreadsheets' | 'snippets' | 'embeds' | 'images' | 'code-files' | 'audio' | '.'): string {
    if (!project || !project.startsWith('/')) {
      throw new Error('Invalid project path: must be an absolute path');
    }
    if (!session) {
      throw new Error('Invalid session name');
    }
    if (type !== 'diagrams' && type !== 'documents' && type !== 'designs' && type !== 'spreadsheets' && type !== 'snippets' && type !== 'embeds' && type !== 'images' && type !== 'code-files' && type !== 'audio' && type !== '.') {
      throw new Error('Invalid type: must be "diagrams", "documents", "designs", "spreadsheets", "snippets", "embeds", "images", "code-files", "audio", or "."');
    }

    // Check regular sessions first
    const newPath = join(project, '.collab', getWorkspacesDir(), session, type);
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

    const snippetsPath = join(project, '.collab', getWorkspacesDir(), session, 'snippets');
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
