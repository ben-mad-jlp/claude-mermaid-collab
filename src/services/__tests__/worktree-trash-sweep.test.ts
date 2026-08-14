// Trash-sweep wiring (audit item 9): tickSweepWorktreeTrash was a dead schedule —
// hourly throttle, zero production callers. It is now fired (fire-and-forget, before
// the GC throttle gate so it self-gates on its own hourly throttle) from every
// tickGcLeafWorktrees call, which coordinator-live fires on each liveness tick via
// the worker-liveness `tickGcLeafWorktrees` dep.
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  tickSweepWorktreeTrash,
  tickGcLeafWorktrees,
  TRASH_SWEEP_THROTTLE_MS,
  WORKTREE_GC_INTERVAL_MS,
  type GcReport,
} from '../leaf-worktree-reaper';

const emptyReport: GcReport = { removed: [], skipped: [], errors: [] } as unknown as GcReport;

function freshProject(): string {
  return mkdtempSync(join(tmpdir(), 'trash-sweep-'));
}

describe('tickSweepWorktreeTrash throttle (clock-injected)', () => {
  it('runs at most once per hour per project, and re-arms after the window', async () => {
    const project = freshProject();
    const calls: number[] = [];
    const sweep = async (now: number) => {
      calls.push(now);
      return ['x'];
    };
    const t = 1_000_000_000;
    expect(await tickSweepWorktreeTrash(project, { now: t, sweep })).toEqual(['x']);
    expect(await tickSweepWorktreeTrash(project, { now: t + 1, sweep })).toBeNull();
    expect(await tickSweepWorktreeTrash(project, { now: t + TRASH_SWEEP_THROTTLE_MS - 1, sweep })).toBeNull();
    expect(await tickSweepWorktreeTrash(project, { now: t + TRASH_SWEEP_THROTTLE_MS, sweep })).toEqual(['x']);
    expect(calls).toEqual([t, t + TRASH_SWEEP_THROTTLE_MS]);
  });

  it('a failing sweep is swallowed (best-effort) and re-arms only after the window', async () => {
    const project = freshProject();
    const t = 2_000_000_000;
    const boom = async () => {
      throw new Error('disk unhappy');
    };
    expect(await tickSweepWorktreeTrash(project, { now: t, sweep: boom })).toBeNull();
    // Throttle was consumed by the failed attempt — next call inside the hour no-ops.
    const calls: number[] = [];
    const ok = async (now: number) => {
      calls.push(now);
      return [];
    };
    expect(await tickSweepWorktreeTrash(project, { now: t + 1, sweep: ok })).toBeNull();
    expect(await tickSweepWorktreeTrash(project, { now: t + TRASH_SWEEP_THROTTLE_MS, sweep: ok })).toEqual([]);
    expect(calls).toEqual([t + TRASH_SWEEP_THROTTLE_MS]);
  });
});

describe('tickGcLeafWorktrees fires the trash sweep', () => {
  it('every tick offers the trash sweep a shot, even when the GC gate itself is throttled', async () => {
    const project = freshProject();
    const trashCalls: Array<number | undefined> = [];
    const trashSweep = async (_p: string, o?: { now?: number }) => {
      trashCalls.push(o?.now);
      return null;
    };
    const gc = async () => emptyReport;
    const t = 3_000_000_000;
    await tickGcLeafWorktrees(project, { now: t, gc, trashSweep });
    // Second tick inside WORKTREE_GC_INTERVAL_MS: GC no-ops, trash sweep still offered.
    const gcRes = await tickGcLeafWorktrees(project, { now: t + 1, gc, trashSweep });
    expect(gcRes).toBeNull();
    expect(trashCalls).toEqual([t, t + 1]);
    expect(t + WORKTREE_GC_INTERVAL_MS).toBeGreaterThan(t); // sanity: gate constant exported/live
  });

  it('the REAL tickSweepWorktreeTrash rides the GC tick and honours its own hourly throttle', async () => {
    const project = freshProject();
    // No injected trashSweep: the default path runs the real tickSweepWorktreeTrash,
    // whose sweepTrash readdir on a project with no .collab/.trash yields [] (throttle
    // still consumed — the second GC tick's trash pass no-ops silently).
    const gc = async () => emptyReport;
    const t = 4_000_000_000;
    await expect(tickGcLeafWorktrees(project, { now: t, gc })).resolves.toBe(emptyReport);
    await expect(tickGcLeafWorktrees(project, { now: t + 1, gc })).resolves.toBeNull();
  });
});
