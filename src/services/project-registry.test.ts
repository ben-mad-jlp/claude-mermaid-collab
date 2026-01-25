import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { ProjectRegistry, projectRegistry } from './project-registry';
import { tmpdir } from 'os';

describe('ProjectRegistry', () => {
  let testRegistryPath: string;
  let registry: ProjectRegistry;
  let testProjectPath: string;

  beforeEach(async () => {
    // Create a temporary registry file for testing
    testRegistryPath = join(tmpdir(), `test-projects-${Date.now()}.json`);
    registry = new ProjectRegistry(testRegistryPath);
    testProjectPath = join(tmpdir(), `test-project-${Date.now()}`);
    await mkdir(testProjectPath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test files
    if (fs.existsSync(testRegistryPath)) {
      await rm(testRegistryPath, { force: true });
    }
    if (fs.existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true, force: true });
    }
  });

  describe('load()', () => {
    it('should return empty array when file does not exist', async () => {
      const result = await registry.load();
      expect(result).toEqual({ projects: [] });
    });

    it('should load and parse JSON from existing file', async () => {
      const testData = {
        projects: [
          { path: '/test/project', name: 'project', lastAccess: '2025-01-25T00:00:00.000Z' }
        ]
      };
      await registry.save(testData);
      const result = await registry.load();
      expect(result).toEqual(testData);
    });

    it('should return empty array on parse error', async () => {
      // Write invalid JSON
      await mkdir(require('path').dirname(testRegistryPath), { recursive: true });
      await require('fs/promises').writeFile(testRegistryPath, 'invalid json {', 'utf-8');
      const result = await registry.load();
      expect(result).toEqual({ projects: [] });
    });

    it('should validate JSON structure', async () => {
      // Write JSON without projects array
      await mkdir(require('path').dirname(testRegistryPath), { recursive: true });
      await require('fs/promises').writeFile(testRegistryPath, JSON.stringify({ invalid: true }), 'utf-8');
      const result = await registry.load();
      expect(result).toEqual({ projects: [] });
    });
  });

  describe('save()', () => {
    it('should create directory if it does not exist', async () => {
      const nestedPath = join(tmpdir(), `nested-${Date.now()}`, 'projects.json');
      const nestedRegistry = new ProjectRegistry(nestedPath);
      const testData = { projects: [] };
      await nestedRegistry.save(testData);
      expect(fs.existsSync(nestedPath)).toBe(true);
      await rm(require('path').dirname(nestedPath), { recursive: true, force: true });
    });

    it('should write JSON to file', async () => {
      const testData = {
        projects: [
          { path: '/test/project', name: 'project', lastAccess: '2025-01-25T00:00:00.000Z' }
        ]
      };
      await registry.save(testData);
      const content = await readFile(testRegistryPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(testData);
    });

    it('should preserve JSON formatting', async () => {
      const testData = { projects: [] };
      await registry.save(testData);
      const content = await readFile(testRegistryPath, 'utf-8');
      expect(content).toContain('\n');
    });
  });

  describe('register()', () => {
    it('should reject relative paths', async () => {
      const result = registry.register('relative/path');
      await expect(result).rejects.toThrow('absolute path');
    });

    it('should reject non-existent paths', async () => {
      const result = registry.register('/non/existent/path');
      await expect(result).rejects.toThrow();
    });

    it('should create new project with basename as name', async () => {
      const result = await registry.register(testProjectPath);
      expect(result).toEqual({ created: true });

      const data = await registry.load();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].path).toBe(testProjectPath);
      expect(data.projects[0].name).toBe(require('path').basename(testProjectPath));
    });

    it('should set lastAccess to ISO timestamp', async () => {
      await registry.register(testProjectPath);
      const data = await registry.load();
      const project = data.projects[0];
      const date = new Date(project.lastAccess);
      expect(date.getTime()).toBeLessThanOrEqual(Date.now());
      expect(date.getTime()).toBeGreaterThan(Date.now() - 5000); // Within 5 seconds
    });

    it('should update lastAccess if project already exists', async () => {
      await registry.register(testProjectPath);
      const firstData = await registry.load();
      const firstTime = firstData.projects[0].lastAccess;

      // Wait a bit and register again
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = await registry.register(testProjectPath);

      expect(result).toEqual({ created: false });
      const secondData = await registry.load();
      const secondTime = secondData.projects[0].lastAccess;
      expect(secondTime).not.toBe(firstTime);
      expect(new Date(secondTime).getTime()).toBeGreaterThan(new Date(firstTime).getTime());
    });

    it('should not duplicate existing projects', async () => {
      await registry.register(testProjectPath);
      await registry.register(testProjectPath);
      const data = await registry.load();
      expect(data.projects).toHaveLength(1);
    });
  });

  describe('list()', () => {
    it('should return empty list when no projects', async () => {
      const result = await list();
      expect(result).toEqual([]);
    });

    it('should return all projects', async () => {
      await registry.register(testProjectPath);
      const testPath2 = join(tmpdir(), `test-project2-${Date.now()}`);
      await mkdir(testPath2, { recursive: true });

      await registry.register(testPath2);

      const result = await registry.list();
      expect(result).toHaveLength(2);
      expect(result.map(p => p.path)).toContain(testProjectPath);
      expect(result.map(p => p.path)).toContain(testPath2);

      await rm(testPath2, { recursive: true, force: true });
    });

    it('should sort by lastAccess descending', async () => {
      await registry.register(testProjectPath);
      await new Promise(resolve => setTimeout(resolve, 100));

      const testPath2 = join(tmpdir(), `test-project2-${Date.now()}`);
      await mkdir(testPath2, { recursive: true });
      await registry.register(testPath2);

      const result = await registry.list();
      expect(result[0].path).toBe(testPath2);
      expect(result[1].path).toBe(testProjectPath);

      await rm(testPath2, { recursive: true, force: true });
    });

    it('should filter out stale entries (non-existent paths)', async () => {
      await registry.register(testProjectPath);
      const testPath2 = join(tmpdir(), `test-project2-${Date.now()}`);
      await mkdir(testPath2, { recursive: true });
      await registry.register(testPath2);

      // Delete one project directory
      await rm(testPath2, { recursive: true, force: true });

      const result = await registry.list();
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(testProjectPath);

      // Verify stale entry was removed
      const data = await registry.load();
      expect(data.projects).toHaveLength(1);
    });

    it('should save updated registry after filtering stales', async () => {
      await registry.register(testProjectPath);
      const testPath2 = join(tmpdir(), `test-project2-${Date.now()}`);
      await mkdir(testPath2, { recursive: true });
      await registry.register(testPath2);

      // Delete one project
      await rm(testPath2, { recursive: true, force: true });

      await registry.list();

      // Verify it was persisted
      const data = await registry.load();
      expect(data.projects).toHaveLength(1);
    });
  });

  describe('unregister()', () => {
    it('should remove existing project', async () => {
      await registry.register(testProjectPath);
      const result = await registry.unregister(testProjectPath);
      expect(result).toBe(true);

      const data = await registry.load();
      expect(data.projects).toHaveLength(0);
    });

    it('should return false if project not found', async () => {
      const result = await registry.unregister('/non/existent');
      expect(result).toBe(false);
    });

    it('should not affect other projects', async () => {
      await registry.register(testProjectPath);
      const testPath2 = join(tmpdir(), `test-project2-${Date.now()}`);
      await mkdir(testPath2, { recursive: true });
      await registry.register(testPath2);

      await registry.unregister(testProjectPath);

      const data = await registry.load();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].path).toBe(testPath2);

      await rm(testPath2, { recursive: true, force: true });
    });
  });

  describe('touch()', () => {
    it('should update lastAccess for existing project', async () => {
      await registry.register(testProjectPath);
      const firstData = await registry.load();
      const firstTime = firstData.projects[0].lastAccess;

      await new Promise(resolve => setTimeout(resolve, 100));
      await registry.touch(testProjectPath);

      const secondData = await registry.load();
      const secondTime = secondData.projects[0].lastAccess;
      expect(secondTime).not.toBe(firstTime);
      expect(new Date(secondTime).getTime()).toBeGreaterThan(new Date(firstTime).getTime());
    });

    it('should not add project if not found', async () => {
      await registry.touch('/non/existent/path');
      const data = await registry.load();
      expect(data.projects).toHaveLength(0);
    });

    it('should persist changes', async () => {
      await registry.register(testProjectPath);
      const firstData = await registry.load();
      const firstTime = firstData.projects[0].lastAccess;

      await new Promise(resolve => setTimeout(resolve, 100));
      await registry.touch(testProjectPath);

      // Create new instance to verify persistence
      const newRegistry = new ProjectRegistry(testRegistryPath);
      const secondData = await newRegistry.load();
      expect(new Date(secondData.projects[0].lastAccess).getTime()).toBeGreaterThan(
        new Date(firstTime).getTime()
      );
    });
  });

  describe('singleton', () => {
    it('should export projectRegistry singleton', () => {
      expect(projectRegistry).toBeInstanceOf(ProjectRegistry);
    });
  });

  // Helper function
  async function list() {
    return await registry.list();
  }
});
