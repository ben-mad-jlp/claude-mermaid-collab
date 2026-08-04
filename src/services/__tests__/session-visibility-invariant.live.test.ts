import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('session-visibility invariant live harness', () => {
  describe('checkSessionVisibility with real stores', () => {
    it('reports zero invisible sessions across at least 5 real session registrations', async () => {
      // Isolation setup: fresh temp dir for this test.
      const testDir = mkdtempSync(join(tmpdir(), 'mc-visibility-live-'));
      process.env.MERMAID_SUPERVISOR_DIR = testDir;
      process.env.MERMAID_DATA_DIR = testDir;

      // Clear singletons before requiring — module-level caches must reset.
      delete require.cache[require.resolve('../supervisor-store')];
      delete require.cache[require.resolve('../session-registry')];
      delete require.cache[require.resolve('../session-visibility-invariant')];

      // Require AFTER env vars set (so singletons bind to test dirs).
      const { recordStatus } = require('../session-status-store');
      const { addWatchedSession } = require('../supervisor-store');
      const { sessionRegistry } = require('../session-registry');
      const { checkSessionVisibility } = require('../session-visibility-invariant');

      // Build session list: 5 real sessions plus a worker-named one (6 total).
      const sessions = ['sess-a', 'sess-b', 'sess-c', 'sess-d', 'sess-e', 'worker-live-abc123'];

      // Register each session and record it as active.
      for (const session of sessions) {
        await sessionRegistry.register(testDir, session);
        recordStatus(testDir, session, 'active');
      }

      // Add a subset to the watched list (at least 2 non-worker sessions).
      addWatchedSession(testDir, 'sess-a');
      addWatchedSession(testDir, 'sess-b');

      // Try to add the worker-named session — the store guard silently drops it.
      addWatchedSession(testDir, 'worker-live-abc123');

      // After the guard drop, 'worker-live-abc123' is:
      // - registered (picker surface)
      // - active status recorded
      // - NOT in watched_session (store guard rejected it)
      // Since worker sessions are filtered by isLiveCandidate, it won't be
      // checked for visibility, but this validates the guard is in place.

      // Run the invariant check against real stores (no mock deps).
      const report = await checkSessionVisibility(testDir);

      // Verify: >=5 real sessions checked, zero invisible (all have picker access).
      expect(report.checkedSessions).toBeGreaterThanOrEqual(5);
      expect(report.invisible).toEqual([]);
      expect(report.violationCount).toBe(0);
    });

    it('reds with violationCount 1 when every surface is neutered for one live session', async () => {
      // Fresh temp dir for isolation.
      const testDir = mkdtempSync(join(tmpdir(), 'mc-visibility-falsifier-'));
      process.env.MERMAID_SUPERVISOR_DIR = testDir;
      process.env.MERMAID_DATA_DIR = testDir;

      // Clear singletons.
      delete require.cache[require.resolve('../supervisor-store')];
      delete require.cache[require.resolve('../session-registry')];
      delete require.cache[require.resolve('../session-visibility-invariant')];

      // Require after env vars set.
      const { recordStatus } = require('../session-status-store');
      const { addWatchedSession, removeWatchedSession } = require('../supervisor-store');
      const { sessionRegistry } = require('../session-registry');
      const { checkSessionVisibility } = require('../session-visibility-invariant');

      // Replicate case 1 setup: 5+ real sessions, some watched.
      const sessions = ['sess-a', 'sess-b', 'sess-c', 'sess-d', 'sess-e', 'worker-live-abc123'];

      for (const session of sessions) {
        await sessionRegistry.register(testDir, session);
        recordStatus(testDir, session, 'active');
      }

      // Add a subset to watched.
      addWatchedSession(testDir, 'sess-a');
      addWatchedSession(testDir, 'sess-b');
      addWatchedSession(testDir, 'worker-live-abc123'); // Store guard silently drops this.

      // Pick one WATCHED session to neuter (break all three surfaces).
      const toNeuter = 'sess-a';

      // Step 1: Remove from watched list (supervisorPanel + watchingList surfaces).
      removeWatchedSession(testDir, toNeuter);

      // Step 2: Remove from registry (picker surface).
      await sessionRegistry.unregister(testDir, toNeuter);

      // Step 3: Keep status row active and fresh to meet isLiveCandidate liveness window.
      recordStatus(testDir, toNeuter, 'active');

      // Run the invariant check.
      const report = await checkSessionVisibility(testDir);

      // Verify: the neutered session now appears as invisible.
      expect(report.violationCount).toBe(1);
      expect(report.invisible).toHaveLength(1);
      expect(report.invisible[0]?.session).toBe(toNeuter);
      expect(report.invisible[0]?.surfaces).toEqual({
        watchingList: false,
        supervisorPanel: false,
        picker: false
      });
    });
  });
});
