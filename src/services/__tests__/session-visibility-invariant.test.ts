import { describe, it, expect } from 'bun:test';
import type { SessionStatusRow } from '../session-status-store';
import type { WatchedSession } from '../supervisor-store';
import type { SessionVisibilitySources } from '../session-visibility-invariant';
import {
  LIVE_WINDOW_MS,
  findInvisibleLiveSessions,
  summarizeSessionVisibility,
} from '../session-visibility-invariant';

/**
 * Fixed "now" for deterministic test assertions.
 */
const NOW = 1_800_000_000_000;

/**
 * Build a minimal SessionStatusRow with default placeholder values for fields
 * the invariant module doesn't read (contextPercent, contextUpdatedAt, checkpointReadyAt).
 */
function makeStatusRow(overrides: Partial<SessionStatusRow>): SessionStatusRow {
  return {
    project: 'test-project',
    session: 'test-session',
    status: 'active',
    updatedAt: NOW,
    contextPercent: null,
    contextUpdatedAt: null,
    checkpointReadyAt: null,
    ...overrides,
  };
}

describe('session-visibility-invariant', () => {
  describe('findInvisibleLiveSessions', () => {
    it('reports a live session on watched-only as not a violation', () => {
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-a',
            session: 'sess-1',
          }),
        ],
        watched: [
          { project: 'proj-a', session: 'sess-1', addedAt: NOW - 1000, serverId: '' },
        ],
        registrySessions: [],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);
      expect(invisible).toHaveLength(0);
    });

    it('reports a live session on registry-only as not a violation', () => {
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-b',
            session: 'sess-2',
          }),
        ],
        watched: [],
        registrySessions: [{ project: 'proj-b', session: 'sess-2' }],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);
      expect(invisible).toHaveLength(0);
    });

    it('reports a live session on both watched and registry as not a violation', () => {
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-c',
            session: 'sess-3',
          }),
        ],
        watched: [
          { project: 'proj-c', session: 'sess-3', addedAt: NOW - 1000, serverId: '' },
        ],
        registrySessions: [{ project: 'proj-c', session: 'sess-3' }],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);
      expect(invisible).toHaveLength(0);
    });

    it('excludes a worker-named live session from violations', () => {
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-d',
            session: 'worker-abc123',
          }),
        ],
        watched: [],
        registrySessions: [],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);
      expect(invisible).toHaveLength(0);
    });

    it('excludes a live status older than LIVE_WINDOW_MS from violations', () => {
      const oldTime = NOW - LIVE_WINDOW_MS - 1000; // 1 second older than the window
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-e',
            session: 'sess-5',
            updatedAt: oldTime,
          }),
        ],
        watched: [],
        registrySessions: [],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);
      expect(invisible).toHaveLength(0);
    });

    it('reports exactly one violation for a live session on no surface', () => {
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-f',
            session: 'sess-6',
          }),
        ],
        watched: [],
        registrySessions: [],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);
      expect(invisible).toHaveLength(1);
      expect(invisible[0]).toMatchObject({
        project: 'proj-f',
        session: 'sess-6',
        status: 'active',
        surfaces: {
          watchingList: false,
          supervisorPanel: false,
          picker: false,
        },
      });
    });

    it('reports every live non-worker session when both surfaces are empty (mutation-sensitivity probe)', () => {
      // Build a single statuses array with:
      // (a) watched-only: should NOT appear in invisible (has watchingList=true)
      // (b) registry-only: should NOT appear in invisible (has picker=true)
      // (c) both: should NOT appear in invisible (has both true)
      // (d) worker: should NOT appear (excluded by isWorkerSessionName)
      // (e) old: should NOT appear (excluded by age)
      // (f) no surface: SHOULD appear in invisible

      const src: SessionVisibilitySources = {
        statuses: [
          // (a) watched-only
          makeStatusRow({
            project: 'proj-watch',
            session: 'sess-watch',
          }),
          // (b) registry-only
          makeStatusRow({
            project: 'proj-reg',
            session: 'sess-reg',
          }),
          // (c) both surfaces
          makeStatusRow({
            project: 'proj-both',
            session: 'sess-both',
          }),
          // (d) worker-named live session
          makeStatusRow({
            project: 'proj-worker',
            session: 'worker-xyz789',
          }),
          // (e) old status (outside LIVE_WINDOW_MS)
          makeStatusRow({
            project: 'proj-old',
            session: 'sess-old',
            updatedAt: NOW - LIVE_WINDOW_MS - 5000,
          }),
          // (f) live on no surface
          makeStatusRow({
            project: 'proj-invisible',
            session: 'sess-invisible',
          }),
        ],
        watched: [
          { project: 'proj-watch', session: 'sess-watch', addedAt: NOW, serverId: '' },
          { project: 'proj-both', session: 'sess-both', addedAt: NOW, serverId: '' },
        ],
        registrySessions: [
          { project: 'proj-reg', session: 'sess-reg' },
          { project: 'proj-both', session: 'sess-both' },
        ],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);

      // Only (f) should appear as a violation
      expect(invisible).toHaveLength(1);
      expect(invisible[0]?.project).toBe('proj-invisible');
      expect(invisible[0]?.session).toBe('sess-invisible');
      expect(invisible[0]?.surfaces).toEqual({
        watchingList: false,
        supervisorPanel: false,
        picker: false,
      });
    });

    it('all live non-worker sessions appear as violations when surfaces are neutered (test under empty surfaces)', () => {
      // This is the core mutation-sensitivity probe: run findInvisibleLiveSessions
      // on a set containing (a)+(b)+(c)+(f) live sessions, but with empty surfaces.
      // Expect all four to appear in invisible with all-false surfaces.

      const src: SessionVisibilitySources = {
        statuses: [
          // (a) was watched-only, now has empty surfaces
          makeStatusRow({
            project: 'proj-a',
            session: 'sess-a',
          }),
          // (b) was registry-only, now has empty surfaces
          makeStatusRow({
            project: 'proj-b',
            session: 'sess-b',
          }),
          // (c) was both surfaces, now has empty surfaces
          makeStatusRow({
            project: 'proj-c',
            session: 'sess-c',
          }),
          // (f) was already invisible
          makeStatusRow({
            project: 'proj-f',
            session: 'sess-f',
          }),
        ],
        watched: [], // Both neutered
        registrySessions: [], // Both neutered
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);

      // All four should appear as violations
      expect(invisible).toHaveLength(4);
      for (const inv of invisible) {
        expect(inv.surfaces).toEqual({
          watchingList: false,
          supervisorPanel: false,
          picker: false,
        });
      }

      // Verify each is present by project + session
      const keys = new Set(invisible.map((inv) => `${inv.project}:${inv.session}`));
      expect(keys.has('proj-a:sess-a')).toBe(true);
      expect(keys.has('proj-b:sess-b')).toBe(true);
      expect(keys.has('proj-c:sess-c')).toBe(true);
      expect(keys.has('proj-f:sess-f')).toBe(true);
    });
  });

  describe('summarizeSessionVisibility', () => {
    it('counts total checked sessions and live sessions', () => {
      const src: SessionVisibilitySources = {
        statuses: [
          // Live session (active, recent)
          makeStatusRow({
            project: 'proj-1',
            session: 'sess-live-1',
          }),
          // Stale session (active, but outside window)
          makeStatusRow({
            project: 'proj-2',
            session: 'sess-stale-1',
            updatedAt: NOW - LIVE_WINDOW_MS - 1000,
          }),
          // Non-active session
          makeStatusRow({
            project: 'proj-3',
            session: 'sess-waiting-1',
            status: 'waiting',
          }),
          // Another live session
          makeStatusRow({
            project: 'proj-4',
            session: 'sess-live-2',
          }),
        ],
        watched: [
          { project: 'proj-1', session: 'sess-live-1', addedAt: NOW, serverId: '' },
          { project: 'proj-4', session: 'sess-live-2', addedAt: NOW, serverId: '' },
        ],
        registrySessions: [],
        now: NOW,
      };

      const report = summarizeSessionVisibility(src);

      expect(report.checkedSessions).toBe(4);
      expect(report.liveSessions).toBe(2); // Only the two active + recent ones
      expect(report.violationCount).toBe(0); // Both watched
      expect(report.invisible).toHaveLength(0);
    });

    it('reports violations as part of the summary', () => {
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-vis',
            session: 'sess-visible',
          }),
          makeStatusRow({
            project: 'proj-inv',
            session: 'sess-invisible',
          }),
        ],
        watched: [
          { project: 'proj-vis', session: 'sess-visible', addedAt: NOW, serverId: '' },
        ],
        registrySessions: [],
        now: NOW,
      };

      const report = summarizeSessionVisibility(src);

      expect(report.checkedSessions).toBe(2);
      expect(report.liveSessions).toBe(2);
      expect(report.violationCount).toBe(1);
      expect(report.invisible).toHaveLength(1);
      expect(report.invisible[0]?.session).toBe('sess-invisible');
    });
  });

  describe('edge cases', () => {
    it('handles empty statuses array', () => {
      const src: SessionVisibilitySources = {
        statuses: [],
        watched: [],
        registrySessions: [],
        now: NOW,
      };

      const report = summarizeSessionVisibility(src);

      expect(report.checkedSessions).toBe(0);
      expect(report.liveSessions).toBe(0);
      expect(report.violationCount).toBe(0);
      expect(report.invisible).toHaveLength(0);
    });

    it('preserves reason field correctly for invisible sessions', () => {
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-test',
            session: 'sess-test',
          }),
        ],
        watched: [],
        registrySessions: [],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);

      expect(invisible).toHaveLength(1);
      expect(invisible[0]?.reason).toContain('not in watched_session');
      expect(invisible[0]?.reason).toContain('not in session-registry list()');
    });

    it('includes ageMs correctly in invisible session', () => {
      const pastTime = NOW - 300_000; // 300 seconds (5 minutes) ago, within LIVE_WINDOW_MS
      const src: SessionVisibilitySources = {
        statuses: [
          makeStatusRow({
            project: 'proj-age',
            session: 'sess-age',
            updatedAt: pastTime,
          }),
        ],
        watched: [],
        registrySessions: [],
        now: NOW,
      };

      const invisible = findInvisibleLiveSessions(src);

      expect(invisible).toHaveLength(1);
      expect(invisible[0]?.ageMs).toBe(NOW - pastTime);
    });
  });
});
