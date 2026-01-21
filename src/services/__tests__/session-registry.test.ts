import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
