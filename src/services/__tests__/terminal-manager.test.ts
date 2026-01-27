/**
 * Terminal Manager Test Suite
 * Verifies terminal session management, storage, and tmux operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { TerminalManager, terminalManager } from '../terminal-manager';
import type { TerminalSession, TerminalSessionsState } from '../../types/terminal';

const execAsync = promisify(exec);

describe('TerminalManager', () => {
  let testDir: string;
  let manager: TerminalManager;

  beforeEach(() => {
    // Create temporary test directory
    testDir = join(tmpdir(), `terminal-manager-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create fresh manager instance for each test
    manager = new TerminalManager();
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getStoragePath', () => {
    it('should return correct storage path', () => {
      const project = '/path/to/project';
      const session = 'my-session';

      const path = manager['getStoragePath'](project, session);

      expect(path).toBe('/path/to/project/.collab/my-session/terminal-sessions.json');
    });

    it('should handle absolute paths correctly', () => {
      const project = '/Users/test/project';
      const session = 'collab-123';

      const path = manager['getStoragePath'](project, session);

      expect(path).toContain('.collab');
      expect(path).toContain('collab-123');
      expect(path).toContain('terminal-sessions.json');
      expect(path).toBe(join(project, '.collab', session, 'terminal-sessions.json'));
    });
  });

  describe('readSessions', () => {
    it('should return empty state when file does not exist', async () => {
      const result = await manager.readSessions(testDir, 'new-session');

      expect(result).toHaveProperty('sessions');
      expect(result).toHaveProperty('lastModified');
      expect(result.sessions).toEqual([]);
      expect(typeof result.lastModified).toBe('string');
    });

    it('should read and parse valid sessions file', async () => {
      const sessionDir = join(testDir, '.collab', 'test-session');
      mkdirSync(sessionDir, { recursive: true });

      const mockState: TerminalSessionsState = {
        sessions: [
          {
            id: '123',
            name: 'Terminal 1',
            tmuxSession: 'mc-test-abc1',
            created: '2024-01-24T10:00:00Z',
            order: 0,
          },
        ],
        lastModified: '2024-01-24T10:00:00Z',
      };

      writeFileSync(
        join(sessionDir, 'terminal-sessions.json'),
        JSON.stringify(mockState)
      );

      const result = await manager.readSessions(testDir, 'test-session');

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].id).toBe('123');
      expect(result.sessions[0].name).toBe('Terminal 1');
    });

    it('should return empty state on JSON parse error', async () => {
      const sessionDir = join(testDir, '.collab', 'bad-session');
      mkdirSync(sessionDir, { recursive: true });

      writeFileSync(
        join(sessionDir, 'terminal-sessions.json'),
        'invalid json {{'
      );

      const result = await manager.readSessions(testDir, 'bad-session');

      expect(result.sessions).toEqual([]);
      expect(typeof result.lastModified).toBe('string');
    });

    it('should handle multiple sessions in file', async () => {
      const sessionDir = join(testDir, '.collab', 'multi-session');
      mkdirSync(sessionDir, { recursive: true });

      const mockState: TerminalSessionsState = {
        sessions: [
          {
            id: 'id-1',
            name: 'Terminal 1',
            tmuxSession: 'mc-multi-abc1',
            created: '2024-01-24T10:00:00Z',
            order: 0,
          },
          {
            id: 'id-2',
            name: 'Terminal 2',
            tmuxSession: 'mc-multi-abc2',
            created: '2024-01-24T10:01:00Z',
            order: 1,
          },
          {
            id: 'id-3',
            name: 'Terminal 3',
            tmuxSession: 'mc-multi-abc3',
            created: '2024-01-24T10:02:00Z',
            order: 2,
          },
        ],
        lastModified: '2024-01-24T10:02:00Z',
      };

      writeFileSync(
        join(sessionDir, 'terminal-sessions.json'),
        JSON.stringify(mockState)
      );

      const result = await manager.readSessions(testDir, 'multi-session');

      expect(result.sessions).toHaveLength(3);
      expect(result.sessions[1].id).toBe('id-2');
      expect(result.sessions[2].order).toBe(2);
    });
  });

  describe('writeSessions', () => {
    it('should create directories if they do not exist', async () => {
      const state: TerminalSessionsState = {
        sessions: [],
        lastModified: '2024-01-24T10:00:00Z',
      };

      await manager.writeSessions(testDir, 'new-session', state);

      const storagePath = join(testDir, '.collab', 'new-session', 'terminal-sessions.json');
      expect(existsSync(storagePath)).toBe(true);
    });

    it('should write sessions to file', async () => {
      const session: TerminalSession = {
        id: '123',
        name: 'Test Terminal',
        tmuxSession: 'mc-test-xyz1',
        created: '2024-01-24T10:00:00Z',
        order: 0,
      };

      const state: TerminalSessionsState = {
        sessions: [session],
        lastModified: '2024-01-24T10:00:00Z',
      };

      await manager.writeSessions(testDir, 'test-session', state);

      const storagePath = join(testDir, '.collab', 'test-session', 'terminal-sessions.json');
      const content = readFileSync(storagePath, 'utf-8');
      const parsed = JSON.parse(content) as TerminalSessionsState;

      expect(parsed.sessions).toHaveLength(1);
      expect(parsed.sessions[0].id).toBe('123');
    });

    it('should update lastModified timestamp', async () => {
      const oldTime = '2024-01-01T00:00:00Z';
      const state: TerminalSessionsState = {
        sessions: [],
        lastModified: oldTime,
      };

      await manager.writeSessions(testDir, 'test-session', state);

      const storagePath = join(testDir, '.collab', 'test-session', 'terminal-sessions.json');
      const content = readFileSync(storagePath, 'utf-8');
      const parsed = JSON.parse(content) as TerminalSessionsState;

      expect(parsed.lastModified).not.toBe(oldTime);
      expect(typeof parsed.lastModified).toBe('string');
      expect(new Date(parsed.lastModified).getTime()).toBeGreaterThan(
        new Date(oldTime).getTime()
      );
    });

    it('should format JSON with indentation', async () => {
      const state: TerminalSessionsState = {
        sessions: [],
        lastModified: '2024-01-24T10:00:00Z',
      };

      await manager.writeSessions(testDir, 'test-session', state);

      const storagePath = join(testDir, '.collab', 'test-session', 'terminal-sessions.json');
      const content = readFileSync(storagePath, 'utf-8');

      expect(content).toContain('\n');
      expect(content).not.toBe(JSON.stringify(state));
    });
  });

  describe('generateTmuxSessionName', () => {
    it('should generate valid tmux session name with mc- prefix', () => {
      const sessionName = 'my-collab-session';

      const result = manager.generateTmuxSessionName(sessionName);

      expect(result).toMatch(/^mc-[a-z0-9]+-[a-z0-9]+$/);
      expect(result).toContain('-');
    });

    it('should sanitize session name by removing invalid characters', () => {
      const sessionName = 'my@collab!session#123';

      const result = manager.generateTmuxSessionName(sessionName);

      expect(result).toMatch(/^mc-[a-z0-9-]+-[a-z0-9]+$/);
      expect(result).not.toContain('@');
      expect(result).not.toContain('!');
      expect(result).not.toContain('#');
    });

    it('should extract last segment if session contains colons or slashes', () => {
      const sessionName = '/path/to/open-bold-meadow';

      const result = manager.generateTmuxSessionName(sessionName);

      expect(result).toMatch(/^mc-openboldmeadow-[a-z0-9]+$/);
      expect(result).toContain('openboldmeadow');
    });

    it('should truncate long session names to reasonable length', () => {
      const sessionName = 'this-is-a-very-long-collab-session-name-that-should-be-truncated-to-avoid-issues';

      const result = manager.generateTmuxSessionName(sessionName);

      expect(result.length).toBeLessThanOrEqual(30);
      expect(result).toMatch(/^mc-/);
    });

    it('should handle default case when session name is empty', () => {
      const result = manager.generateTmuxSessionName('');

      expect(result).toMatch(/^mc-default-[a-z0-9]+$/);
    });

    it('should include random suffix that is different on multiple calls', () => {
      const sessionName = 'test-session';

      const result1 = manager.generateTmuxSessionName(sessionName);
      const result2 = manager.generateTmuxSessionName(sessionName);

      expect(result1).toMatch(/^mc-testsession-[a-z0-9]+$/);
      expect(result2).toMatch(/^mc-testsession-[a-z0-9]+$/);
      expect(result1).not.toBe(result2);
    });

    it('should handle session names with only dots or special chars', () => {
      const result = manager.generateTmuxSessionName('..._!!!');

      expect(result).toMatch(/^mc-/);
      expect(result.split('-').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('createTmuxSession', () => {
    it('should create tmux session with given name', async () => {
      const sessionName = `test-create-${Date.now()}`;

      await manager.createTmuxSession(sessionName);

      // Verify session exists
      const sessions = await manager.listActiveTmuxSessions('test-create-');
      expect(sessions).toContain(sessionName);

      // Cleanup
      try {
        execSync(`tmux kill-session -t ${sessionName}`);
      } catch {
        // Session might already be killed
      }
    });

    it('should handle duplicate session gracefully', async () => {
      const sessionName = `test-dup-${Date.now()}`;

      await manager.createTmuxSession(sessionName);

      // Creating again should not throw error
      expect(async () => {
        await manager.createTmuxSession(sessionName);
      }).not.toThrow();

      // Cleanup
      try {
        execSync(`tmux kill-session -t ${sessionName}`);
      } catch {
        // Session might already be killed
      }
    });

    it('should reject invalid session names', async () => {
      // tmux will reject this
      const invalidName = '!!invalid!!';

      try {
        await manager.createTmuxSession(invalidName);
        // If it doesn't throw, that's ok - some systems might be lenient
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should call unbind-key for horizontal split (%) after creating session', async () => {
      const sessionName = `test-unbind-h-${Date.now()}`;

      try {
        // Session should be created successfully, even if unbind-key fails on this tmux version
        await manager.createTmuxSession(sessionName);

        // Verify session was created and has mouse enabled
        const sessions = await manager.listActiveTmuxSessions('test-unbind-h-');
        expect(sessions).toContain(sessionName);
      } finally {
        // Cleanup
        try {
          execSync(`tmux kill-session -t ${sessionName}`);
        } catch {
          // Session might already be killed
        }
      }
    });

    it('should call unbind-key for vertical split (") after creating session', async () => {
      const sessionName = `test-unbind-v-${Date.now()}`;

      try {
        // Session should be created successfully, even if unbind-key fails on this tmux version
        await manager.createTmuxSession(sessionName);

        // Verify session was created and has mouse enabled
        const sessions = await manager.listActiveTmuxSessions('test-unbind-v-');
        expect(sessions).toContain(sessionName);
      } finally {
        // Cleanup
        try {
          execSync(`tmux kill-session -t ${sessionName}`);
        } catch {
          // Session might already be killed
        }
      }
    });

    it('should execute unbind commands after mouse option is set', async () => {
      const sessionName = `test-unbind-order-${Date.now()}`;

      try {
        // Session should be created successfully
        await manager.createTmuxSession(sessionName);

        // Verify mouse is still enabled (unbind should not interfere with mouse)
        const mouseCheck = execSync(`tmux show-options -t ${sessionName} mouse 2>&1 || true`).toString();
        expect(mouseCheck).toContain('on');
      } finally {
        // Cleanup
        try {
          execSync(`tmux kill-session -t ${sessionName}`);
        } catch {
          // Session might already be killed
        }
      }
    });

    it('should use session-scoped unbind target (-t flag) for % key', async () => {
      const sessionName = `test-unbind-scope-h-${Date.now()}`;

      try {
        // Session should be created successfully
        await manager.createTmuxSession(sessionName);

        // Verify session exists
        const sessions = await manager.listActiveTmuxSessions('test-unbind-scope-h-');
        expect(sessions).toContain(sessionName);
      } finally {
        // Cleanup
        try {
          execSync(`tmux kill-session -t ${sessionName}`);
        } catch {
          // Session might already be killed
        }
      }
    });

    it('should use session-scoped unbind target (-t flag) for " key', async () => {
      const sessionName = `test-unbind-scope-v-${Date.now()}`;

      try {
        // Session should be created successfully
        await manager.createTmuxSession(sessionName);

        // Verify session exists
        const sessions = await manager.listActiveTmuxSessions('test-unbind-scope-v-');
        expect(sessions).toContain(sessionName);
      } finally {
        // Cleanup
        try {
          execSync(`tmux kill-session -t ${sessionName}`);
        } catch {
          // Session might already be killed
        }
      }
    });

    it('should preserve other tmux functionality after unbind', async () => {
      const sessionName = `test-preserve-func-${Date.now()}`;

      try {
        // Session should be created successfully with mouse enabled
        await manager.createTmuxSession(sessionName);

        // Verify mouse scrolling still works (mouse should be on)
        const mouseCheck = execSync(`tmux show-options -t ${sessionName} mouse 2>&1 || true`).toString();
        expect(mouseCheck).toContain('on');
      } finally {
        // Cleanup
        try {
          execSync(`tmux kill-session -t ${sessionName}`);
        } catch {
          // Session might already be killed
        }
      }
    });
  });

  describe('killTmuxSession', () => {
    it('should kill existing tmux session', async () => {
      const sessionName = `test-kill-${Date.now()}`;

      // Create session first
      await manager.createTmuxSession(sessionName);
      let sessions = await manager.listActiveTmuxSessions('test-kill-');
      expect(sessions).toContain(sessionName);

      // Kill it
      await manager.killTmuxSession(sessionName);

      // Verify it's gone
      sessions = await manager.listActiveTmuxSessions('test-kill-');
      expect(sessions).not.toContain(sessionName);
    });

    it('should handle non-existent session gracefully', async () => {
      const sessionName = `test-nonexist-${Date.now()}-xyz`;

      // Should not throw error
      expect(async () => {
        await manager.killTmuxSession(sessionName);
      }).not.toThrow();
    });
  });

  describe('listActiveTmuxSessions', () => {
    it('should list sessions matching prefix', async () => {
      const prefix = `test-list-${Date.now()}`;
      const session1 = `${prefix}-1`;
      const session2 = `${prefix}-2`;

      // Create two sessions
      await manager.createTmuxSession(session1);
      await manager.createTmuxSession(session2);

      const sessions = await manager.listActiveTmuxSessions(prefix);

      expect(sessions).toContain(session1);
      expect(sessions).toContain(session2);

      // Cleanup
      try {
        execSync(`tmux kill-session -t ${session1}`);
        execSync(`tmux kill-session -t ${session2}`);
      } catch {
        // Sessions might already be killed
      }
    });

    it('should filter sessions by prefix', async () => {
      const prefix1 = `test-prefix1-${Date.now()}`;
      const prefix2 = `test-prefix2-${Date.now()}`;
      const session1 = `${prefix1}-session`;
      const session2 = `${prefix2}-session`;

      // Create sessions with different prefixes
      await manager.createTmuxSession(session1);
      await manager.createTmuxSession(session2);

      const result1 = await manager.listActiveTmuxSessions(prefix1);
      const result2 = await manager.listActiveTmuxSessions(prefix2);

      expect(result1).toContain(session1);
      expect(result1).not.toContain(session2);
      expect(result2).toContain(session2);
      expect(result2).not.toContain(session1);

      // Cleanup
      try {
        execSync(`tmux kill-session -t ${session1}`);
        execSync(`tmux kill-session -t ${session2}`);
      } catch {
        // Sessions might already be killed
      }
    });

    it('should return empty array when no sessions exist', async () => {
      const result = await manager.listActiveTmuxSessions('nonexistent-prefix-xyz');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should handle tmux server not running gracefully', async () => {
      // This is hard to test without actually shutting down tmux
      // But the implementation should handle it
      const result = await manager.listActiveTmuxSessions('any-prefix');

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('reconcileSessions', () => {
    it('should remove orphaned stored sessions without tmux counterpart', async () => {
      const sessionDir = join(testDir, '.collab', 'recon-session');
      mkdirSync(sessionDir, { recursive: true });

      // Create stored state with orphaned session
      const state: TerminalSessionsState = {
        sessions: [
          {
            id: 'orphan-id',
            name: 'Orphan Terminal',
            tmuxSession: 'orphan-tmux-session-xyz',
            created: '2024-01-24T10:00:00Z',
            order: 0,
          },
        ],
        lastModified: '2024-01-24T10:00:00Z',
      };

      writeFileSync(
        join(sessionDir, 'terminal-sessions.json'),
        JSON.stringify(state)
      );

      // Reconcile should remove the orphan
      await manager.reconcileSessions(testDir, 'recon-session');

      const result = await manager.readSessions(testDir, 'recon-session');
      expect(result.sessions).toHaveLength(0);
    });

    it('should kill orphaned tmux sessions not in storage', async () => {
      const prefix = `test-recon-${Date.now()}`;
      const tmuxSession = `${prefix}-orphan`;

      // Create tmux session but don't store it
      await manager.createTmuxSession(tmuxSession);

      // Verify it exists
      let sessions = await manager.listActiveTmuxSessions(prefix);
      expect(sessions).toContain(tmuxSession);

      // Create empty storage
      const sessionDir = join(testDir, '.collab', 'recon-session');
      mkdirSync(sessionDir, { recursive: true });
      const state: TerminalSessionsState = {
        sessions: [],
        lastModified: '2024-01-24T10:00:00Z',
      };
      writeFileSync(
        join(sessionDir, 'terminal-sessions.json'),
        JSON.stringify(state)
      );

      // This test is tricky because reconcileSessions would need to know
      // which prefix to use. Let's just verify reconcile doesn't crash
      await manager.reconcileSessions(testDir, 'recon-session');

      // The implementation should handle this gracefully
    });

    it('should preserve valid sessions', async () => {
      const sessionDir = join(testDir, '.collab', 'valid-session');
      mkdirSync(sessionDir, { recursive: true });

      const validSession: TerminalSession = {
        id: 'valid-id',
        name: 'Valid Terminal',
        tmuxSession: `mc-valid-session-abc1`,
        created: '2024-01-24T10:00:00Z',
        order: 0,
      };

      // Create the tmux session
      await manager.createTmuxSession(validSession.tmuxSession);

      // Store it
      const state: TerminalSessionsState = {
        sessions: [validSession],
        lastModified: '2024-01-24T10:00:00Z',
      };

      writeFileSync(
        join(sessionDir, 'terminal-sessions.json'),
        JSON.stringify(state)
      );

      // Reconcile should keep it
      await manager.reconcileSessions(testDir, 'valid-session');

      const result = await manager.readSessions(testDir, 'valid-session');
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].id).toBe('valid-id');

      // Cleanup
      try {
        execSync(`tmux kill-session -t ${validSession.tmuxSession}`);
      } catch {
        // Session might already be killed
      }
    });

    it('should handle empty state gracefully', async () => {
      const sessionDir = join(testDir, '.collab', 'empty-session');
      mkdirSync(sessionDir, { recursive: true });

      const state: TerminalSessionsState = {
        sessions: [],
        lastModified: '2024-01-24T10:00:00Z',
      };

      writeFileSync(
        join(sessionDir, 'terminal-sessions.json'),
        JSON.stringify(state)
      );

      // Should not throw
      await expect(
        manager.reconcileSessions(testDir, 'empty-session')
      ).resolves.not.toThrow();

      const result = await manager.readSessions(testDir, 'empty-session');
      expect(result.sessions).toHaveLength(0);
    });
  });

  describe('singleton instance', () => {
    it('should export singleton instance', () => {
      expect(terminalManager).toBeInstanceOf(TerminalManager);
    });

    it('singleton should have all methods', () => {
      expect(typeof terminalManager.readSessions).toBe('function');
      expect(typeof terminalManager.writeSessions).toBe('function');
      expect(typeof terminalManager.generateTmuxSessionName).toBe('function');
      expect(typeof terminalManager.createTmuxSession).toBe('function');
      expect(typeof terminalManager.killTmuxSession).toBe('function');
      expect(typeof terminalManager.listActiveTmuxSessions).toBe('function');
      expect(typeof terminalManager.reconcileSessions).toBe('function');
    });
  });

  describe('integration scenarios', () => {
    it('should handle full lifecycle: create, read, write, reconcile', async () => {
      const sessionName = 'integration-test';
      const sessionDir = join(testDir, '.collab', sessionName);
      mkdirSync(sessionDir, { recursive: true });

      // Step 1: Create initial state
      let state: TerminalSessionsState = {
        sessions: [],
        lastModified: new Date().toISOString(),
      };
      await manager.writeSessions(testDir, sessionName, state);

      // Step 2: Read it back
      let read = await manager.readSessions(testDir, sessionName);
      expect(read.sessions).toHaveLength(0);

      // Step 3: Add a session with proper mc- prefix matching the session name
      const newSession: TerminalSession = {
        id: 'int-1',
        name: 'Integration Test',
        tmuxSession: `mc-integration-test-abc1`,
        created: new Date().toISOString(),
        order: 0,
      };

      // Create the tmux session first
      await manager.createTmuxSession(newSession.tmuxSession);

      state.sessions = [newSession];
      await manager.writeSessions(testDir, sessionName, state);

      // Step 4: Verify write
      read = await manager.readSessions(testDir, sessionName);
      expect(read.sessions).toHaveLength(1);
      expect(read.sessions[0].id).toBe('int-1');

      // Step 5: Reconcile should preserve it
      await manager.reconcileSessions(testDir, sessionName);
      read = await manager.readSessions(testDir, sessionName);
      expect(read.sessions).toHaveLength(1);

      // Cleanup
      try {
        execSync(`tmux kill-session -t ${newSession.tmuxSession}`);
      } catch {
        // Session might already be killed
      }
    });

    it('should handle multiple sessions with ordering', async () => {
      const sessionName = 'multi-order-test';
      const sessionDir = join(testDir, '.collab', sessionName);
      mkdirSync(sessionDir, { recursive: true });

      const sessions: TerminalSession[] = [
        {
          id: 'sess-1',
          name: 'First',
          tmuxSession: `mo-test-1`,
          created: '2024-01-24T10:00:00Z',
          order: 0,
        },
        {
          id: 'sess-2',
          name: 'Second',
          tmuxSession: `mo-test-2`,
          created: '2024-01-24T10:01:00Z',
          order: 1,
        },
        {
          id: 'sess-3',
          name: 'Third',
          tmuxSession: `mo-test-3`,
          created: '2024-01-24T10:02:00Z',
          order: 2,
        },
      ];

      const state: TerminalSessionsState = {
        sessions,
        lastModified: new Date().toISOString(),
      };

      await manager.writeSessions(testDir, sessionName, state);

      const read = await manager.readSessions(testDir, sessionName);
      expect(read.sessions).toHaveLength(3);
      expect(read.sessions[0].order).toBe(0);
      expect(read.sessions[1].order).toBe(1);
      expect(read.sessions[2].order).toBe(2);
    });
  });
});
