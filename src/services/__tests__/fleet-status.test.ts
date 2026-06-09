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
}));

mock.module('../tmux-naming', () => ({
  tmuxBaseName: (_project: string, worker: string) => `mc-${worker}`,
}));

// tmux is "alive" + Claude actively working, so the state branch is exercised
// without any real spawn (procSnapshot/tmux calls still run but their result is
// irrelevant to lastActivity, which is computed before the tmux branch).
mock.module('../coordinator-live', () => ({
  claudeAliveInSubtree: () => true,
  isClaudeTuiPresent: () => true,
  detectPermissionPrompt: () => ({ isPermission: false, tool: null }),
}));

mock.module('../session-status-store', () => ({
  getStatus: () => (heartbeat == null ? null : { updatedAt: heartbeat }),
}));

const { getFleetStatus } = await import('../fleet-status');

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
