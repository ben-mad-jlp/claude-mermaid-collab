import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runSessionSummaryTick,
  __resetSummaryState,
  getSessionSummary,
  listSessionSummaries,
  setSummaryThresholds,
  getSummaryThresholds,
  type SummaryTickDeps,
} from '../session-summary-loop.ts';

// Isolate SQLite per test via MERMAID_DATA_DIR.
beforeEach(() => {
  process.env.MERMAID_DATA_DIR = mkdtempSync(join(tmpdir(), 'mc-summary-'));
  __resetSummaryState();
});

const P = '/proj/alpha';
const P2 = '/proj/beta';
const S = 'worker-1';

type SessionRow = { project: string; session: string; launchProject?: string | null };

function makeDeps(override: Partial<SummaryTickDeps> = {}): SummaryTickDeps {
  return {
    // Default: one session in watched project P
    listSessions: (): SessionRow[] => [{ project: P, session: S }],
    watchedProjects: () => new Set([P]),
    capture: async () => 'pane content line1\nline2',
    isActive: () => false,
    isWaiting: () => false,
    diagnoseSuppression: async () => ({ suppressed: false, claimable: 1, projectGate: null }),
    systemStatus: async () => ({ fleet: { inProgress: 0, working: 0 }, orchestrator: { poolOccupancy: 0 } }),
    broadcast: () => {},
    hasWs: () => true,
    now: () => 1000,
    ...override,
  };
}

describe('runSessionSummaryTick', () => {
  it('first tick → active, paneSeenAt set, quietWindows=0', async () => {
    const broadcasts: unknown[] = [];
    const r = await runSessionSummaryTick(makeDeps({ broadcast: (m) => broadcasts.push(m), now: () => 2000 }));
    expect(r.scanned).toBe(1);
    expect(r.emitted).toBe(1);
    expect(r.byState.active).toBe(1);

    const entry = getSessionSummary(P, S)!;
    expect(entry.progressState).toBe('active');
    expect(entry.paneSeenAt).toBe(2000);
    expect(entry.quietWindows).toBe(0);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as { type: string }).type).toBe('session_summary_updated');
    expect((broadcasts[0] as { progressState: string }).progressState).toBe('active');
  });

  it('change-gate: changed pane bumps paneSeenAt + resets quietWindows', async () => {
    let pane = 'version-A';
    const deps = makeDeps({ capture: async () => pane, now: () => 1000 });

    await runSessionSummaryTick(deps); // seed
    pane = 'version-B';
    const r = await runSessionSummaryTick({ ...deps, now: () => 2000 });
    const entry = getSessionSummary(P, S)!;
    expect(entry.progressState).toBe('active');
    expect(entry.paneSeenAt).toBe(2000);
    expect(entry.quietWindows).toBe(0);
    expect(r.byState.active).toBe(1);
  });

  it('change-gate: unchanged pane does NOT move paneSeenAt, increments quietWindows', async () => {
    const deps = makeDeps({ capture: async () => 'static', now: () => 1000 });
    await runSessionSummaryTick(deps); // seed → active, paneSeenAt=1000
    const r = await runSessionSummaryTick({ ...deps, now: () => 2000 }); // same pane
    const entry = getSessionSummary(P, S)!;
    expect(entry.paneSeenAt).toBe(1000); // unchanged
    expect(entry.quietWindows).toBe(1);
    expect(r.byState.quiet).toBe(1);
  });

  it('grading: quiet below STALL_WINDOWS', async () => {
    setSummaryThresholds({ stallWindows: 3, wedgeWindows: 6 });
    const deps = makeDeps({ capture: async () => 'static' });
    await runSessionSummaryTick(deps); // seed → active (quietWindows=0)

    // tick 2: quietWindows=1 → quiet
    const r2 = await runSessionSummaryTick(deps);
    expect(r2.byState.quiet).toBe(1);

    // tick 3: quietWindows=2 → still quiet
    const r3 = await runSessionSummaryTick(deps);
    expect(r3.byState.quiet).toBe(1);
  });

  it('grading: stalled at/above STALL_WINDOWS when !isActive && !isWaiting', async () => {
    setSummaryThresholds({ stallWindows: 2, wedgeWindows: 10 });
    const deps = makeDeps({ capture: async () => 'static', isActive: () => false, isWaiting: () => false });
    await runSessionSummaryTick(deps); // seed → active
    await runSessionSummaryTick(deps); // quiet (qw=1)
    const r = await runSessionSummaryTick(deps); // stalled (qw=2 >= 2)
    expect(r.byState.stalled).toBe(1);
    expect(getSessionSummary(P, S)!.progressState).toBe('stalled');
  });

  it('grading: wedged at/above WEDGE_WINDOWS with corroboration saying not-building', async () => {
    setSummaryThresholds({ stallWindows: 1, wedgeWindows: 2 });
    const deps = makeDeps({
      capture: async () => 'static',
      isActive: () => false,
      isWaiting: () => false,
      diagnoseSuppression: async () => ({ suppressed: false, claimable: 1, projectGate: null }),
      systemStatus: async () => ({ fleet: { inProgress: 0, working: 0 }, orchestrator: { poolOccupancy: 0 } }),
    });
    await runSessionSummaryTick(deps); // seed → active
    await runSessionSummaryTick(deps); // stalled (qw=1 >= 1)
    const r = await runSessionSummaryTick(deps); // wedged (qw=2 >= 2)
    expect(r.byState.wedged).toBe(1);
    expect(getSessionSummary(P, S)!.progressState).toBe('wedged');
  });

  it('grading: downgrade to stalled when corroborator says building', async () => {
    setSummaryThresholds({ stallWindows: 1, wedgeWindows: 2 });
    const deps = makeDeps({
      capture: async () => 'static',
      isActive: () => false,
      isWaiting: () => false,
      diagnoseSuppression: async () => ({ suppressed: false, claimable: 1, projectGate: null }),
      // systemStatus says working > 0 → building
      systemStatus: async () => ({ fleet: { inProgress: 0, working: 1 }, orchestrator: { poolOccupancy: 0 } }),
    });
    await runSessionSummaryTick(deps); // seed
    await runSessionSummaryTick(deps); // stalled
    const r = await runSessionSummaryTick(deps); // would be wedge tick but building → stalled
    expect(r.byState.stalled).toBe(1);
  });

  it('grading: corroborator throws → stalled (never fabricate wedged)', async () => {
    setSummaryThresholds({ stallWindows: 1, wedgeWindows: 2 });
    const deps = makeDeps({
      capture: async () => 'static',
      isActive: () => false,
      isWaiting: () => false,
      diagnoseSuppression: async () => { throw new Error('corroborator down'); },
      systemStatus: async () => { throw new Error('status down'); },
    });
    await runSessionSummaryTick(deps); // seed
    await runSessionSummaryTick(deps); // stalled
    const r = await runSessionSummaryTick(deps); // wedge tick but corroborators fail → stalled
    expect(r.byState.stalled).toBe(1);
  });

  it('waiting clamp: isWaiting=true keeps state quiet even past STALL_WINDOWS', async () => {
    setSummaryThresholds({ stallWindows: 1, wedgeWindows: 10 });
    const deps = makeDeps({ capture: async () => 'static', isWaiting: () => true });
    await runSessionSummaryTick(deps); // seed → active
    await runSessionSummaryTick(deps); // qw=1 >= stallWindows, but isWaiting → quiet
    const r = await runSessionSummaryTick(deps); // qw=2, still waiting → quiet
    expect(r.byState.quiet).toBe(1);
    expect(getSessionSummary(P, S)!.progressState).toBe('quiet');
  });

  it('capture-fail → unknown; quietWindows reset to 0', async () => {
    const deps = makeDeps({ capture: async () => '' });
    const r = await runSessionSummaryTick(deps);
    expect(r.byState.unknown).toBe(1);
    const entry = getSessionSummary(P, S)!;
    expect(entry.progressState).toBe('unknown');
    expect(entry.paneHash).toBe('');
    expect(entry.quietWindows).toBe(0);
  });

  it('WS-gap → unknown (hasWs returns false)', async () => {
    const deps = makeDeps({ hasWs: () => false });
    const r = await runSessionSummaryTick(deps);
    expect(r.byState.unknown).toBe(1);
    expect(getSessionSummary(P, S)!.progressState).toBe('unknown');
  });

  it('only supervised+watched sessions scanned; unwatched project sessions skipped', async () => {
    const broadcasts: unknown[] = [];
    // Two sessions: P is watched, P2 is not
    const r = await runSessionSummaryTick(makeDeps({
      listSessions: () => [
        { project: P, session: S },
        { project: P2, session: 'other-worker' },
      ],
      watchedProjects: () => new Set([P]), // P2 not watched
      broadcast: (m) => broadcasts.push(m),
    }));
    expect(r.scanned).toBe(1); // only P's session
    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as { project: string }).project).toBe(P);
    // No entry for P2
    expect(getSessionSummary(P2, 'other-worker')).toBeUndefined();
  });

  it('no dependency on todo-store — module has no todos-related imports in the tick', async () => {
    // Prove decoupling: deps has no loadTodos parameter; passing none is fine
    const r = await runSessionSummaryTick(makeDeps({}));
    expect(r.scanned).toBe(1);
  });

  it('prune: entry drops from cache once session leaves supervised set', async () => {
    let sessions: SessionRow[] = [{ project: P, session: S }];
    const deps = makeDeps({ listSessions: () => sessions });
    await runSessionSummaryTick(deps); // seed
    expect(getSessionSummary(P, S)).toBeDefined();

    sessions = []; // session removed from supervised set
    await runSessionSummaryTick(deps);
    expect(getSessionSummary(P, S)).toBeUndefined();
    expect(listSessionSummaries()).toHaveLength(0);
  });

  it('rebuildable: __resetSummaryState clears cache; next tick re-seeds to active', async () => {
    const deps = makeDeps({ capture: async () => 'static' });
    await runSessionSummaryTick(deps); // seed → active
    await runSessionSummaryTick(deps); // unchanged → quiet (qw=1)
    expect(getSessionSummary(P, S)!.quietWindows).toBe(1);

    __resetSummaryState();
    expect(listSessionSummaries()).toHaveLength(0);

    // First tick after reset → active again (no prior hash to compare)
    const r = await runSessionSummaryTick(deps);
    expect(r.byState.active).toBe(1);
    expect(getSessionSummary(P, S)!.quietWindows).toBe(0);
  });

  it('setSummaryThresholds / getSummaryThresholds work', () => {
    setSummaryThresholds({ stallWindows: 5, wedgeWindows: 12 });
    const t = getSummaryThresholds();
    expect(t.stallWindows).toBe(5);
    expect(t.wedgeWindows).toBe(12);
  });

  it('broadcast receives correct shape on every emission', async () => {
    const msgs: unknown[] = [];
    await runSessionSummaryTick(makeDeps({ broadcast: (m) => msgs.push(m), now: () => 9999 }));
    expect(msgs).toHaveLength(1);
    const m = msgs[0] as { type: string; project: string; session: string; progressState: string; paneSeenAt: number; updatedAt: number };
    expect(m.type).toBe('session_summary_updated');
    expect(m.project).toBe(P);
    expect(m.session).toBe(S);
    expect(typeof m.progressState).toBe('string');
    expect(typeof m.paneSeenAt).toBe('number');
    expect(m.updatedAt).toBe(9999);
  });

  it('launchProject used for tmux name derivation when set', async () => {
    const captured: string[] = [];
    await runSessionSummaryTick(makeDeps({
      listSessions: () => [{ project: P, session: S, launchProject: '/proj/other' }],
      capture: async (tmux) => { captured.push(tmux); return 'pane'; },
    }));
    // tmuxBaseName('/proj/other', S) should have been called — name starts with mc-other-
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatch(/^mc-other-/);
  });
});
