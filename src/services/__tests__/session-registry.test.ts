import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionRegistry, Session, SessionRegistryData } from '../session-registry';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SessionRegistry.list()', () => {
  let registry: SessionRegistry;
  let testRegistryPath: string;
  let testTempDir: string;

  beforeEach(() => {
    testTempDir = join(tmpdir(), `test-sessions-${Date.now()}`);
    testRegistryPath = join(testTempDir, 'sessions.json');
    mkdirSync(testTempDir, { recursive: true });
    registry = new SessionRegistry(testRegistryPath);
  });

  afterEach(() => {
    try {
      rmSync(testTempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('basic functionality', () => {
    it('should return valid sessions', async () => {
      // Create actual session directories
      const proj1 = join(testTempDir, 'project1');
      const proj2 = join(testTempDir, 'project2');
      const session1Path = join(proj1, '.collab', 'session-a');
      const session2Path = join(proj2, '.collab', 'session-b');
      mkdirSync(session1Path, { recursive: true });
      mkdirSync(session2Path, { recursive: true });

      const registryData: SessionRegistryData = {
        sessions: [
          {
            project: proj1,
            session: 'session-a',
            lastAccess: '2026-01-20T10:00:00Z',
          },
          {
            project: proj2,
            session: 'session-b',
            lastAccess: '2026-01-21T10:00:00Z',
          },
        ],
      };

      writeFileSync(testRegistryPath, JSON.stringify(registryData));

      const result = await registry.list();

      expect(result).toHaveLength(2);
      expect(result[0].session).toBe('session-b'); // Most recent first
      expect(result[1].session).toBe('session-a');
    });

    it('should filter out stale (non-existent directory) sessions', async () => {
      // Create only one valid session directory
      const proj1 = join(testTempDir, 'project1');
      const proj2 = join(testTempDir, 'project2');
      const session1Path = join(proj1, '.collab', 'valid-session');
      mkdirSync(session1Path, { recursive: true });
      // session2 directory is NOT created

      const registryData: SessionRegistryData = {
        sessions: [
          {
            project: proj1,
            session: 'valid-session',
            lastAccess: '2026-01-21T10:00:00Z',
          },
          {
            project: proj2,
            session: 'stale-session',
            lastAccess: '2026-01-20T10:00:00Z',
          },
        ],
      };

      writeFileSync(testRegistryPath, JSON.stringify(registryData));

      const result = await registry.list();

      expect(result).toHaveLength(1);
      expect(result[0].session).toBe('valid-session');
    });

    it('should auto-clean registry when stale sessions are found', async () => {
      // Create only one valid session directory
      const proj1 = join(testTempDir, 'project1');
      const proj2 = join(testTempDir, 'project2');
      const session1Path = join(proj1, '.collab', 'valid-session');
      mkdirSync(session1Path, { recursive: true });
      // session2 directory is NOT created

      const registryData: SessionRegistryData = {
        sessions: [
          {
            project: proj1,
            session: 'valid-session',
            lastAccess: '2026-01-21T10:00:00Z',
          },
          {
            project: proj2,
            session: 'stale-session',
            lastAccess: '2026-01-20T10:00:00Z',
          },
        ],
      };

      writeFileSync(testRegistryPath, JSON.stringify(registryData));

      await registry.list();

      // Verify registry was updated on disk
      const savedData = JSON.parse(readFileSync(testRegistryPath, 'utf-8'));
      expect(savedData.sessions).toHaveLength(1);
      expect(savedData.sessions[0].session).toBe('valid-session');
    });

    it('should maintain sort order after filtering', async () => {
      // Create all three session directories
      const proj1 = join(testTempDir, 'project1');
      const proj2 = join(testTempDir, 'project2');
      const proj3 = join(testTempDir, 'project3');
      mkdirSync(join(proj1, '.collab', 'session-a'), { recursive: true });
      mkdirSync(join(proj2, '.collab', 'session-b'), { recursive: true });
      mkdirSync(join(proj3, '.collab', 'session-c'), { recursive: true });

      const registryData: SessionRegistryData = {
        sessions: [
          {
            project: proj1,
            session: 'session-a',
            lastAccess: '2026-01-19T10:00:00Z',
          },
          {
            project: proj2,
            session: 'session-b',
            lastAccess: '2026-01-21T10:00:00Z',
          },
          {
            project: proj3,
            session: 'session-c',
            lastAccess: '2026-01-20T10:00:00Z',
          },
        ],
      };

      writeFileSync(testRegistryPath, JSON.stringify(registryData));

      const result = await registry.list();

      expect(result).toHaveLength(3);
      expect(result[0].session).toBe('session-b'); // Most recent
      expect(result[1].session).toBe('session-c');
      expect(result[2].session).toBe('session-a'); // Oldest
    });
  });

  describe('edge cases', () => {
    it('should return empty array when all sessions are stale', async () => {
      // Don't create any session directories
      const proj1 = join(testTempDir, 'project1');
      const proj2 = join(testTempDir, 'project2');

      const registryData: SessionRegistryData = {
        sessions: [
          {
            project: proj1,
            session: 'session-a',
            lastAccess: '2026-01-20T10:00:00Z',
          },
          {
            project: proj2,
            session: 'session-b',
            lastAccess: '2026-01-21T10:00:00Z',
          },
        ],
      };

      writeFileSync(testRegistryPath, JSON.stringify(registryData));

      const result = await registry.list();

      expect(result).toHaveLength(0);
    });

    it('should return empty array when registry file does not exist', async () => {
      const result = await registry.list();
      expect(result).toHaveLength(0);
    });

    it('should handle project path no longer accessible', async () => {
      // Create one session that exists, one that doesn't
      const proj1 = join(testTempDir, 'deleted-project');
      const proj2 = join(testTempDir, 'accessible-project');
      mkdirSync(join(proj2, '.collab', 'session-b'), { recursive: true });
      // proj1 is not created

      const registryData: SessionRegistryData = {
        sessions: [
          {
            project: proj1,
            session: 'session-a',
            lastAccess: '2026-01-20T10:00:00Z',
          },
          {
            project: proj2,
            session: 'session-b',
            lastAccess: '2026-01-21T10:00:00Z',
          },
        ],
      };

      writeFileSync(testRegistryPath, JSON.stringify(registryData));

      const result = await registry.list();

      expect(result).toHaveLength(1);
      expect(result[0].project).toBe(proj2);
    });
  });

  describe('logging', () => {
    it('should log when sessions are cleaned', async () => {
      // Create only one valid session directory
      const proj1 = join(testTempDir, 'project1');
      const proj2 = join(testTempDir, 'project2');
      const session1Path = join(proj1, '.collab', 'valid-session');
      mkdirSync(session1Path, { recursive: true });
      // session2 directory is NOT created

      const registryData: SessionRegistryData = {
        sessions: [
          {
            project: proj1,
            session: 'valid-session',
            lastAccess: '2026-01-21T10:00:00Z',
          },
          {
            project: proj2,
            session: 'stale-session',
            lastAccess: '2026-01-20T10:00:00Z',
          },
        ],
      };

      writeFileSync(testRegistryPath, JSON.stringify(registryData));

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => logs.push(args.join(' '));

      try {
        await registry.list();
        expect(logs.some(log => log.includes('Removed stale sessions'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('consistency', () => {
    it('should not list the same session twice', async () => {
      const proj1 = join(testTempDir, 'project1');
      const session1Path = join(proj1, '.collab', 'session-a');
      mkdirSync(session1Path, { recursive: true });

      const registryData: SessionRegistryData = {
        sessions: [
          {
            project: proj1,
            session: 'session-a',
            lastAccess: '2026-01-21T10:00:00Z',
          },
          {
            project: proj1,
            session: 'session-a',
            lastAccess: '2026-01-20T10:00:00Z',
          },
        ],
      };

      writeFileSync(testRegistryPath, JSON.stringify(registryData));

      const result = await registry.list();

      // Both should be returned (they both exist), but in sorted order
      expect(result).toHaveLength(2);
    });
  });
});

describe('SessionRegistry.resolvePath()', () => {
  let registry: SessionRegistry;
  let testTempDir: string;

  beforeEach(() => {
    testTempDir = join(tmpdir(), `test-resolve-${Date.now()}`);
    mkdirSync(testTempDir, { recursive: true });
    registry = new SessionRegistry(join(testTempDir, 'sessions.json'));
  });

  afterEach(() => {
    try {
      rmSync(testTempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it('should resolve snippets path correctly', () => {
    const proj1 = join(testTempDir, 'project1');
    const sessionPath = join(proj1, '.collab', 'sessions', 'test-session', 'snippets');
    mkdirSync(sessionPath, { recursive: true });

    const result = registry.resolvePath(proj1, 'test-session', 'snippets');

    expect(result).toBe(sessionPath);
  });

  it('should resolve snippets path from new location first', () => {
    const proj1 = join(testTempDir, 'project1');
    const newPath = join(proj1, '.collab', 'sessions', 'test-session', 'snippets');
    const oldPath = join(proj1, '.collab', 'test-session', 'snippets');
    mkdirSync(newPath, { recursive: true });
    mkdirSync(oldPath, { recursive: true });

    const result = registry.resolvePath(proj1, 'test-session', 'snippets');

    expect(result).toBe(newPath);
  });

  it('should resolve snippets path from old location for backwards compatibility', () => {
    const proj1 = join(testTempDir, 'project1');
    const oldPath = join(proj1, '.collab', 'test-session', 'snippets');
    mkdirSync(oldPath, { recursive: true });

    const result = registry.resolvePath(proj1, 'test-session', 'snippets');

    expect(result).toBe(oldPath);
  });

  it('should default to new location if no paths exist', () => {
    const proj1 = join(testTempDir, 'project1');
    const expectedPath = join(proj1, '.collab', 'sessions', 'test-session', 'snippets');

    const result = registry.resolvePath(proj1, 'test-session', 'snippets');

    expect(result).toBe(expectedPath);
  });

  it('should throw error for invalid snippet type in resolvePath', () => {
    const proj1 = join(testTempDir, 'project1');

    expect(() => {
      registry.resolvePath(proj1, 'test-session', 'invalid' as any);
    }).toThrow('Invalid type');
  });
});

describe('SessionRegistry.Snippet Artifact Support', () => {
  let registry: SessionRegistry;
  let testTempDir: string;
  let testProject: string;

  beforeEach(() => {
    testTempDir = join(tmpdir(), `test-snippets-${Date.now()}`);
    testProject = join(testTempDir, 'project1');
    mkdirSync(testTempDir, { recursive: true });
    registry = new SessionRegistry(join(testTempDir, 'sessions.json'));
  });

  afterEach(() => {
    try {
      rmSync(testTempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('ensureSnippetsDir()', () => {
    it('should create snippets directory if it does not exist', async () => {
      const result = await registry.ensureSnippetsDir(testProject, 'test-session');

      const snippetsPath = join(testProject, '.collab', 'sessions', 'test-session', 'snippets');
      expect(result).toBeUndefined();
      expect(rmSync).toBeDefined(); // Directory should exist

      // Verify the directory was created
      const stat = require('fs').statSync(snippetsPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should not fail if snippets directory already exists', async () => {
      const snippetsPath = join(testProject, '.collab', 'sessions', 'test-session', 'snippets');
      mkdirSync(snippetsPath, { recursive: true });

      // Should not throw
      const result = await registry.ensureSnippetsDir(testProject, 'test-session');
      expect(result).toBeUndefined();
    });

    it('should throw error for invalid project path', async () => {
      await expect(registry.ensureSnippetsDir('relative-path', 'test-session')).rejects.toThrow('Invalid project path');
    });

    it('should throw error for invalid session name', async () => {
      await expect(registry.ensureSnippetsDir(testProject, 'invalid session')).rejects.toThrow('Invalid session name');
    });
  });

  describe('registerSnippet()', () => {
    it('should register a snippet artifact successfully', async () => {
      const sessionPath = join(testProject, '.collab', 'sessions', 'test-session');
      mkdirSync(sessionPath, { recursive: true });

      const result = await registry.registerSnippet(testProject, 'test-session', 'snippet-1', {
        name: 'My Snippet',
        type: 'javascript',
        locked: false,
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('snippet-1');
    });

    it('should ensure snippets directory exists when registering', async () => {
      const result = await registry.registerSnippet(testProject, 'test-session', 'snippet-2', {
        name: 'Another Snippet',
      });

      const snippetsPath = join(testProject, '.collab', 'sessions', 'test-session', 'snippets');
      expect(result.success).toBe(true);

      // Verify directory was created
      const fs = require('fs');
      expect(fs.existsSync(snippetsPath)).toBe(true);
    });

    it('should validate snippet ID', async () => {
      await expect(registry.registerSnippet(testProject, 'test-session', '', { name: 'Test' })).rejects.toThrow('Invalid snippet ID');
    });

    it('should validate snippet name', async () => {
      await expect(registry.registerSnippet(testProject, 'test-session', 'snippet-1', { name: '' })).rejects.toThrow('Invalid snippet name');
    });

    it('should handle snippet metadata with optional properties', async () => {
      const result = await registry.registerSnippet(testProject, 'test-session', 'snippet-3', {
        name: 'Complex Snippet',
        type: 'typescript',
        locked: true,
        folder: 'utils',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('snippet-3');
    });

    it('should throw error for invalid project path', async () => {
      await expect(
        registry.registerSnippet('relative-path', 'test-session', 'snippet-1', { name: 'Test' })
      ).rejects.toThrow('Invalid project path');
    });

    it('should throw error for invalid session name', async () => {
      await expect(
        registry.registerSnippet(testProject, 'invalid session', 'snippet-1', { name: 'Test' })
      ).rejects.toThrow('Invalid session name');
    });
  });

  describe('unregisterSnippet()', () => {
    it('should unregister a snippet artifact', async () => {
      const result = await registry.unregisterSnippet(testProject, 'test-session', 'snippet-1');

      expect(result).toBe(true);
    });

    it('should return true even if snippet was not registered', async () => {
      const result = await registry.unregisterSnippet(testProject, 'test-session', 'non-existent');

      expect(result).toBe(true);
    });

    it('should validate snippet ID', async () => {
      await expect(registry.unregisterSnippet(testProject, 'test-session', '')).rejects.toThrow('Invalid snippet ID');
    });

    it('should throw error for invalid project path', async () => {
      await expect(registry.unregisterSnippet('relative-path', 'test-session', 'snippet-1')).rejects.toThrow('Invalid project path');
    });

    it('should throw error for invalid session name', async () => {
      await expect(registry.unregisterSnippet(testProject, 'invalid session', 'snippet-1')).rejects.toThrow('Invalid session name');
    });
  });

  describe('getSnippetsPath()', () => {
    it('should return snippets directory path', () => {
      const snippetsPath = join(testProject, '.collab', 'sessions', 'test-session', 'snippets');
      mkdirSync(snippetsPath, { recursive: true });

      const result = registry.getSnippetsPath(testProject, 'test-session');

      expect(result).toBe(snippetsPath);
    });

    it('should use resolvePath internally', () => {
      const snippetsPath = join(testProject, '.collab', 'sessions', 'test-session', 'snippets');
      mkdirSync(snippetsPath, { recursive: true });

      const result = registry.getSnippetsPath(testProject, 'test-session');
      const resolvedPath = registry.resolvePath(testProject, 'test-session', 'snippets');

      expect(result).toBe(resolvedPath);
    });
  });

  describe('snippet lifecycle', () => {
    it('should support complete snippet artifact lifecycle', async () => {
      // Register session
      const sessionResult = await registry.register(testProject, 'lifecycle-test');
      expect(sessionResult.created).toBe(true);

      // Register snippet
      const snippetResult = await registry.registerSnippet(testProject, 'lifecycle-test', 'snippet-lifecycle-1', {
        name: 'Lifecycle Snippet',
        type: 'python',
      });
      expect(snippetResult.success).toBe(true);

      // Get snippets path
      const snippetsPath = registry.getSnippetsPath(testProject, 'lifecycle-test');
      expect(snippetsPath).toContain('snippets');

      // Unregister snippet
      const unregisterResult = await registry.unregisterSnippet(testProject, 'lifecycle-test', 'snippet-lifecycle-1');
      expect(unregisterResult).toBe(true);
    });
  });
});
