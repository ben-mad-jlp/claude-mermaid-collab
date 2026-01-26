/**
 * Tests for projects MCP tools
 *
 * Implements list_projects, register_project, and unregister_project tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ProjectRegistry, type Project } from '../../services/project-registry';
import { handleListProjects, handleRegisterProject, handleUnregisterProject } from './projects';

describe('listProjects', () => {
  let testRegistryPath: string;
  let registry: ProjectRegistry;
  let testProjectPath: string;

  beforeEach(async () => {
    testRegistryPath = join(tmpdir(), `test-projects-${Date.now()}-${Math.random()}.json`);
    registry = new ProjectRegistry(testRegistryPath);
    testProjectPath = join(tmpdir(), `test-project-${Date.now()}-${Math.random()}`);
    await mkdir(testProjectPath, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testRegistryPath)) {
      await rm(testRegistryPath, { force: true });
    }
    if (fs.existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true, force: true });
    }
  });

  it('should return empty list when no projects', async () => {
    const tempRegistry = new ProjectRegistry(testRegistryPath);
    const result = await tempRegistry.list();
    expect(result).toEqual([]);
  });

  it('should return all registered projects', async () => {
    await registry.register(testProjectPath);
    const testPath2 = join(tmpdir(), `test-project2-${Date.now()}-${Math.random()}`);
    await mkdir(testPath2, { recursive: true });
    await registry.register(testPath2);

    const result = await registry.list();
    expect(result).toHaveLength(2);
    expect(result.map(p => p.path)).toContain(testProjectPath);
    expect(result.map(p => p.path)).toContain(testPath2);

    await rm(testPath2, { recursive: true, force: true });
  });

  it('should filter out stale entries', async () => {
    await registry.register(testProjectPath);
    const testPath2 = join(tmpdir(), `test-project2-${Date.now()}-${Math.random()}`);
    await mkdir(testPath2, { recursive: true });
    await registry.register(testPath2);

    // Delete one project directory
    await rm(testPath2, { recursive: true, force: true });

    const result = await registry.list();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(testProjectPath);

    await rm(testPath2, { recursive: true, force: true });
  });
});

describe('registerProject', () => {
  let testRegistryPath: string;
  let registry: ProjectRegistry;
  let testProjectPath: string;

  beforeEach(async () => {
    testRegistryPath = join(tmpdir(), `test-projects-${Date.now()}-${Math.random()}.json`);
    registry = new ProjectRegistry(testRegistryPath);
    testProjectPath = join(tmpdir(), `test-project-${Date.now()}-${Math.random()}`);
    await mkdir(testProjectPath, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testRegistryPath)) {
      await rm(testRegistryPath, { force: true });
    }
    if (fs.existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true, force: true });
    }
  });

  it('should successfully register a new project', async () => {
    const result = await registry.register(testProjectPath);
    expect(result.created).toBe(true);

    const data = await registry.load();
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].path).toBe(testProjectPath);
  });

  it('should return project data on success', async () => {
    await registry.register(testProjectPath);
    const projects = await registry.list();
    expect(projects).toHaveLength(1);
    expect(projects[0].path).toBe(testProjectPath);
    expect(projects[0].name).toBeDefined();
    expect(projects[0].lastAccess).toBeDefined();
  });

  it('should reject relative paths', async () => {
    await expect(registry.register('relative/path')).rejects.toThrow('absolute path');
  });

  it('should reject non-existent paths', async () => {
    await expect(registry.register('/non/existent/path/that/does/not/exist')).rejects.toThrow();
  });

  it('should update lastAccess if project already exists', async () => {
    await registry.register(testProjectPath);
    const firstData = await registry.load();
    const firstTime = firstData.projects[0].lastAccess;

    // Wait a bit and register again
    await new Promise(resolve => setTimeout(resolve, 100));
    const result = await registry.register(testProjectPath);

    expect(result.created).toBe(false);
    const secondData = await registry.load();
    const secondTime = secondData.projects[0].lastAccess;
    expect(secondTime).not.toBe(firstTime);
  });
});

describe('unregisterProject', () => {
  let testRegistryPath: string;
  let registry: ProjectRegistry;
  let testProjectPath: string;

  beforeEach(async () => {
    testRegistryPath = join(tmpdir(), `test-projects-${Date.now()}-${Math.random()}.json`);
    registry = new ProjectRegistry(testRegistryPath);
    testProjectPath = join(tmpdir(), `test-project-${Date.now()}-${Math.random()}`);
    await mkdir(testProjectPath, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testRegistryPath)) {
      await rm(testRegistryPath, { force: true });
    }
    if (fs.existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true, force: true });
    }
  });

  it('should successfully remove an existing project', async () => {
    await registry.register(testProjectPath);
    const result = await registry.unregister(testProjectPath);
    expect(result).toBe(true);

    const data = await registry.load();
    expect(data.projects).toHaveLength(0);
  });

  it('should return false if project not found', async () => {
    const result = await registry.unregister('/non/existent/path');
    expect(result).toBe(false);
  });

  it('should not affect other projects', async () => {
    await registry.register(testProjectPath);
    const testPath2 = join(tmpdir(), `test-project2-${Date.now()}-${Math.random()}`);
    await mkdir(testPath2, { recursive: true });
    await registry.register(testPath2);

    await registry.unregister(testProjectPath);

    const data = await registry.load();
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].path).toBe(testPath2);

    await rm(testPath2, { recursive: true, force: true });
  });
});

describe('handler functions', () => {
  let testProjectPath: string;

  beforeEach(async () => {
    testProjectPath = join(tmpdir(), `test-project-${Date.now()}-${Math.random()}`);
    await mkdir(testProjectPath, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true, force: true });
    }
  });

  describe('handleListProjects', () => {
    it('should return projects array', async () => {
      const result = await handleListProjects();
      expect(result).toHaveProperty('projects');
      expect(Array.isArray(result.projects)).toBe(true);
    });
  });

  describe('handleRegisterProject', () => {
    it('should handle absolute path registration', async () => {
      const result = await handleRegisterProject({ path: testProjectPath });
      expect(result.success).toBe(true);
      expect(result.project).toBeDefined();
      expect(result.project?.path).toBe(testProjectPath);
    });

    it('should reject relative paths', async () => {
      const result = await handleRegisterProject({ path: 'relative/path' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('absolute');
    });

    it('should handle non-existent paths', async () => {
      const result = await handleRegisterProject({ path: '/non/existent/path' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('handleUnregisterProject', () => {
    it('should remove project', async () => {
      await handleRegisterProject({ path: testProjectPath });
      const result = await handleUnregisterProject({ path: testProjectPath });
      expect(result.success).toBe(true);
    });

    it('should return false for non-existent project', async () => {
      const result = await handleUnregisterProject({ path: '/non/existent/path' });
      expect(result.success).toBe(false);
    });
  });
});
