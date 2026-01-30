import { mkdir, readFile, writeFile } from 'fs/promises';
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

const INITIAL_DESIGN_TEMPLATE = (sessionName: string) => `# Session: ${sessionName}

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

*To be filled by gather-session-goals*

---

## Diagrams
(auto-synced)`;

export class SessionRegistry {
  private registryPath: string;

  constructor(registryPath: string = REGISTRY_PATH) {
    this.registryPath = registryPath;
  }

  private async createFileIfNotExists(filePath: string, content: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }
  }

  /**
   * Load the session registry from disk.
   * Returns empty registry if file doesn't exist or is invalid.
   */
  async load(): Promise<SessionRegistryData> {
    try {
      if (!fs.existsSync(this.registryPath)) {
        return { sessions: [] };
      }
      const content = await readFile(this.registryPath, 'utf-8');
      const data = JSON.parse(content);
      if (!data.sessions || !Array.isArray(data.sessions)) {
        console.warn('Invalid sessions.json format, starting fresh');
        return { sessions: [] };
      }
      return data;
    } catch (error) {
      console.warn('Failed to load sessions.json, starting fresh:', error);
      return { sessions: [] };
    }
  }

  /**
   * Save the session registry to disk.
   */
  async save(registry: SessionRegistryData): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true });
    await writeFile(this.registryPath, JSON.stringify(registry, null, 2));
  }

  /**
   * Register a session. Idempotent - updates lastAccess if already exists.
   * Also ensures the session directories exist.
   * Returns { created: true } if a new session was created, { created: false } if already existed.
   */
  async register(project: string, session: string): Promise<{ created: boolean }> {
    // Validate inputs
    if (!project || !project.startsWith('/')) {
      throw new Error('Invalid project path: must be an absolute path');
    }
    if (!session || !/^[a-zA-Z0-9-]+$/.test(session)) {
      throw new Error('Invalid session name: must be alphanumeric with hyphens only');
    }

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

    // Create session files if they don't exist
    const collabStatePath = join(sessionPath, 'collab-state.json');
    const collabStateContent = JSON.stringify({
      state: 'collab-start',
      lastActivity: now,
      currentItem: null
    }, null, 2);
    await this.createFileIfNotExists(collabStatePath, collabStateContent);

    const designDocPath = join(sessionPath, 'documents', 'design.md');
    const designDocContent = INITIAL_DESIGN_TEMPLATE(session);
    await this.createFileIfNotExists(designDocPath, designDocContent);

    return { created };
  }

  /**
   * List all registered sessions.
   * Validates each session directory exists and auto-cleans stale entries.
   */
  async list(): Promise<Session[]> {
    const registry = await this.load();
    const validSessions: Session[] = [];
    const staleSessions: Session[] = [];

    // Validate each session's existence (check both new and old locations)
    for (const session of registry.sessions) {
      try {
        // Check new location first
        const newSessionPath = join(session.project, '.collab', 'sessions', session.session);
        // Then old location for backwards compatibility
        const oldSessionPath = join(session.project, '.collab', session.session);

        if (fs.existsSync(newSessionPath) || fs.existsSync(oldSessionPath)) {
          validSessions.push(session);
        } else {
          staleSessions.push(session);
        }
      } catch (error) {
        // If existsSync throws (permission issues), treat as invalid
        staleSessions.push(session);
      }
    }

    // Auto-clean stale sessions if any were found
    if (staleSessions.length > 0) {
      registry.sessions = validSessions;
      try {
        await this.save(registry);
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
    }

    // Sort by lastAccess descending (most recent first)
    return validSessions.sort(
      (a, b) => new Date(b.lastAccess).getTime() - new Date(a.lastAccess).getTime()
    );
  }

  /**
   * Resolve the path for a session's diagrams or documents folder.
   * Checks new location first, then old location for backwards compatibility.
   */
  resolvePath(project: string, session: string, type: 'diagrams' | 'documents'): string {
    if (!project || !project.startsWith('/')) {
      throw new Error('Invalid project path: must be an absolute path');
    }
    if (!session) {
      throw new Error('Invalid session name');
    }
    if (type !== 'diagrams' && type !== 'documents') {
      throw new Error('Invalid type: must be "diagrams" or "documents"');
    }

    // Check new location first
    const newPath = join(project, '.collab', 'sessions', session, type);
    if (fs.existsSync(newPath)) {
      return newPath;
    }

    // Check old location for backwards compatibility
    const oldPath = join(project, '.collab', session, type);
    if (fs.existsSync(oldPath)) {
      return oldPath;
    }

    // Default to new location
    return newPath;
  }

  /**
   * Get display name for a session (project-name / session-name).
   */
  getDisplayName(session: Session): string {
    const projectName = basename(session.project);
    return `${projectName} / ${session.session}`;
  }

  /**
   * Remove a session from the registry (does not delete files).
   */
  async unregister(project: string, session: string): Promise<boolean> {
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
  }
}

// Singleton instance for convenience
export const sessionRegistry = new SessionRegistry();
