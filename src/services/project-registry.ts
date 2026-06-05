import { mkdir, readFile, writeFile } from 'fs/promises';
import * as fs from 'fs';
import { join, isAbsolute, basename } from 'path';
import { homedir } from 'os';

export interface Project {
  path: string;       // Absolute path (primary key)
  name: string;       // Display name (basename of path)
  lastAccess: string; // ISO timestamp for sorting
}

export interface ProjectRegistryData {
  projects: Project[];
}

const DATA_DIR = join(homedir(), '.mermaid-collab');
const PROJECTS_PATH = join(DATA_DIR, 'projects.json');

export class ProjectRegistry {
  private registryPath: string;

  constructor(registryPath: string = PROJECTS_PATH) {
    this.registryPath = registryPath;
  }

  /**
   * Load projects.json from disk
   * Return empty { projects: [] } if file doesn't exist
   * Parse and validate JSON structure
   */
  async load(): Promise<ProjectRegistryData> {
    try {
      if (!fs.existsSync(this.registryPath)) {
        return { projects: [] };
      }
      const content = await readFile(this.registryPath, 'utf-8');
      const data = JSON.parse(content);
      if (!data.projects || !Array.isArray(data.projects)) {
        console.warn('Invalid projects.json format, starting fresh');
        return { projects: [] };
      }
      return data;
    } catch (error) {
      console.warn('Failed to load projects.json, starting fresh:', error);
      return { projects: [] };
    }
  }

  /**
   * Write to projects.json
   * Create ~/.mermaid-collab/ directory if missing
   * Write JSON with formatting
   */
  async save(registry: ProjectRegistryData): Promise<void> {
    await mkdir(this.registryPath.split('/').slice(0, -1).join('/'), { recursive: true });
    await writeFile(this.registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  }

  /**
   * Add or update a project
   * Validate path is absolute
   * Validate path exists on filesystem
   * If exists, update lastAccess and return { created: false }
   * If new, add with name and lastAccess timestamp, return { created: true }
   */
  async register(path: string): Promise<{ created: boolean }> {
    // Validate path is absolute
    if (!isAbsolute(path)) {
      throw new Error('Invalid project path: must be an absolute path');
    }

    // Validate path exists
    if (!fs.existsSync(path)) {
      throw new Error(`Project path does not exist: ${path}`);
    }

    const registry = await this.load();
    const now = new Date().toISOString();

    // Check if project already exists
    const existingIndex = registry.projects.findIndex(p => p.path === path);

    if (existingIndex >= 0) {
      // Update lastAccess
      registry.projects[existingIndex].lastAccess = now;
      await this.save(registry);
      return { created: false };
    } else {
      // Add new project
      registry.projects.push({
        path,
        name: basename(path),
        lastAccess: now
      });
      await this.save(registry);
      return { created: true };
    }
  }

  /**
   * Return all projects
   * Filter out stale entries (where path no longer exists)
   * Save updated registry (removes stale)
   * Sort by lastAccess descending (newest first)
   */
  async list(): Promise<Project[]> {
    const registry = await this.load();
    const validProjects: Project[] = [];
    const staleProjects: Project[] = [];

    // Validate each project's existence
    for (const project of registry.projects) {
      try {
        if (fs.existsSync(project.path)) {
          validProjects.push(project);
        } else {
          staleProjects.push(project);
        }
      } catch (error) {
        // If existsSync throws (permission issues), treat as stale
        staleProjects.push(project);
      }
    }

    // Reconcile WITH disk: the global registry is NOT the sole source of
    // truth. A project whose projects.json entry was lost (server restart,
    // pre-update onboarding) is still discoverable from its on-disk .collab/
    // — e.g. the session registry references it. Union those in and backfill
    // so cross-project enumeration sees live projects without manual
    // re-onboarding. (DOGFOOD #1)
    const knownPaths = new Set(validProjects.map(p => p.path));
    const discovered: Project[] = [];
    for (const path of await this.discoverProjectPaths()) {
      if (knownPaths.has(path)) continue;
      let lastAccess: string;
      try {
        lastAccess = fs.statSync(join(path, '.collab')).mtime.toISOString();
      } catch {
        lastAccess = new Date(0).toISOString();
      }
      const project: Project = { path, name: basename(path), lastAccess };
      discovered.push(project);
      validProjects.push(project);
      knownPaths.add(path);
    }

    // Persist the reconciled set (stale removed, discovered backfilled).
    if (staleProjects.length > 0 || discovered.length > 0) {
      registry.projects = validProjects;
      try {
        await this.save(registry);
        if (discovered.length > 0) {
          console.log(
            `Backfilled on-disk projects into registry: ${discovered.map(p => p.name).join(', ')}`
          );
        }
      } catch (error) {
        console.warn('Failed to save registry after reconciling projects:', error);
        // Continue - don't let save failure prevent returning valid projects
      }
    }

    // Sort by lastAccess descending (most recent first)
    return validProjects.sort(
      (a, b) => new Date(b.lastAccess).getTime() - new Date(a.lastAccess).getTime()
    );
  }

  /**
   * Derive candidate project paths from disk rather than the registry: the
   * distinct project roots referenced by the session registry that still
   * have a valid on-disk .collab/ directory. This is what lets a project
   * with live sessions but a lost registry entry reappear. Read raw via the
   * session registry's load() (not list()) to avoid a list()→list() cycle.
   */
  private async discoverProjectPaths(): Promise<string[]> {
    const paths = new Set<string>();
    // Only cross-reference the global session registry for the default
    // singleton. Test instances (and any non-default registryPath) stay
    // isolated to their own file rather than pulling in the real registry.
    if (this.registryPath !== PROJECTS_PATH) {
      return [];
    }
    try {
      const { sessionRegistry } = await import('./session-registry.js');
      const data = await sessionRegistry.load();
      for (const s of data.sessions) {
        try {
          if (fs.existsSync(join(s.project, '.collab'))) paths.add(s.project);
        } catch {
          // skip unreadable
        }
      }
    } catch {
      // Best-effort: session registry unreadable → nothing to derive.
    }
    return [...paths];
  }

  /**
   * Remove a project
   * Load registry
   * Filter out project matching path
   * Save updated registry
   * Return true if removed, false if not found
   */
  async unregister(path: string): Promise<boolean> {
    const registry = await this.load();
    const initialLength = registry.projects.length;

    registry.projects = registry.projects.filter(p => p.path !== path);

    if (registry.projects.length < initialLength) {
      await this.save(registry);
      return true;
    }
    return false;
  }

  /**
   * Update lastAccess only
   * Load registry
   * Find project matching path
   * Update lastAccess to current ISO timestamp
   * Save registry
   * No-op if path not found (don't add)
   */
  async touch(path: string): Promise<void> {
    const registry = await this.load();
    const project = registry.projects.find(p => p.path === path);

    if (project) {
      project.lastAccess = new Date().toISOString();
      await this.save(registry);
    }
    // No-op if not found
  }
}

// Singleton instance for convenience
export const projectRegistry = new ProjectRegistry();
