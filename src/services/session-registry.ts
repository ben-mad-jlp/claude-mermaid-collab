import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
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

export class SessionRegistry {
  private registryPath: string;

  constructor(registryPath: string = REGISTRY_PATH) {
    this.registryPath = registryPath;
  }

  /**
   * Load the session registry from disk.
   * Returns empty registry if file doesn't exist or is invalid.
   */
  async load(): Promise<SessionRegistryData> {
    try {
      if (!existsSync(this.registryPath)) {
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
   */
  async register(project: string, session: string): Promise<void> {
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

    if (existingIndex >= 0) {
      // Update lastAccess
      registry.sessions[existingIndex].lastAccess = now;
    } else {
      // Add new session
      registry.sessions.push({ project, session, lastAccess: now });
    }

    await this.save(registry);

    // Ensure directories exist
    const sessionPath = join(project, '.collab', session);
    await mkdir(join(sessionPath, 'diagrams'), { recursive: true });
    await mkdir(join(sessionPath, 'documents'), { recursive: true });
  }

  /**
   * List all registered sessions.
   */
  async list(): Promise<Session[]> {
    const registry = await this.load();
    // Sort by lastAccess descending (most recent first)
    return registry.sessions.sort(
      (a, b) => new Date(b.lastAccess).getTime() - new Date(a.lastAccess).getTime()
    );
  }

  /**
   * Resolve the path for a session's diagrams or documents folder.
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

    return join(project, '.collab', session, type);
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
