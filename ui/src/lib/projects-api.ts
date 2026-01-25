/**
 * Projects API Client - HTTP fetch methods for projects management
 */

export interface Project {
  path: string;       // Absolute path (primary key)
  name: string;       // Display name (basename of path)
  lastAccess: string; // ISO timestamp for sorting
}

const API_BASE = ''; // Use relative URLs (same host)

/**
 * Projects API client for managing registered projects
 */
export const projectsApi = {
  /**
   * Fetch all registered projects
   * GET /api/projects
   * Returns: Project[]
   */
  async list(): Promise<Project[]> {
    try {
      const response = await fetch(`${API_BASE}/api/projects`);

      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.statusText}`);
      }

      const data = await response.json();
      return data.projects || [];
    } catch (error) {
      throw error;
    }
  },

  /**
   * Register a new project
   * POST /api/projects with body { path }
   * Returns: { success: boolean, project?: Project, error?: string }
   */
  async register(path: string): Promise<{ success: boolean; project?: Project; error?: string }> {
    try {
      const response = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Failed to register project',
        };
      }

      return {
        success: data.success ?? true,
        project: data.project,
      };
    } catch (error) {
      throw error;
    }
  },

  /**
   * Unregister a project
   * DELETE /api/projects?path=...
   * Returns: { success: boolean }
   */
  async unregister(path: string): Promise<{ success: boolean }> {
    try {
      const encodedPath = encodeURIComponent(path);
      const response = await fetch(`${API_BASE}/api/projects?path=${encodedPath}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
        };
      }

      return {
        success: data.success ?? true,
      };
    } catch (error) {
      throw error;
    }
  },
};
