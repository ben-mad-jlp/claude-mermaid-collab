/**
 * MCP Tools: Projects Management
 *
 * Provides tools for listing, registering, and unregistering projects.
 * Tools:
 * - list_projects: List all registered projects
 * - register_project: Register a new project
 * - unregister_project: Remove a project
 */

import { isAbsolute } from 'path';
import { projectRegistry, type Project } from '../../services/project-registry.js';

/**
 * Tool: list_projects
 *
 * List all registered projects
 * Returns all valid projects, filtering out stale entries
 */
export const listProjectsSchema = {
  type: 'object',
  properties: {},
  required: [],
};

export async function handleListProjects(): Promise<{ projects: Project[] }> {
  const projects = await projectRegistry.list();
  return { projects };
}

/**
 * Tool: register_project
 *
 * Register a new project or update an existing one
 * Validates that the path is absolute and exists on the filesystem
 */
export const registerProjectSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Absolute path to project root',
    },
  },
  required: ['path'],
};

export async function handleRegisterProject(args: { path: string }): Promise<{
  success: boolean;
  project?: Project;
  error?: string;
}> {
  try {
    if (!isAbsolute(args.path)) {
      return { success: false, error: 'Path must be absolute' };
    }

    await projectRegistry.register(args.path);

    const projects = await projectRegistry.list();
    const project = projects.find(p => p.path === args.path);

    return { success: true, project };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Tool: unregister_project
 *
 * Remove a project from the registry
 */
export const unregisterProjectSchema = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Absolute path to project',
    },
  },
  required: ['path'],
};

export async function handleUnregisterProject(args: { path: string }): Promise<{
  success: boolean;
}> {
  const removed = await projectRegistry.unregister(args.path);
  return { success: removed };
}
