import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runSessionSummaryTick,
  __resetSummaryState,
  __drainInterpreters,
  getSessionSummary,
  listSessionSummaries,
  setSummaryThresholds,
  getSummaryThresholds,
  refreshSummaryNow,
  classifyInterpretFailure,
  recordInterpretOutcome,
  getSummaryHealth,
  isInterpretRateLimited,
  parseInterpretJson,
  pushSessionSummary,
  getSelfSummaryNudgeConfig,
  shouldSelfNudge,
  runSelfSummaryNudgePass,
  setSelfSummaryNudgeConfig,
  type SummaryTickDeps,
  type InterpreterStructured,
  type SessionSummaryEntry,
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
    zenViewed: () => true, // default: Zen is being watched (tick tests exercise the interpret path)
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

  it('union: summarizes a watched/known session even when no supervised rows exist', async () => {
    // The user-watched design/planner sessions come from listKnownSessions (session-status),
    // NOT listSupervised (pool slots). The loop must summarize them too.
    const r = await runSessionSummaryTick(makeDeps({
      listSessions: () => [],
      listKnownSessions: () => [{ project: P, session: S }],
      now: () => 3000,
    }));
    expect(r.scanned).toBe(1);
    expect(getSessionSummary(P, S)).toBeTruthy();
  });

  it('union: dedups a session present in BOTH supervised and known (scanned once)', async () => {
    const r = await runSessionSummaryTick(makeDeps({
      listSessions: () => [{ project: P, session: S }],
      listKnownSessions: () => [{ project: P, session: S }],
      now: () => 4000,
    }));
    expect(r.scanned).toBe(1);
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

  it('Zen not actively viewed → unknown + no interpret (connected but not watching)', async () => {
    let interpretCallCount = 0;
    const deps = makeDeps({
      hasWs: () => true,        // a browser IS connected...
      zenViewed: () => false,   // ...but nobody is looking at Zen
      interpret: async () => { interpretCallCount++; return { paragraph: 'x', status: 'working' as const }; },
    });
    const r = await runSessionSummaryTick(deps);
    expect(r.byState.unknown).toBe(1);
    expect(getSessionSummary(P, S)!.progressState).toBe('unknown');
    expect(interpretCallCount).toBe(0); // no token-burning interpret
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

  it('prune: a cached-but-no-longer-live session is pruned AND emits session_deleted {project, session}', async () => {
    // Seed: one tick with the default watched session populates the cache.
    await runSessionSummaryTick(makeDeps({ now: () => 1000 }));
    expect(getSessionSummary(P, S)).toBeTruthy();

    // Second tick: session gone from both live sources → prune path.
    const broadcasts: unknown[] = [];
    await runSessionSummaryTick(makeDeps({
      listSessions: () => [],
      listKnownSessions: () => [],
      broadcast: (m) => broadcasts.push(m),
      now: () => 2000,
    }));

    // Pruned from the cache.
    expect(getSessionSummary(P, S)).toBeUndefined();

    // A session_deleted broadcast with the pruned {project, session} was observed.
    const removed = broadcasts.find(
      (m) => (m as { type?: string }).type === 'session_deleted',
    ) as { type: string; project: string; session: string } | undefined;
    expect(removed).toBeTruthy();
    expect(removed!.project).toBe(P);
    expect(removed!.session).toBe(S);
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

describe('interpreter pass', () => {
  it('fires on pane change + throttle elapsed; emits enriched second broadcast', async () => {
    let pane = 'version-A';
    let t = 1000;
    let interpretCallCount = 0;
    const structured: InterpreterStructured = { paragraph: 'The session is working steadily.', status: 'working' };
    const broadcasts: unknown[] = [];
    const deps = makeDeps({
      capture: async () => pane,
      now: () => t,
      broadcast: (m) => broadcasts.push(m),
      interpret: async () => { interpretCallCount++; return structured; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed — throttle blocks (1000 < 45000) and no prior summaryPaneHash
    await runSessionSummaryTick(deps);
    expect(interpretCallCount).toBe(0);

    // Change pane and advance past throttle
    pane = 'version-B';
    t = 50_000;
    await runSessionSummaryTick(deps);
    await __drainInterpreters();

    expect(interpretCallCount).toBe(1);
    const entry = getSessionSummary(P, S)!;
    expect(entry.structured).toEqual(structured);
    expect(entry.summaryText).toBe(structured.paragraph);
    expect(entry.summaryPaneHash).toBeTruthy();
    expect(entry.refreshState).toBe('fresh');

    // The second (enriched) broadcast must have been emitted
    type SummaryMsg = { type: string; structured?: InterpreterStructured };
    const enriched = (broadcasts as SummaryMsg[]).filter(m => m.type === 'session_summary_updated' && m.structured != null);
    expect(enriched).toHaveLength(1);
    expect(enriched[0]!.structured).toEqual(structured);
  });

  it('frozen session = zero calls after first summary (KEYSTONE)', async () => {
    let interpretCallCount = 0;
    const structured: InterpreterStructured = { paragraph: 'Session is idle.', status: 'idle' };
    const frozenPane = 'frozen-content';
    let t = 1000;
    const deps = makeDeps({
      capture: async () => frozenPane,
      now: () => t,
      interpret: async () => { interpretCallCount++; return structured; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed — throttle blocks
    await runSessionSummaryTick(deps);
    expect(interpretCallCount).toBe(0);

    // Advance past throttle — first summary fires (pane not yet summarized)
    t = 50_000;
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    expect(interpretCallCount).toBe(1);

    // Pane is frozen; many more ticks must NOT fire interpret (change-gate blocks)
    for (const tick of [100_000, 150_000, 200_000, 250_000]) {
      t = tick;
      await runSessionSummaryTick(deps);
    }
    await __drainInterpreters();
    expect(interpretCallCount).toBe(1); // change-gate: summaryPaneHash===hash → zero additional cost
  });

  it('throttle: pane changes every tick but within 45s; interpret not called', async () => {
    let interpretCallCount = 0;
    let pane = 'pane-0';
    let t = 1000;
    const deps = makeDeps({
      capture: async () => pane,
      now: () => t,
      interpret: async () => { interpretCallCount++; return { paragraph: 'Working.', status: 'working' as const }; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed
    await runSessionSummaryTick(deps);

    // Change pane every tick but stay within 45s window from lastSummaryAt=0
    for (let i = 1; i <= 4; i++) {
      pane = `pane-${i}`;
      t = 1000 + i * 5_000; // 6000, 11000, 16000, 21000 — all < MIN_SUMMARY_INTERVAL_MS
      await runSessionSummaryTick(deps);
    }
    await __drainInterpreters();
    expect(interpretCallCount).toBe(0);
  });

  it('became-idle edge bypasses throttle: active→quiet with unsummarized pane fires interpret', async () => {
    let interpretCallCount = 0;
    let pane = 'pane-A';
    let t = 1000;
    const deps = makeDeps({
      capture: async () => pane,
      now: () => t,
      interpret: async () => { interpretCallCount++; return { paragraph: 'Now idle.', status: 'idle' as const }; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed: pane-A → active; throttle blocks interpret (t=1000 < 45000)
    await runSessionSummaryTick(deps);
    expect(interpretCallCount).toBe(0);

    // Pane changes to B → active again; throttle still blocks
    pane = 'pane-B';
    t = 2_000;
    await runSessionSummaryTick(deps);
    expect(interpretCallCount).toBe(0);

    // Same pane-B → quiet (active→quiet transition); becameIdle bypasses throttle
    t = 3_000;
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    expect(interpretCallCount).toBe(1);
  });

  it('single in-flight: second tick does not launch a second interpret call', async () => {
    let interpretCallCount = 0;
    let pane = 'pane-A';
    let t = 1000;
    const deps = makeDeps({
      capture: async () => pane,
      now: () => t,
      // Never resolves — simulates a long-running call
      interpret: () => { interpretCallCount++; return new Promise<InterpreterStructured | null>(() => {}); },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed
    await runSessionSummaryTick(deps);

    // Tick that fires interpret (pane changed + throttle elapsed)
    pane = 'pane-B';
    t = 50_000;
    await runSessionSummaryTick(deps);
    expect(interpretCallCount).toBe(1);
    // summaryInFlight=true is now set on the entry

    // Another tick with another pane change — in-flight guard blocks second call
    pane = 'pane-C';
    t = 100_000;
    await runSessionSummaryTick(deps);
    expect(interpretCallCount).toBe(1);
  });

  it('failure → stale-failing; summaryPaneHash not advanced; later tick retries after throttle', async () => {
    // Use stallWindows=1 so pane quickly reaches 'stalled'. Once the entry's progressState
    // is 'stalled', subsequent stalled→stalled ticks do NOT fire becameIdle, so the pure
    // throttle gate controls retries — testable within a single test.
    setSummaryThresholds({ stallWindows: 1, wedgeWindows: 10 });
    let interpretCallCount = 0;
    const pane = 'pane-static';
    let t = 1000;
    let interpretResult: InterpreterStructured | null = null;
    const deps = makeDeps({
      capture: async () => pane,
      now: () => t,
      interpret: async () => { interpretCallCount++; return interpretResult; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed → active
    await runSessionSummaryTick(deps);

    // Same pane → stalled (qw=1 >= stallWindows=1); active→stalled is a becameIdle transition
    // and summaryPaneHash is still unset → fires call #1 (returns null → failure)
    t = 2_000;
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    expect(interpretCallCount).toBe(1);

    const entry = getSessionSummary(P, S)!;
    expect(entry.refreshState).toBe('stale-failing');
    expect(entry.summaryPaneHash).toBeUndefined(); // NOT advanced on failure

    // Same stalled pane, within throttle (1s < 45s): prev.progressState='stalled' so
    // becameIdle=false, throttle 1000ms < 45000ms → blocked
    t = 3_000;
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    expect(interpretCallCount).toBe(1);

    // Throttle clears (48s ≥ 45s) BUT the failure backoff (nextRetryAt = 2000 + 90s
    // = 92000 after one failure) still gates the retry → no new call yet.
    interpretResult = { paragraph: 'Session recovered.', status: 'working' };
    t = 50_000;
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    expect(interpretCallCount).toBe(1); // backoff holds — no storm
    expect(getSessionSummary(P, S)!.refreshState).toBe('stale-failing');

    // Past the failure backoff (t ≥ 92000) → retry fires and recovers.
    t = 95_000;
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    expect(interpretCallCount).toBe(2);
    expect(getSessionSummary(P, S)!.refreshState).toBe('fresh');
  });
});

describe('refreshSummaryNow (force-proof)', () => {
  it('forces interpret even when change-gate would block (frozen pane)', async () => {
    const frozenPane = 'frozen-pane-content';
    let t = 1000;
    let seedInterpretCount = 0;
    const structured: InterpreterStructured = { paragraph: 'Session is idle.', status: 'idle' };

    // Seed with a tick that fires interpret (past throttle + pane change)
    const seedDeps = makeDeps({
      capture: async () => frozenPane,
      now: () => t,
      interpret: async () => { seedInterpretCount++; return structured; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    await runSessionSummaryTick(seedDeps); // seed → active, throttle blocks
    t = 50_000;
    await runSessionSummaryTick(seedDeps); // past throttle, fires interpret (summaryPaneHash not set yet)
    await __drainInterpreters();
    expect(seedInterpretCount).toBe(1);

    // Pane is frozen: another tick must NOT fire interpret (change-gate now closed)
    t = 100_000;
    let extraCount = 0;
    await runSessionSummaryTick(makeDeps({
      capture: async () => frozenPane,
      now: () => t,
      interpret: async () => { extraCount++; return structured; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    }));
    await __drainInterpreters();
    expect(extraCount).toBe(0); // change-gate blocked it

    // Now refreshSummaryNow must bypass the change-gate and call interpret
    let refreshInterpretCount = 0;
    const refreshDeps = makeDeps({
      capture: async () => frozenPane,
      now: () => t,
      interpret: async () => { refreshInterpretCount++; return structured; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });
    const result = await refreshSummaryNow(P, S, refreshDeps);
    expect(refreshInterpretCount).toBe(1);
    expect(result.ok).toBe(true);
  });

  it('forces interpret even within the throttle window', async () => {
    let t = 1000; // well under MIN_SUMMARY_INTERVAL_MS
    let interpretCallCount = 0;
    const structured: InterpreterStructured = { paragraph: 'Active session.', status: 'working' };
    const deps = makeDeps({
      capture: async () => 'pane-content',
      now: () => t,
      interpret: async () => { interpretCallCount++; return structured; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed an entry
    await runSessionSummaryTick(deps);
    expect(interpretCallCount).toBe(0); // throttle blocks

    // refreshSummaryNow at t=1000 (within throttle) must still call interpret
    const result = await refreshSummaryNow(P, S, deps);
    expect(interpretCallCount).toBe(1);
    expect(result.ok).toBe(true);
    expect(getSessionSummary(P, S)!.refreshState).toBe('fresh');
  });

  it('commits structured + advances summaryPaneHash + stamps refreshState=fresh', async () => {
    let t = 1000;
    const structured: InterpreterStructured = { paragraph: 'Detailed progress here.', status: 'working' };
    const deps = makeDeps({
      capture: async () => 'test-pane',
      now: () => t,
      interpret: async () => structured,
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed an entry so a prev exists
    await runSessionSummaryTick(deps);

    const result = await refreshSummaryNow(P, S, deps);
    expect(result.ok).toBe(true);

    const entry = getSessionSummary(P, S)!;
    expect(entry.structured).toEqual(structured);
    expect(entry.summaryText).toBe(structured.paragraph);
    expect(entry.firstClause).toBeTruthy();
    expect(entry.summaryPaneHash).toBeTruthy();
    expect(entry.refreshState).toBe('fresh');
    expect(entry.summaryInFlight).toBeFalsy();
  });

  it('emits an enriched session_summary_updated broadcast', async () => {
    let t = 1000;
    const structured: InterpreterStructured = { paragraph: 'Broadcasting now.', status: 'working' };
    const broadcasts: unknown[] = [];
    const deps = makeDeps({
      capture: async () => 'pane-broadcast',
      now: () => t,
      broadcast: (m) => broadcasts.push(m),
      interpret: async () => structured,
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed an entry
    await runSessionSummaryTick(deps);
    broadcasts.length = 0; // clear seed broadcasts

    await refreshSummaryNow(P, S, deps);

    type SummaryMsg = { type: string; structured?: InterpreterStructured };
    const enriched = (broadcasts as SummaryMsg[]).filter(
      m => m.type === 'session_summary_updated' && m.structured != null,
    );
    expect(enriched.length).toBeGreaterThanOrEqual(1);
    expect(enriched[0]!.structured).toEqual(structured);
  });

  it('returns ok:false and does not call interpret when WS is absent', async () => {
    let interpretCallCount = 0;
    const deps = makeDeps({
      capture: async () => 'pane-content',
      hasWs: () => false,
      interpret: async () => { interpretCallCount++; return { paragraph: 'x', status: 'working' as const }; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    const result = await refreshSummaryNow(P, S, deps);
    expect(result.ok).toBe(false);
    expect(interpretCallCount).toBe(0);
  });

  it('returns ok:false on empty capture (cannot read pane)', async () => {
    let interpretCallCount = 0;
    // Seed an entry with real content first
    const seedDeps = makeDeps({
      capture: async () => 'initial-pane',
      now: () => 1000,
      interpret: async () => ({ paragraph: 'seed', status: 'working' as const }),
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });
    await runSessionSummaryTick(seedDeps);

    // Refresh with empty capture
    const refreshDeps = makeDeps({
      capture: async () => '',
      now: () => 2000,
      interpret: async () => { interpretCallCount++; return { paragraph: 'x', status: 'working' as const }; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });
    const result = await refreshSummaryNow(P, S, refreshDeps);
    expect(result.ok).toBe(false);
    expect(interpretCallCount).toBe(0);
  });

  it('single-in-flight: refresh while a tick interpret is pending does not double-fire', async () => {
    let interpretCallCount = 0;
    let pane = 'pane-A';
    let t = 1000;
    const deps = makeDeps({
      capture: async () => pane,
      now: () => t,
      // Never resolves — simulates a long-running call
      interpret: () => { interpretCallCount++; return new Promise<InterpreterStructured | null>(() => {}); },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed
    await runSessionSummaryTick(deps);

    // Tick that fires interpret (pane changed + throttle elapsed) — sets summaryInFlight=true
    pane = 'pane-B';
    t = 50_000;
    await runSessionSummaryTick(deps);
    expect(interpretCallCount).toBe(1);

    // refreshSummaryNow must detect in-flight and refuse to launch a second call
    const result = await refreshSummaryNow(P, S, deps);
    expect(interpretCallCount).toBe(1); // NOT incremented again
    expect(result.ok).toBe(false);
    // Do NOT await __drainInterpreters — the promise never resolves by design
  });

  it('failure path: interpret returns null → refreshState=stale-failing, hash not advanced', async () => {
    let t = 1000;
    const preSeedDeps = makeDeps({
      capture: async () => 'initial-pane',
      now: () => t,
      interpret: async () => ({ paragraph: 'seed', status: 'working' as const }),
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed an entry first
    await runSessionSummaryTick(preSeedDeps);
    const hashBefore = getSessionSummary(P, S)?.summaryPaneHash;

    // Now refresh with a failing interpret
    const refreshDeps = makeDeps({
      capture: async () => 'initial-pane',
      now: () => t,
      interpret: async () => null,
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });
    const result = await refreshSummaryNow(P, S, refreshDeps);

    const entry = getSessionSummary(P, S)!;
    expect(result.ok).toBe(false);
    expect(entry.refreshState).toBe('stale-failing');
    expect(entry.summaryPaneHash).toBe(hashBefore); // unchanged
  });
});

describe('sticky open-question', () => {
  it('a still-idle re-interpret that drops the question keeps the prior question/suggestedAnswers', async () => {
    let t = 1000;
    let pane = 'pane-A';
    let result: InterpreterStructured | null = null;
    const deps = makeDeps({
      capture: async () => pane,
      now: () => t,
      interpret: async () => result,
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed (no interpret yet — throttle not met, not becameIdle).
    await runSessionSummaryTick(deps);

    // Pane change + throttle passed → interpret fires; returns IDLE WITH a question.
    t = 50_000; pane = 'pane-B';
    result = { paragraph: 'Waiting on direction.', status: 'idle', question: 'Which way next?', suggestedAnswers: ['Bake-off', 'Terrain'] };
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    expect(getSessionSummary(P, S)!.structured?.question).toBe('Which way next?');

    // Pane churns (cursor/timer) + still idle, interpret DROPS the question → sticky keeps it.
    t = 110_000; pane = 'pane-C';
    result = { paragraph: 'Still waiting.', status: 'idle' };
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    let e = getSessionSummary(P, S)!;
    expect(e.structured?.question).toBe('Which way next?');           // sticky kept the question
    expect(e.structured?.suggestedAnswers).toEqual(['Bake-off', 'Terrain']); // …and its answers
    expect(e.structured?.paragraph).toBe('Still waiting.');           // narration still advances

    // Session RESUMES (status no longer idle) → the stale question is dropped.
    t = 170_000; pane = 'pane-D';
    result = { paragraph: 'Working now.', status: 'working' };
    await runSessionSummaryTick(deps);
    await __drainInterpreters();
    e = getSessionSummary(P, S)!;
    expect(e.structured?.question).toBeUndefined();                   // resumed → dropped
  });
});

describe('pushSessionSummary (self-summary)', () => {
  it('folds a pushed structured summary into the cache as FRESH + broadcasts', () => {
    const msgs: unknown[] = [];
    const r = pushSessionSummary(P, S, { paragraph: 'We are wiring self-summary.', status: 'working' }, (m) => msgs.push(m));
    expect(r.ok).toBe(true);
    const e = getSessionSummary(P, S)!;
    expect(e.structured?.paragraph).toBe('We are wiring self-summary.');
    expect(e.refreshState).toBe('fresh');
    expect(e.summaryPaneHash).toBe(e.paneHash); // pushed → answerable (paneStillMatches)
    expect(msgs.length).toBe(1);
    expect((msgs[0] as { type: string }).type).toBe('session_summary_updated');
  });

  it('carries a pushed open-question through to the card payload', () => {
    const msgs: Array<Record<string, unknown>> = [];
    pushSessionSummary(P, S, { paragraph: 'Done — which way?', status: 'idle', question: 'Ship or iterate?', suggestedAnswers: ['Ship', 'Iterate'] }, (m) => msgs.push(m as Record<string, unknown>));
    const st = (msgs[0]?.structured ?? {}) as { question?: string; suggestedAnswers?: string[] };
    expect(st.question).toBe('Ship or iterate?');
    expect(st.suggestedAnswers).toEqual(['Ship', 'Iterate']);
  });

  it('rejects an invalid payload (no paragraph / valid status)', () => {
    expect(pushSessionSummary(P, S, { foo: 1 }).ok).toBe(false);
    expect(pushSessionSummary(P, S, { paragraph: 'x', status: 'bogus' }).ok).toBe(false);
  });
});

describe('interpret observability', () => {
  it('classifyInterpretFailure maps node results to reasons', () => {
    expect(classifyInterpretFailure({ ok: true }, true)).toBeUndefined();             // success
    expect(classifyInterpretFailure({ ok: false, rateLimited: true }, false)).toBe('rate-limit');
    expect(classifyInterpretFailure({ ok: false, rateLimited: true, unreachable: true }, false)).toBe('unreachable');
    expect(classifyInterpretFailure({ ok: false, parseError: 'timed out after 60000ms' }, false)).toBe('timeout');
    expect(classifyInterpretFailure({ ok: true }, false)).toBe('parse');             // node ok, our parse failed
    expect(classifyInterpretFailure({ ok: false, parseError: 'bad json' }, false)).toBe('parse');
    expect(classifyInterpretFailure({ ok: false }, false)).toBe('error');            // no marker
  });

  it('getSummaryHealth aggregates success-rate, reasons, latency, and recent failures within the window', () => {
    const now = 1_000_000;
    // Pushed chronologically (ascending ts), as production does.
    recordInterpretOutcome({ ts: now - 20 * 60_000, project: P, session: 'old', ok: false, reason: 'error', latencyMs: 1 }); // outside window
    recordInterpretOutcome({ ts: now - 4000, project: P, session: 'd', ok: false, reason: 'timeout', latencyMs: 60000 });
    recordInterpretOutcome({ ts: now - 3000, project: P, session: 'c', ok: false, reason: 'rate-limit', latencyMs: 5000 });
    recordInterpretOutcome({ ts: now - 2000, project: P, session: 'b', ok: true, latencyMs: 300, inputTokens: 1000, outputTokens: 200, costUsd: 0.003 });
    recordInterpretOutcome({ ts: now - 1000, project: P, session: 'a', ok: true, latencyMs: 100, inputTokens: 500, outputTokens: 100, costUsd: 0.001 });

    const h = getSummaryHealth({ now, windowMs: 10 * 60_000 });
    expect(h.attempts).toBe(4);
    expect(h.successes).toBe(2);
    expect(h.successRate).toBe(0.5);
    expect(h.byReason).toEqual({ 'rate-limit': 1, timeout: 1 });
    expect(h.p50Ms).toBeGreaterThan(0);
    expect(h.p95Ms).toBeGreaterThanOrEqual(h.p50Ms);
    expect(h.recentFailures.map((f) => f.session)).toEqual(['c', 'd']); // most-recent failure first
    expect(h.inputTokens).toBe(1500);   // NON-cached input summed over the window
    expect(h.outputTokens).toBe(300);
    expect(h.costUsd).toBeCloseTo(0.004, 6);
  });

  it('getSummaryHealth sums cached input tokens into totalInputTokens', () => {
    const now = 3_000_000;
    // Realistic shape: tiny non-cached input, big cache-read (the system prompt).
    recordInterpretOutcome({ ts: now - 1000, project: P, session: 'a', ok: true, latencyMs: 100, inputTokens: 8, cacheReadTokens: 3500, cacheCreationTokens: 200, outputTokens: 400 });
    recordInterpretOutcome({ ts: now - 500, project: P, session: 'b', ok: true, latencyMs: 120, inputTokens: 8, cacheReadTokens: 3500, outputTokens: 400 });
    const h = getSummaryHealth({ now });
    expect(h.inputTokens).toBe(16);                 // non-cached only
    expect(h.cachedInputTokens).toBe(7200);         // 3500+200 + 3500
    expect(h.totalInputTokens).toBe(7216);          // the real input volume
    expect(h.outputTokens).toBe(800);
  });

  it('parseInterpretJson recovers JSON wrapped in prose or fences', () => {
    const obj = '{"paragraph":"We are building.","status":"working"}';
    // plain
    expect(parseInterpretJson(obj)?.paragraph).toBe('We are building.');
    // fenced
    expect(parseInterpretJson('```json\n' + obj + '\n```')?.status).toBe('working');
    // wrapped in prose (the failure mode that wasted ~39% of calls)
    expect(parseInterpretJson('Sure! Here is the summary:\n' + obj + '\nLet me know.')?.paragraph).toBe('We are building.');
    // genuinely unparseable → null
    expect(parseInterpretJson('I could not produce JSON, sorry.')).toBeNull();
    // valid JSON but missing required fields → null (coerce rejects)
    expect(parseInterpretJson('{"foo":1}')).toBeNull();
  });

  it('a rate-limit outcome trips the fleet-wide backoff (and is reported)', () => {
    const now = 2_000_000;
    expect(isInterpretRateLimited(now)).toBe(false);
    recordInterpretOutcome({ ts: now, project: P, session: 'x', ok: false, reason: 'rate-limit', latencyMs: 500 });
    expect(isInterpretRateLimited(now + 1000)).toBe(true);          // backing off now
    expect(isInterpretRateLimited(now + 5 * 60_000)).toBe(false);   // …lifts after the window
    expect(getSummaryHealth({ now: now + 1000 }).rateLimitBackoffMs).toBeGreaterThan(0);
  });

  it('getSummaryHealth reports successRate 1 with no attempts', () => {
    const h = getSummaryHealth({ now: 1_000_000 });
    expect(h.attempts).toBe(0);
    expect(h.successRate).toBe(1);
  });
});

describe('interpret fallback defers to fresh self-push', () => {
  it('fresh self-push ⇒ no interpret fired', async () => {
    const { intervalMs } = getSelfSummaryNudgeConfig();
    let interpretCallCount = 0;
    let pane = 'pane-A';
    const pushTime = 1000;

    // Seed an entry
    await runSessionSummaryTick(makeDeps({ capture: async () => pane, now: () => pushTime }));

    // Self-push at pushTime
    pushSessionSummary(P, S, { paragraph: 'Self-reported.', status: 'working' });

    // Change pane so change-gate would open, advance past throttle, but stay within staleness window
    pane = 'pane-B';
    const withinWindow = pushTime + Math.floor(intervalMs / 2);
    const deps = makeDeps({
      capture: async () => pane,
      now: () => withinWindow,
      interpret: async () => { interpretCallCount++; return { paragraph: 'Interpreted.', status: 'working' }; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Two ticks to ensure change-gate is open (second tick sees different prev hash)
    await runSessionSummaryTick(deps);
    await runSessionSummaryTick({ ...deps, now: () => withinWindow + 1 });
    await __drainInterpreters();

    expect(interpretCallCount).toBe(0); // self-push is fresh — interpret is the fallback, not run
    // No interpret ran ⇒ no outcome recorded ⇒ health attempts stays 0
    expect(getSummaryHealth({ now: withinWindow + 2 }).attempts).toBe(0);
  });

  it('stale self-push ⇒ interpret runs', async () => {
    const { intervalMs } = getSelfSummaryNudgeConfig();
    let interpretCallCount = 0;
    let pane = 'pane-A';

    // Seed an entry
    await runSessionSummaryTick(makeDeps({ capture: async () => pane, now: () => 1000 }));

    // Self-push — lastSelfPushAt is stamped with real Date.now() inside pushSessionSummary
    pushSessionSummary(P, S, { paragraph: 'Self-reported.', status: 'working' });
    // Capture real push time AFTER the call so beyondWindow is relative to the actual timestamp
    const pushTime = Date.now();

    // Advance time well past the staleness window
    pane = 'pane-B';
    const beyondWindow = pushTime + intervalMs + 60_000;
    const deps = makeDeps({
      capture: async () => pane,
      now: () => beyondWindow,
      interpret: async () => { interpretCallCount++; return { paragraph: 'Interpreted.', status: 'working' }; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    await runSessionSummaryTick(deps);
    await __drainInterpreters();

    expect(interpretCallCount).toBeGreaterThanOrEqual(1); // stale push → interpret backstop fires
  });

  it('no self-push (never pushed) ⇒ interpret runs via normal path', async () => {
    let interpretCallCount = 0;
    let pane = 'pane-A';
    let t = 1000;

    const deps = makeDeps({
      capture: async () => pane,
      now: () => t,
      interpret: async () => { interpretCallCount++; return { paragraph: 'Interpreted.', status: 'working' }; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    });

    // Seed
    await runSessionSummaryTick(deps);

    // Change pane + advance past throttle — no self-push, so interpret runs normally
    pane = 'pane-B';
    t = 50_000;
    await runSessionSummaryTick(deps);
    await __drainInterpreters();

    expect(interpretCallCount).toBeGreaterThanOrEqual(1);
  });

  it('force refresh (refreshSummaryNow) ignores fresh self-push and still calls interpret', async () => {
    const { intervalMs } = getSelfSummaryNudgeConfig();
    let interpretCallCount = 0;
    const pushTime = 1000;

    // Seed an entry
    await runSessionSummaryTick(makeDeps({ capture: async () => 'pane-content', now: () => pushTime }));

    // Self-push — still fresh
    pushSessionSummary(P, S, { paragraph: 'Self-reported.', status: 'working' });

    // Force refresh while the push is still within the staleness window
    const withinWindow = pushTime + Math.floor(intervalMs / 2);
    const result = await refreshSummaryNow(P, S, makeDeps({
      capture: async () => 'pane-content',
      now: () => withinWindow,
      interpret: async () => { interpretCallCount++; return { paragraph: 'Force-refreshed.', status: 'working' }; },
      summaryModel: () => ({ model: 'sonnet', effort: 'low' as const }),
    }));

    expect(result.ok).toBe(true);
    expect(interpretCallCount).toBe(1); // force refresh bypasses the self-push gate
  });
});

// ---------------------------------------------------------------------------
// Nudge-pass gate — pure + pass-level tests
// ---------------------------------------------------------------------------

describe('shouldSelfNudge (pure gate)', () => {
  const INTERVAL = 5 * 60_000;
  const NOW = 10 * 60_000;

  function entry(over: Partial<SessionSummaryEntry> = {}): SessionSummaryEntry {
    return {
      project: P, session: S, tmux: 'mc-alpha-worker-1',
      paneHash: 'h', paneSeenAt: 0, quietWindows: 1,
      progressState: 'quiet', updatedAt: 0,
      ...over,
    };
  }

  it('quiet + no question + never self-pushed + never nudged → true', () => {
    expect(shouldSelfNudge(entry(), -Infinity, NOW, INTERVAL)).toBe(true);
  });

  it('non-quiet progressState → false', () => {
    for (const state of ['active', 'stalled', 'wedged', 'unknown'] as const) {
      expect(shouldSelfNudge(entry({ progressState: state }), -Infinity, NOW, INTERVAL)).toBe(false);
    }
  });

  it('parked open question → false', () => {
    const e = entry({ structured: { paragraph: 'x', status: 'idle', question: 'Which way?' } });
    expect(shouldSelfNudge(e, -Infinity, NOW, INTERVAL)).toBe(false);
  });

  it('on-screen prompt (status needs-input) → false', () => {
    const e = entry({ structured: { paragraph: 'x', status: 'needs-input' } });
    expect(shouldSelfNudge(e, -Infinity, NOW, INTERVAL)).toBe(false);
  });

  it('re-nudge throttle (last nudge < intervalMs ago) → false', () => {
    // last nudge only 60s ago
    expect(shouldSelfNudge(entry(), NOW - 60_000, NOW, INTERVAL)).toBe(false);
  });

  it('self-pushed recently → false', () => {
    const e = entry({ lastSelfPushAt: NOW - 60_000 });
    expect(shouldSelfNudge(e, -Infinity, NOW, INTERVAL)).toBe(false);
  });

  it('stale self-push (older than interval) → true', () => {
    const e = entry({ lastSelfPushAt: NOW - 6 * 60_000 });
    expect(shouldSelfNudge(e, -Infinity, NOW, INTERVAL)).toBe(true);
  });
});

describe('runSelfSummaryNudgePass (pass orchestration)', () => {
  const INTERVAL = 5 * 60_000;
  const NOW = 10 * 60_000;

  function quietEntry(over: Partial<SessionSummaryEntry> = {}): SessionSummaryEntry {
    return {
      project: P, session: S, tmux: 'mc-alpha-worker-1',
      paneHash: 'h', paneSeenAt: 0, quietWindows: 1,
      progressState: 'quiet', updatedAt: 0,
      ...over,
    };
  }

  it('disabled config → no-op, nudge not called', async () => {
    const calls: Array<[string, string]> = [];
    const nudge = async (p: string, s: string) => { calls.push([p, s]); return 'sent' as const; };
    const result = await runSelfSummaryNudgePass({
      config: () => ({ enabled: false, intervalMs: INTERVAL }),
      listSummaries: () => [quietEntry()],
      nudge,
      now: () => NOW,
    });
    expect(result).toEqual({ scanned: 0, eligible: 0, nudged: [] });
    expect(calls).toHaveLength(0);
  });

  it('nudges ONLY quiet + no-pending-question + stale-self-push sessions', async () => {
    const S2 = 'worker-2';
    const S3 = 'worker-3';
    const S4 = 'worker-4';
    const calls: Array<[string, string]> = [];
    const nudge = async (p: string, s: string) => { calls.push([p, s]); return 'sent' as const; };
    const entries: SessionSummaryEntry[] = [
      quietEntry({ session: S }),                                                   // eligible
      { ...quietEntry(), session: S2, progressState: 'active' },                   // not quiet
      { ...quietEntry(), session: S3,
        structured: { paragraph: 'x', status: 'idle', question: 'Q?' } },         // has question
      { ...quietEntry(), session: S4, lastSelfPushAt: NOW },                       // fresh push
    ];
    const result = await runSelfSummaryNudgePass({
      config: () => ({ enabled: true, intervalMs: INTERVAL }),
      zenViewed: () => true,
      listSummaries: () => entries,
      nudge,
      now: () => NOW,
    });
    expect(result.eligible).toBe(1);
    expect(result.nudged).toEqual([S]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([P, S]);
  });

  it('skips active and question-parked sessions (never passed to nudge)', async () => {
    const S_ACTIVE = 'worker-active';
    const S_QPEND = 'worker-qpend';
    const calls: Array<[string, string]> = [];
    const nudge = async (p: string, s: string) => { calls.push([p, s]); return 'sent' as const; };
    const entries: SessionSummaryEntry[] = [
      { ...quietEntry(), session: S_ACTIVE, progressState: 'active' },
      { ...quietEntry(), session: S_QPEND,
        structured: { paragraph: 'x', status: 'idle', question: 'Next step?' } },
    ];
    await runSelfSummaryNudgePass({
      config: () => ({ enabled: true, intervalMs: INTERVAL }),
      zenViewed: () => true,
      listSummaries: () => entries,
      nudge,
      now: () => NOW,
    });
    const calledSessions = calls.map(([, s]) => s);
    expect(calledSessions).not.toContain(S_ACTIVE);
    expect(calledSessions).not.toContain(S_QPEND);
  });

  it("'busy'/'no-tmux' does NOT advance the throttle → retried next pass", async () => {
    let result1Return: 'sent' | 'busy' | 'no-tmux' = 'busy';
    const calls1: Array<[string, string]> = [];
    const nudge1 = async (p: string, s: string) => { calls1.push([p, s]); return result1Return; };

    // Pass 1 — busy → throttle NOT advanced
    const r1 = await runSelfSummaryNudgePass({
      config: () => ({ enabled: true, intervalMs: INTERVAL }),
      zenViewed: () => true,
      listSummaries: () => [quietEntry()],
      nudge: nudge1,
      now: () => NOW,
    });
    expect(r1.nudged).toEqual([]);

    // Pass 2 at same NOW — nudge returns 'sent' this time → should succeed since throttle not set
    result1Return = 'sent';
    const calls2: Array<[string, string]> = [];
    const nudge2 = async (p: string, s: string) => { calls2.push([p, s]); return 'sent' as const; };
    const r2 = await runSelfSummaryNudgePass({
      config: () => ({ enabled: true, intervalMs: INTERVAL }),
      zenViewed: () => true,
      listSummaries: () => [quietEntry()],
      nudge: nudge2,
      now: () => NOW,
    });
    expect(r2.nudged).toEqual([S]);
  });

  it("'sent' advances the throttle → not re-nudged within interval", async () => {
    const fixedT = NOW;
    const calls: Array<[string, string]> = [];
    const nudge = async (p: string, s: string) => { calls.push([p, s]); return 'sent' as const; };
    const passDeps = {
      config: () => ({ enabled: true, intervalMs: INTERVAL }),
      zenViewed: () => true,
      listSummaries: () => [quietEntry()],
      nudge,
      now: () => fixedT,
    };

    // Pass 1 — should nudge
    const r1 = await runSelfSummaryNudgePass(passDeps);
    expect(r1.nudged).toEqual([S]);

    // Pass 2 at same time — throttle was advanced, so not eligible
    const r2 = await runSelfSummaryNudgePass(passDeps);
    expect(r2.nudged).toEqual([]);
  });
});
