/**
 * Projects API Client Tests
 *
 * Tests verify projects API methods:
 * - list() - Fetch all registered projects
 * - register(path) - Register a new project
 * - unregister(path) - Unregister a project
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projectsApi, type Project } from './projects-api';

// Mock fetch globally
global.fetch = vi.fn();

describe('Projects API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('list()', () => {
    it('should fetch all registered projects', async () => {
      const mockProjects: Project[] = [
        {
          path: '/home/user/project-a',
          name: 'project-a',
          lastAccess: '2025-01-24T10:00:00Z',
        },
        {
          path: '/home/user/project-b',
          name: 'project-b',
          lastAccess: '2025-01-24T11:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ projects: mockProjects }),
      });

      const result = await projectsApi.list();

      expect(global.fetch).toHaveBeenCalledWith('/api/projects');
      expect(result).toEqual(mockProjects);
      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('/home/user/project-a');
      expect(result[1].path).toBe('/home/user/project-b');
    });

    it('should return empty array when no projects exist', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ projects: [] }),
      });

      const result = await projectsApi.list();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should throw error on non-200 status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      await expect(projectsApi.list()).rejects.toThrow();
    });

    it('should throw error on network failure', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(projectsApi.list()).rejects.toThrow('Network error');
    });

    it('should handle missing projects field in response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await projectsApi.list();

      expect(result).toEqual([]);
    });
  });

  describe('register()', () => {
    it('should register a new project successfully', async () => {
      const mockProject: Project = {
        path: '/home/user/new-project',
        name: 'new-project',
        lastAccess: '2025-01-24T12:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          project: mockProject,
        }),
      });

      const result = await projectsApi.register('/home/user/new-project');

      expect(global.fetch).toHaveBeenCalledWith('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/home/user/new-project' }),
      });
      expect(result.success).toBe(true);
      expect(result.project).toEqual(mockProject);
      expect(result.error).toBeUndefined();
    });

    it('should return error object for invalid path (400)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: 'Invalid path',
        }),
      });

      const result = await projectsApi.register('/invalid/path');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid path');
      expect(result.project).toBeUndefined();
    });

    it('should return error object for non-existent path (400)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: 'Path does not exist',
        }),
      });

      const result = await projectsApi.register('/nonexistent/path');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Path does not exist');
    });

    it('should return error object for already registered project', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          success: false,
          error: 'Project already registered',
        }),
      });

      const result = await projectsApi.register('/home/user/existing-project');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Project already registered');
    });

    it('should handle network error by throwing', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(projectsApi.register('/home/user/project')).rejects.toThrow('Network error');
    });

    it('should handle JSON parse error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(projectsApi.register('/home/user/project')).rejects.toThrow('Invalid JSON');
    });
  });

  describe('unregister()', () => {
    it('should unregister a project successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
        }),
      });

      const result = await projectsApi.unregister('/home/user/project-a');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects?path=%2Fhome%2Fuser%2Fproject-a',
        { method: 'DELETE' }
      );
      expect(result.success).toBe(true);
    });

    it('should handle non-2xx status by returning error object', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          error: 'Project not found',
        }),
      });

      const result = await projectsApi.unregister('/home/user/nonexistent');

      expect(result.success).toBe(false);
    });

    it('should encode URL parameters correctly with special characters', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await projectsApi.unregister('/path with spaces & special chars');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects?path=%2Fpath%20with%20spaces%20%26%20special%20chars',
        { method: 'DELETE' }
      );
    });

    it('should handle network error by throwing', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(projectsApi.unregister('/home/user/project')).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle missing success field in response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await projectsApi.unregister('/home/user/project');

      expect(result.success).toBe(true);
    });
  });
});
