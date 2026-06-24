// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFrictionWatchPass } from '../friction-watch';
import { listFriction, _closeProject } from '../friction-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'friction-watch-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

function makeStubWm(opts: {
  epics?: Array<{ branch: string; epicId8: string; ahead: number }>;
  stale?: Array<{ path: string; branch: string | null; reason: 'branch-gone' | 'prunable' | 'stale'; ageMs: number }>;
}) {
  let epics = opts.epics ?? [];
  let stale = opts.stale ?? [];
  return {
    _setEpics(e: typeof epics) { epics = e; },
    _setStale(s: typeof stale) { stale = s; },
    listUnlandedEpics: async () => epics,
    listStaleWorktrees: async () => stale,
  };
}

describe('friction-watch: unlanded-epic threshold dedup', () => {
  it('records exactly ONE note on the under→over edge, not on steady over', async () => {
    // Default threshold is 5; supply 5 epics to cross it.
    const wm = makeStubWm({
      epics: [
        { branch: 'epic/a', epicId8: 'aabbccdd', ahead: 1 },
        { branch: 'epic/b', epicId8: 'bbccddee', ahead: 2 },
        { branch: 'epic/c', epicId8: 'ccddeeff', ahead: 3 },
        { branch: 'epic/d', epicId8: 'ddeeff00', ahead: 4 },
        { branch: 'epic/e', epicId8: 'eeff0011', ahead: 5 },
      ],
    });

    await runFrictionWatchPass(project, wm);
    await runFrictionWatchPass(project, wm); // second tick — steady over, no new note

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'unlanded-epics-over-threshold').length).toBe(1);
  });

  it('re-fires after dropping below threshold then crossing over again', async () => {
    const wm = makeStubWm({
      epics: [
        { branch: 'epic/a', epicId8: 'aabbccdd', ahead: 1 },
        { branch: 'epic/b', epicId8: 'bbccddee', ahead: 2 },
        { branch: 'epic/c', epicId8: 'ccddeeff', ahead: 3 },
        { branch: 'epic/d', epicId8: 'ddeeff00', ahead: 4 },
        { branch: 'epic/e', epicId8: 'eeff0011', ahead: 5 },
      ],
    });

    // Phase 1: over → records first note
    await runFrictionWatchPass(project, wm);

    // Phase 2: drop below threshold → no note, state→'under'
    wm._setEpics([{ branch: 'epic/a', epicId8: 'aabbccdd', ahead: 1 }]);
    await runFrictionWatchPass(project, wm);

    // Phase 3: back over → should record a SECOND note (edge re-fires)
    wm._setEpics([
      { branch: 'epic/a', epicId8: 'aabbccdd', ahead: 1 },
      { branch: 'epic/b', epicId8: 'bbccddee', ahead: 2 },
      { branch: 'epic/c', epicId8: 'ccddeeff', ahead: 3 },
      { branch: 'epic/d', epicId8: 'ddeeff00', ahead: 4 },
      { branch: 'epic/e', epicId8: 'eeff0011', ahead: 5 },
    ]);
    await runFrictionWatchPass(project, wm);

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'unlanded-epics-over-threshold').length).toBe(2);
  });

  it('does not record when epics are under threshold', async () => {
    const wm = makeStubWm({
      epics: [{ branch: 'epic/a', epicId8: 'aabbccdd', ahead: 1 }],
    });

    await runFrictionWatchPass(project, wm);
    await runFrictionWatchPass(project, wm);

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'unlanded-epics-over-threshold').length).toBe(0);
  });
});

describe('friction-watch: stale-worktree dedup', () => {
  it('records once per newly-stale worktree', async () => {
    const wm = makeStubWm({
      stale: [{ path: '/tmp/wt-a', branch: 'epic/old', reason: 'stale', ageMs: 8 * 86_400_000 }],
    });

    await runFrictionWatchPass(project, wm);

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'stale-worktree').length).toBe(1);
    expect(notes[0].detail).toContain('/tmp/wt-a');
  });

  it('does not record again for the same path+reason on a second pass', async () => {
    const wm = makeStubWm({
      stale: [{ path: '/tmp/wt-a', branch: 'epic/old', reason: 'stale', ageMs: 8 * 86_400_000 }],
    });

    await runFrictionWatchPass(project, wm);
    await runFrictionWatchPass(project, wm); // same identity → skip

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'stale-worktree').length).toBe(1);
  });

  it('records a new note when a new stale path appears', async () => {
    const wm = makeStubWm({
      stale: [{ path: '/tmp/wt-a', branch: 'epic/old', reason: 'stale', ageMs: 8 * 86_400_000 }],
    });

    await runFrictionWatchPass(project, wm);

    wm._setStale([
      { path: '/tmp/wt-a', branch: 'epic/old', reason: 'stale', ageMs: 8 * 86_400_000 },
      { path: '/tmp/wt-b', branch: null, reason: 'branch-gone', ageMs: 0 },
    ]);
    await runFrictionWatchPass(project, wm);

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'stale-worktree').length).toBe(2);
  });

  it('records again for the same path when reason changes', async () => {
    const wm = makeStubWm({
      stale: [{ path: '/tmp/wt-a', branch: 'epic/old', reason: 'stale', ageMs: 8 * 86_400_000 }],
    });

    await runFrictionWatchPass(project, wm);

    // reason changes from 'stale' to 'branch-gone' → new edge
    wm._setStale([{ path: '/tmp/wt-a', branch: 'epic/old', reason: 'branch-gone', ageMs: 8 * 86_400_000 }]);
    await runFrictionWatchPass(project, wm);

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'stale-worktree').length).toBe(2);
  });

  it('includes branch in detail when present, omits it when null', async () => {
    const wm = makeStubWm({
      stale: [
        { path: '/tmp/wt-a', branch: 'epic/named', reason: 'stale', ageMs: 8 * 86_400_000 },
        { path: '/tmp/wt-b', branch: null, reason: 'prunable', ageMs: 0 },
      ],
    });

    await runFrictionWatchPass(project, wm);

    const notes = listFriction(project, { layer: 'operational' }).filter(
      (n) => n.retryReason === 'stale-worktree',
    );
    const wtA = notes.find((n) => n.detail?.includes('/tmp/wt-a'));
    const wtB = notes.find((n) => n.detail?.includes('/tmp/wt-b'));
    expect(wtA?.detail).toContain('[branch epic/named]');
    expect(wtB?.detail).not.toContain('[branch');
  });
});

describe('friction-watch: combined pass isolation', () => {
  it('both detectors run independently in the same pass', async () => {
    const wm = makeStubWm({
      epics: [
        { branch: 'epic/a', epicId8: 'aabbccdd', ahead: 1 },
        { branch: 'epic/b', epicId8: 'bbccddee', ahead: 2 },
        { branch: 'epic/c', epicId8: 'ccddeeff', ahead: 3 },
        { branch: 'epic/d', epicId8: 'ddeeff00', ahead: 4 },
        { branch: 'epic/e', epicId8: 'eeff0011', ahead: 5 },
      ],
      stale: [{ path: '/tmp/wt-x', branch: 'epic/x', reason: 'branch-gone', ageMs: 0 }],
    });

    await runFrictionWatchPass(project, wm);

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'unlanded-epics-over-threshold').length).toBe(1);
    expect(notes.filter((n) => n.retryReason === 'stale-worktree').length).toBe(1);
  });

  it('a throwing detector does not abort the other (best-effort)', async () => {
    const wm = {
      listUnlandedEpics: async () => { throw new Error('git unavailable'); },
      listStaleWorktrees: async () => [
        { path: '/tmp/wt-y', branch: null, reason: 'prunable' as const, ageMs: 0 },
      ],
    };

    // Should not throw even though listUnlandedEpics rejects.
    await expect(runFrictionWatchPass(project, wm)).resolves.toBeUndefined();

    const notes = listFriction(project, { layer: 'operational' });
    expect(notes.filter((n) => n.retryReason === 'stale-worktree').length).toBe(1);
  });
});
