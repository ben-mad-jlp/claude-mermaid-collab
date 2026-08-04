import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

describe('watched-session worker-guard', () => {
  describe('store guard — addWatchedSession rejects worker-named sessions', () => {
    beforeEach(() => {
      delete require.cache[require.resolve('../supervisor-store')];
    });

    it('addWatchedSession rejects worker-abc123, worker_x, and WORKER-1', () => {
      const testDir = mkdtempSync(join(tmpdir(), 'mc-worker-guard-store-'));
      process.env.MERMAID_SUPERVISOR_DIR = testDir;
      delete require.cache[require.resolve('../supervisor-store')];
      const { addWatchedSession, listWatchedSessions, isWatchedSession } = require('../supervisor-store');

      // Try to add worker-named sessions — all should be rejected (no row written).
      addWatchedSession('test-project', 'worker-abc123');
      addWatchedSession('test-project', 'worker_x');
      addWatchedSession('test-project', 'WORKER-1');

      // Verify no rows were written for worker sessions.
      const sessions = listWatchedSessions();
      expect(sessions.length).toBe(0);

      // Verify isWatchedSession returns false for all of them.
      expect(isWatchedSession('test-project', 'worker-abc123')).toBe(false);
      expect(isWatchedSession('test-project', 'worker_x')).toBe(false);
      expect(isWatchedSession('test-project', 'WORKER-1')).toBe(false);
    });

    it('addWatchedSession accepts workerbee-1 and planner-1 (token-boundary cases)', () => {
      const testDir = mkdtempSync(join(tmpdir(), 'mc-worker-guard-lookalike-'));
      process.env.MERMAID_SUPERVISOR_DIR = testDir;
      delete require.cache[require.resolve('../supervisor-store')];
      const { addWatchedSession, isWatchedSession } = require('../supervisor-store');

      // Token boundary: first token is NOT 'worker', so these should be accepted.
      addWatchedSession('test-project', 'workerbee-1');
      addWatchedSession('test-project', 'planner-1');

      // Verify both are written and queryable.
      expect(isWatchedSession('test-project', 'workerbee-1')).toBe(true);
      expect(isWatchedSession('test-project', 'planner-1')).toBe(true);
    });

    it('addWatchedSession INSERT OR IGNORE dedup still works for non-worker sessions', () => {
      const testDir = mkdtempSync(join(tmpdir(), 'mc-worker-guard-dedup-'));
      process.env.MERMAID_SUPERVISOR_DIR = testDir;
      delete require.cache[require.resolve('../supervisor-store')];
      const { addWatchedSession, listWatchedSessions } = require('../supervisor-store');

      // Add the same non-worker session twice.
      addWatchedSession('test-project', 'normal-session');
      addWatchedSession('test-project', 'normal-session');

      // Verify only one row exists (INSERT OR IGNORE dedup).
      const sessions = listWatchedSessions();
      const normalSessions = sessions.filter((s: any) => s.session === 'normal-session');
      expect(normalSessions.length).toBe(1);
    });
  });

  describe('route guard — POST /api/supervisor/supervised rejects worker sessions', () => {
    beforeEach(() => {
      delete require.cache[require.resolve('../supervisor-store')];
      delete require.cache[require.resolve('../../routes/supervisor-routes')];
    });

    it('POST /api/supervisor/supervised with worker-abc123 returns 400 and writes no row', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'mc-worker-guard-route-'));
      process.env.MERMAID_SUPERVISOR_DIR = testDir;
      delete require.cache[require.resolve('../supervisor-store')];
      delete require.cache[require.resolve('../../routes/supervisor-routes')];

      const { handleSupervisorRoutes } = require('../../routes/supervisor-routes');

      // Simulate POST /api/supervisor/supervised with a worker-named session.
      const req = new Request('http://localhost/api/supervisor/supervised', {
        method: 'POST',
        body: JSON.stringify({
          project: 'test-project',
          session: 'worker-abc123'
        })
      });

      const url = new URL(req.url);
      const response = await handleSupervisorRoutes(req, url);

      // Verify the response is 400.
      expect(response?.status).toBe(400);
      const responseBody = await response?.json();
      expect(responseBody?.error).toBe('worker sessions are not watchable');

      // Verify no row was written to the DB by checking with listWatchedSessions.
      const { listWatchedSessions } = require('../supervisor-store');
      const sessions = listWatchedSessions();
      expect(sessions.length).toBe(0);
    });

    it('POST /api/supervisor/supervised with normal-session-1 succeeds and writes a row', async () => {
      const testDir = mkdtempSync(join(tmpdir(), 'mc-worker-guard-route-normal-'));
      process.env.MERMAID_SUPERVISOR_DIR = testDir;
      delete require.cache[require.resolve('../supervisor-store')];
      delete require.cache[require.resolve('../../routes/supervisor-routes')];

      const { handleSupervisorRoutes } = require('../../routes/supervisor-routes');

      // Simulate POST /api/supervisor/supervised with a normal session.
      const req = new Request('http://localhost/api/supervisor/supervised', {
        method: 'POST',
        body: JSON.stringify({
          project: 'test-project',
          session: 'normal-session-1'
        })
      });

      const url = new URL(req.url);
      const response = await handleSupervisorRoutes(req, url);

      // Verify the response is 200 (success).
      expect(response?.status).toBe(200);

      // Verify the row was written to the DB by checking with isWatchedSession.
      const { isWatchedSession } = require('../supervisor-store');
      expect(isWatchedSession('test-project', 'normal-session-1')).toBe(true);
    });
  });
});
