/**
 * Tests for MCP Server Setup - Projects Tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleListProjects,
  handleRegisterProject,
  handleUnregisterProject,
  listProjectsSchema,
  registerProjectSchema,
  unregisterProjectSchema,
} from './tools/projects.js';
import { projectRegistry } from '../services/project-registry.js';

// Mock the project registry
vi.mock('../services/project-registry.js', () => ({
  projectRegistry: {
    list: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

describe('MCP Server Setup - Projects Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tool imports in setup.ts', () => {
    it('should successfully import projects tool handlers', async () => {
      const { handleListProjects: handler1 } = await import('./tools/projects.js');
      const { handleRegisterProject: handler2 } = await import('./tools/projects.js');
      const { handleUnregisterProject: handler3 } = await import('./tools/projects.js');

      expect(handler1).toBeDefined();
      expect(handler2).toBeDefined();
      expect(handler3).toBeDefined();
    });

    it('should successfully import projects tool schemas', async () => {
      const { listProjectsSchema: schema1 } = await import('./tools/projects.js');
      const { registerProjectSchema: schema2 } = await import('./tools/projects.js');
      const { unregisterProjectSchema: schema3 } = await import('./tools/projects.js');

      expect(schema1).toBeDefined();
      expect(schema2).toBeDefined();
      expect(schema3).toBeDefined();
    });
  });

  describe('list_projects handler', () => {
    it('should return projects from registry', async () => {
      const now = new Date().toISOString();
      const mockProjects = [
        { path: '/path/to/project1', name: 'project1', lastAccess: now },
        { path: '/path/to/project2', name: 'project2', lastAccess: now },
      ];

      vi.mocked(projectRegistry.list).mockResolvedValueOnce(mockProjects);

      const result = await handleListProjects();

      expect(result).toEqual({ projects: mockProjects });
      expect(projectRegistry.list).toHaveBeenCalled();
    });

    it('should return empty array when no projects registered', async () => {
      vi.mocked(projectRegistry.list).mockResolvedValueOnce([]);

      const result = await handleListProjects();

      expect(result).toEqual({ projects: [] });
    });
  });

  describe('register_project handler', () => {
    it('should register a valid project path', async () => {
      const now = new Date().toISOString();
      const mockProject = {
        path: '/absolute/path/to/project',
        name: 'project',
        lastAccess: now,
      };

      vi.mocked(projectRegistry.register).mockResolvedValueOnce({ created: true });
      vi.mocked(projectRegistry.list).mockResolvedValueOnce([mockProject]);

      const result = await handleRegisterProject({ path: '/absolute/path/to/project' });

      expect(result.success).toBe(true);
      expect(result.project).toEqual(mockProject);
      expect(projectRegistry.register).toHaveBeenCalledWith('/absolute/path/to/project');
    });

    it('should reject relative paths', async () => {
      const result = await handleRegisterProject({ path: 'relative/path' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Path must be absolute');
      expect(projectRegistry.register).not.toHaveBeenCalled();
    });

    it('should handle registry errors', async () => {
      vi.mocked(projectRegistry.register).mockRejectedValueOnce(
        new Error('Registration failed')
      );

      const result = await handleRegisterProject({ path: '/absolute/path' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Registration failed');
    });
  });

  describe('unregister_project handler', () => {
    it('should unregister a project', async () => {
      vi.mocked(projectRegistry.unregister).mockResolvedValueOnce(true);

      const result = await handleUnregisterProject({ path: '/absolute/path/to/project' });

      expect(result.success).toBe(true);
      expect(projectRegistry.unregister).toHaveBeenCalledWith('/absolute/path/to/project');
    });

    it('should return false when project not found', async () => {
      vi.mocked(projectRegistry.unregister).mockResolvedValueOnce(false);

      const result = await handleUnregisterProject({ path: '/absolute/path/does/not/exist' });

      expect(result.success).toBe(false);
    });
  });

  describe('Input Schemas', () => {
    it('list_projects schema should be empty object', () => {
      expect(listProjectsSchema).toEqual({
        type: 'object',
        properties: {},
        required: [],
      });
    });

    it('register_project schema should require path', () => {
      expect(registerProjectSchema).toEqual({
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path to project root',
          },
        },
        required: ['path'],
      });
    });

    it('unregister_project schema should require path', () => {
      expect(unregisterProjectSchema).toEqual({
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path to project',
          },
        },
        required: ['path'],
      });
    });
  });
});
