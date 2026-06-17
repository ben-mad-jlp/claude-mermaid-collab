/**
 * Unit tests for src/services/fleet-status.ts — specifically the `lastActivity`
 * timestamp that drives the Bridge worker-card timer (todo caae8574).
 *
 * The bug being guarded: the worker-card timers were built from a render-time
 * fallback (`?? Date.now()`), so every timestamp-less card was re-stamped to
 * `now` on each 2s poll → ALL timers reset in lockstep. fleet-status must expose
 * a REAL, STABLE per-lane lastActivity that does NOT change as `now` advances
 * across repeated polls when the underlying worker state is unchanged.
 *
 * We mock the external liveness/IO collaborators so the test is hermetic and
 * never shells out to tmux/ps.
 */

import { describe, it, expect, mock } from 'bun:test';

const HEARTBEAT = 1_700_000_000_000;
const CLAIMED_AT_ISO = '2026-06-09T17:33:17.962Z';
const CLAIMED_AT_MS = Date.parse(CLAIMED_AT_ISO);

// Control whether a session-status heartbeat exists for the lane.
let heartbeat: number | null = HEARTBEAT;

mock.module('../todo-store', () => ({
  listTodos: () => [
    {
      id: 'todo-1',
      title: 'Wire the thing',
      type: 'backend',
      claimedAt: CLAIMED_AT_ISO,
      claimLeaseMs: 2_400_000,
      sessionName: 'backend-2',
      claimedBy: 'coordinator',
      retryCount: 0,
      targetProject: '/repo',
    },
  ],
  // worker-ledger (imported by fleet-status for listLeafInflight) transitively
  // imports getTodo — provide a stub so the mocked module is import-complete.
  getTodo: () => null,
}));

mock.module('../session-status-store', () => ({
  getStatus: () => (heartbeat == null ? null : { updatedAt: heartbeat }),
}));

const { getFleetStatus } = await import('../fleet-status');
// P7: liveness for headless leaf lanes is the real leaf_inflight signal. Drive it
// through the actual ledger (self-cleaning per test) rather than mocking worker-ledger
// globally — its many exports are used across the import graph.
const { setLeafInflight, clearLeafInflight } = await import('../worker-ledger');

describe('getFleetStatus lastActivity', () => {
  it('uses the real session-status heartbeat and is STABLE across polls (no render-time restamp)', () => {
    heartbeat = HEARTBEAT;
    const poll1 = getFleetStatus('/repo', HEARTBEAT + 10_000);
    const poll2 = getFleetStatus('/repo', HEARTBEAT + 999_000); // much later "now"

    expect(poll1.entries).toHaveLength(1);
    expect(poll1.entries[0].lastActivity).toBe(HEARTBEAT);
    // The crux: a later poll must NOT move lastActivity — it tracks real activity,
    // not when the poll ran. (elapsedMs DOES advance; lastActivity does not.)
    expect(poll2.entries[0].lastActivity).toBe(HEARTBEAT);
    expect(poll2.entries[0].elapsedMs).toBeGreaterThan(poll1.entries[0].elapsedMs!);
  });

  it('falls back to claim age (still a real, stable timestamp) when there is no heartbeat', () => {
    heartbeat = null;
    const poll1 = getFleetStatus('/repo', CLAIMED_AT_MS + 5_000);
    const poll2 = getFleetStatus('/repo', CLAIMED_AT_MS + 600_000);

    expect(poll1.entries[0].lastActivity).toBe(CLAIMED_AT_MS);
    expect(poll2.entries[0].lastActivity).toBe(CLAIMED_AT_MS); // stable across polls
  });
});

describe('getFleetStatus worker state (P7 — headless leaf liveness via leaf_inflight)', () => {
  it("reports 'working' + the live node when the lane has a leaf_inflight row", () => {
    heartbeat = HEARTBEAT;
    setLeafInflight({ leafId: 'todo-1', project: '/repo', nodeKind: 'implement' });
    try {
      const status = getFleetStatus('/repo', HEARTBEAT + 1_000);
      expect(status.entries[0].state).toBe('working');
      expect(status.entries[0].leafNode).toBe('implement');
      expect(status.summary.working).toBe(1);
    } finally {
      clearLeafInflight('todo-1');
    }
  });

  it("reports 'idle' (not 'no_tmux') when no leaf is currently in-flight", () => {
    heartbeat = HEARTBEAT;
    clearLeafInflight('todo-1'); // ensure no in-flight row
    const status = getFleetStatus('/repo', HEARTBEAT + 1_000);
    expect(status.entries[0].state).toBe('idle');
    expect(status.summary.deadOrGone).toBe(0); // headless lanes never read as dead/no_tmux
  });
});

describe('getFleetStatus headroom (fork-EAGAIN early warning)', () => {
  const isNumOrNull = (v: unknown) => v === null || typeof v === 'number';

  it('returns a process-headroom block with the cap-vs-liveProcs fields', () => {
    heartbeat = HEARTBEAT;
    const status = getFleetStatus('/repo');

    // The block exists and carries the four documented fields…
    expect(status.headroom).toBeDefined();
    expect(isNumOrNull(status.headroom.liveProcs)).toBe(true);
    expect(isNumOrNull(status.headroom.perUidCap)).toBe(true);
    expect(isNumOrNull(status.headroom.tmuxSessions)).toBe(true);
    expect(typeof status.headroom.idleSessions).toBe('number');

    // …and idleSessions mirrors the rollup's idle-at-prompt count (same source).
    expect(status.headroom.idleSessions).toBe(status.summary.idle);

    // When the probes succeed they must be sane (cap is the per-uid ceiling, so
    // it dominates the lane's own process count) — only assert when non-null so
    // the test stays hermetic on hosts without sysctl/ps.
    if (status.headroom.liveProcs != null && status.headroom.perUidCap != null) {
      expect(status.headroom.perUidCap).toBeGreaterThan(0);
      expect(status.headroom.liveProcs).toBeGreaterThan(0);
    }
  });
});
