import { describe, it, expect, afterEach, mock } from 'bun:test';

// Mock the launch layer (owned by another module) so launchWorker's pool-routing
// path runs without a real tmux/claude. Must be registered before importing
// coordinator-live so its static `ensureSession`/`runTodoInSession` imports
// resolve to the mocks. POOL-4 splits spawn (ensureSession) from run (runTodoInSession).
let launchStarted = true;
const ensureSessionCalls: string[] = []; // session names ensureSession was called with
const ensureSessionOpts: Array<{ project: string; session: string; contextPrompt?: string }> = [];
const runTodoCalls: Array<{ session: string; invokeSkill: string }> = [];
mock.module('../claude-launch', () => ({
  ensureSession: async (opts: { project: string; session: string; contextPrompt?: string }) => {
    ensureSessionCalls.push(opts.session);
    ensureSessionOpts.push({ project: opts.project, session: opts.session, contextPrompt: opts.contextPrompt });
    return launchStarted ? { ready: true, tmux: `tmux-${opts.session}` } : { ready: false, reason: 'mock-blocked' };
  },
  runTodoInSession: async (opts: { session: string; invokeSkill: string }) => {
    runTodoCalls.push({ session: opts.session, invokeSkill: opts.invokeSkill });
    return { sent: true };
  },
}));
// updateTodo writes to the todo-store DB; stub it so the spawn test doesn't
// depend on a seeded todo row.
let completeSessionName = '';
mock.module('../todo-store', () => ({
  listReadyTodos: () => [],
  claimTodo: async () => null,
  releaseExpiredClaims: async () => {},
  completeTodo: async () => ({ completed: { sessionName: completeSessionName }, promoted: [] }),
  updateTodo: async () => {},
  getTodo: () => null,
  listTodos: () => [],
  reclaimClaim: async () => 'ready',
}));

import { makeCoordinatorDeps, startCoordinator, stopCoordinator, isCoordinatorRunning, autoStartCoordinator, isCoordinatorAutoManaged, resolveWorkerProfile, detectPermissionPrompt, extractRequestedTool, getCoordinatorLiveness, claudeAliveInSubtree, isClaudeTuiPresent } from '../coordinator-live';
import { isSupervised, removeSupervised, listSupervised } from '../supervisor-store';
import { resetPool, listPool, markBusy, markIdle } from '../worker-pool';
import type { Todo } from '../todo-store';

describe('makeCoordinatorDeps', () => {
  it('returns an object with all required function properties', () => {
    const deps = makeCoordinatorDeps();
    expect(typeof deps.listReadyTodos).toBe('function');
    expect(typeof deps.claimTodo).toBe('function');
    expect(typeof deps.releaseExpiredClaims).toBe('function');
    expect(typeof deps.completeTodo).toBe('function');
    expect(typeof deps.launchWorker).toBe('function');
  });
});

describe('resolveWorkerProfile', () => {
  it('makes the worker autonomous: invokeSkill targets the worker skill with the todo id', () => {
    const todo = { id: 'abc12345-dead-beef-0000-000000000000' } as Todo;
    const profile = resolveWorkerProfile(todo);
    expect(profile.invokeSkill).toBe(`/mermaid-collab:worker ${todo.id}`);
    expect(profile.allowedTools).toContain('mcp__plugin_mermaid-collab_mermaid');
  });
});

describe('startCoordinator / stopCoordinator / isCoordinatorRunning', () => {
  const PROJECT = 'test-coordinator-live-a';

  afterEach(() => {
    stopCoordinator(PROJECT);
  });

  it('starts and returns true; isCoordinatorRunning is true', () => {
    expect(startCoordinator(PROJECT, 3_600_000)).toBe(true);
    expect(isCoordinatorRunning(PROJECT)).toBe(true);
  });

  it('starting again returns false (already running)', () => {
    startCoordinator(PROJECT, 3_600_000);
    expect(startCoordinator(PROJECT, 3_600_000)).toBe(false);
  });

  it('stopCoordinator returns true and isCoordinatorRunning becomes false', () => {
    startCoordinator(PROJECT, 3_600_000);
    expect(stopCoordinator(PROJECT)).toBe(true);
    expect(isCoordinatorRunning(PROJECT)).toBe(false);
  });

  it('stopCoordinator returns false when not running', () => {
    expect(stopCoordinator(PROJECT)).toBe(false);
  });
});

describe('autoStartCoordinator (always-on + self-respawn)', () => {
  const PROJECT = 'test-coordinator-live-auto';

  afterEach(() => {
    stopCoordinator(PROJECT);
  });

  it('starts the loop and registers the project as auto-managed', () => {
    expect(autoStartCoordinator(PROJECT, 3_600_000)).toBe(true);
    expect(isCoordinatorRunning(PROJECT)).toBe(true);
    expect(isCoordinatorAutoManaged(PROJECT)).toBe(true);
  });

  it('is idempotent: a second call does not (re)start an already-running loop', () => {
    autoStartCoordinator(PROJECT, 3_600_000);
    expect(autoStartCoordinator(PROJECT, 3_600_000)).toBe(false);
    expect(isCoordinatorAutoManaged(PROJECT)).toBe(true);
  });

  it('an explicit stop opts the project out of auto-respawn', () => {
    autoStartCoordinator(PROJECT, 3_600_000);
    expect(stopCoordinator(PROJECT)).toBe(true);
    expect(isCoordinatorRunning(PROJECT)).toBe(false);
    expect(isCoordinatorAutoManaged(PROJECT)).toBe(false);
  });
});

describe('launchWorker auto-subscribe into Watching (POOL-2)', () => {
  const PROJECT = 'test-coordinator-live-spawn';

  const makeTodo = (id: string): Todo =>
    ({ id, type: 'frontend' } as Todo);

  // POOL-4: pool routing names the session by type+slot (frontend-1), not worker-<id8>.
  const POOL_SESSION = 'frontend-1';

  afterEach(() => {
    launchStarted = true;
    resetPool();
    ensureSessionCalls.length = 0;
    runTodoCalls.length = 0;
    for (const s of listSupervised()) {
      if (s.project === PROJECT) removeSupervised(s.project, s.session);
    }
  });

  it('registers the spawned pool session as supervised when the spawn succeeds', async () => {
    launchStarted = true;
    const todo = makeTodo('11111111-2222-3333-4444-555555555555');
    expect(isSupervised(PROJECT, POOL_SESSION)).toBe(false);

    const started = await makeCoordinatorDeps().launchWorker(PROJECT, todo);

    expect(started).toBe(true);
    expect(isSupervised(PROJECT, POOL_SESSION)).toBe(true);
    expect(listSupervised().find((s) => s.project === PROJECT && s.session === POOL_SESSION)?.source).toBe('spawn');
  });

  it('is idempotent: re-routing to the same warm pool session does not duplicate the subscription', async () => {
    launchStarted = true;
    const todo = makeTodo('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const deps = makeCoordinatorDeps();

    await deps.launchWorker(PROJECT, todo);
    // Free the slot (keep-warm) so the second route reuses the same session.
    markIdle(POOL_SESSION);
    await deps.launchWorker(PROJECT, todo);

    const matches = listSupervised().filter((s) => s.project === PROJECT && s.session === POOL_SESSION);
    expect(matches.length).toBe(1);
  });

  it('does NOT subscribe when the spawn fails to start', async () => {
    launchStarted = false;
    const todo = makeTodo('99999999-8888-7777-6666-555555555555');

    const started = await makeCoordinatorDeps().launchWorker(PROJECT, todo);

    expect(started).toBe(false);
    expect(isSupervised(PROJECT, POOL_SESSION)).toBe(false);
  });
});

// Helper: flip a pool slot back to idle between routes (markIdle is the prod path,
// but importing it here keeps the test intent — "the session is warm and free").
import { markIdle as resetPoolSlotIdle } from '../worker-pool';

describe('launchWorker pool routing & keep-warm (POOL-4)', () => {
  const PROJECT = 'test-coordinator-live-pool';

  const makeTodo = (id: string, type: string | null): Todo =>
    ({ id, type } as Todo);

  afterEach(() => {
    launchStarted = true;
    completeSessionName = '';
    resetPool();
    ensureSessionCalls.length = 0;
    runTodoCalls.length = 0;
    for (const s of listSupervised()) {
      if (s.project === PROJECT) removeSupervised(s.project, s.session);
    }
  });

  it('routes two same-type todos to ONE reused pool session', async () => {
    const deps = makeCoordinatorDeps();
    const t1 = makeTodo('11111111-1111-1111-1111-111111111111', 'backend');

    expect(await deps.launchWorker(PROJECT, t1)).toBe(true);
    // First todo completes → slot goes idle (keep-warm, not killed).
    completeSessionName = 'backend-1';
    await deps.completeTodo(PROJECT, t1.id, 'accepted');

    const t2 = makeTodo('22222222-2222-2222-2222-222222222222', 'backend');
    expect(await deps.launchWorker(PROJECT, t2)).toBe(true);

    // Same session reused: ensureSession called for backend-1 both times,
    // runTodoInSession sent the skill twice — only ONE slot exists.
    expect(ensureSessionCalls).toEqual(['backend-1', 'backend-1']);
    expect(runTodoCalls.map((c) => c.session)).toEqual(['backend-1', 'backend-1']);
    expect(Object.keys(listPool())).toEqual(['backend-1']);
  });

  it('routes two different-type todos to two distinct named sessions', async () => {
    const deps = makeCoordinatorDeps();
    expect(await deps.launchWorker(PROJECT, makeTodo('aaaaaaaa-1111-1111-1111-111111111111', 'frontend'))).toBe(true);
    expect(await deps.launchWorker(PROJECT, makeTodo('bbbbbbbb-2222-2222-2222-222222222222', 'api'))).toBe(true);

    expect(ensureSessionCalls).toEqual(['frontend-1', 'api-1']);
    expect(Object.keys(listPool()).sort()).toEqual(['api-1', 'frontend-1']);
  });

  it('untyped todo routes to the general pool', async () => {
    const deps = makeCoordinatorDeps();
    expect(await deps.launchWorker(PROJECT, makeTodo('cccccccc-3333-3333-3333-333333333333', null))).toBe(true);
    expect(ensureSessionCalls).toEqual(['general-1']);
  });

  it('defers (returns false, no spawn) when the type is at capacity', async () => {
    const deps = makeCoordinatorDeps();
    // First todo occupies the single backend slot.
    expect(await deps.launchWorker(PROJECT, makeTodo('dddddddd-1111-1111-1111-111111111111', 'backend'))).toBe(true);
    ensureSessionCalls.length = 0; // isolate the second attempt
    runTodoCalls.length = 0;

    // Second same-type todo while slot busy → at capacity → deferred.
    const started = await deps.launchWorker(PROJECT, makeTodo('eeeeeeee-2222-2222-2222-222222222222', 'backend'));

    expect(started).toBe(false);
    expect(ensureSessionCalls).toEqual([]); // nothing spawned
    expect(runTodoCalls).toEqual([]);
  });

  it('complete marks the slot idle (warm, not killed)', async () => {
    const deps = makeCoordinatorDeps();
    await deps.launchWorker(PROJECT, makeTodo('ffffffff-1111-1111-1111-111111111111', 'library'));
    expect(listPool()['library-1'].status).toBe('busy');

    completeSessionName = 'library-1';
    await deps.completeTodo(PROJECT, 'ffffffff-1111-1111-1111-111111111111', 'accepted');

    // Slot still exists (session kept warm) but is now idle and available.
    expect(listPool()['library-1'].status).toBe('idle');
    expect(listPool()['library-1'].currentTodoId).toBeUndefined();
  });
});

describe('detectPermissionPrompt (DOGFOOD #6 follow-up)', () => {
  // A realistic Claude Code permission-prompt pane for a non-allowlisted MCP tool.
  const permissionPane = [
    'I need to navigate the desktop to verify the layout.',
    '',
    'mcp__bsync-desktop__desktop_navigate(url: "http://localhost:9102")',
    '',
    'Do you want to proceed?',
    '❯ 1. Yes',
    "  2. Yes, and don't ask again for mcp__bsync-desktop__desktop_navigate",
    '  3. No, and tell Claude what to do differently (esc)',
  ].join('\n');

  it('classifies a permission prompt and extracts the MCP tool', () => {
    const r = detectPermissionPrompt(permissionPane);
    expect(r.isPermission).toBe(true);
    expect(r.tool).toBe('mcp__bsync-desktop__desktop_navigate');
  });

  it('classifies via the bare 1.Yes/3.No menu when the don\'t-ask line is absent', () => {
    const pane = [
      'SomeTool(arg: 1)',
      'Do you want to proceed?',
      ' 1. Yes',
      ' 3. No',
    ].join('\n');
    const r = detectPermissionPrompt(pane);
    expect(r.isPermission).toBe(true);
    expect(r.tool).toBe('SomeTool');
  });

  it('does NOT classify a self-filed escalation/decision stall as a permission prompt', () => {
    const decisionPane = [
      'I found two viable approaches. Which option should I take?',
      '  (a) Refactor the store',
      '  (b) Patch in place',
      'Recommended: (a)',
    ].join('\n');
    const r = detectPermissionPrompt(decisionPane);
    expect(r.isPermission).toBe(false);
    expect(r.tool).toBeNull();
  });

  it('does not false-trip on prose mentioning proceeding', () => {
    const prose = 'The build will proceed once tests pass. Do you want to proceed with caution generally?';
    // "Do you want to proceed?" substring matches, but there is no yes/no menu
    // and no don't-ask affordance, so it must NOT be treated as a permission prompt.
    const r = detectPermissionPrompt('The build will proceed once tests pass.');
    expect(r.isPermission).toBe(false);
  });

  it('extractRequestedTool prefers an mcp__ token, falls back to a tool-call line, else null', () => {
    expect(extractRequestedTool('mcp__srv__do_thing(x: 1)')).toBe('mcp__srv__do_thing');
    expect(extractRequestedTool('MyTool(arg)')).toBe('MyTool');
    expect(extractRequestedTool('just some prose with no tool call')).toBeNull();
  });
});

describe('PID-based liveness (63a59bd6 — dead Claude in a live tmux)', () => {
  type Snap = Map<number, { children: number[]; comm: string }>;
  const snap = (rows: Array<[number, number, string]>): Snap => {
    const m: Snap = new Map();
    for (const [pid, , comm] of rows) m.set(pid, { children: [], comm });
    for (const [pid, ppid] of rows) {
      if (!m.has(ppid)) m.set(ppid, { children: [], comm: '' });
      m.get(ppid)!.children.push(pid);
    }
    return m;
  };

  it('finds claude as a descendant of the pane shell (live worker)', () => {
    // pane shell (100) → claude (101). claude is alive.
    const s = snap([[100, 1, '-zsh'], [101, 100, 'claude']]);
    expect(claudeAliveInSubtree(100, s)).toBe(true);
  });

  it('finds claude under an intermediate wrapper process', () => {
    const s = snap([[100, 1, '-zsh'], [101, 100, 'node'], [102, 101, 'claude']]);
    expect(claudeAliveInSubtree(100, s)).toBe(true);
  });

  it('returns false for a bare shell with no claude descendant (the dead worker)', () => {
    // pane shell (100) with only a pager child — claude exited.
    const s = snap([[100, 1, '-zsh'], [103, 100, 'less']]);
    expect(claudeAliveInSubtree(100, s)).toBe(false);
  });

  it('does not escape the subtree (sibling claude under a different root)', () => {
    const s = snap([[100, 1, '-zsh'], [200, 1, '-zsh'], [201, 200, 'claude']]);
    expect(claudeAliveInSubtree(100, s)).toBe(false);
  });

  it('isClaudeTuiPresent: live Claude chrome vs a bare shell prompt', () => {
    expect(isClaudeTuiPresent('🧠 0% ctx | ← for agents')).toBe(true);
    expect(isClaudeTuiPresent('✻ Zesting… (26s · ↓ 1.1k tokens)')).toBe(true);
    expect(isClaudeTuiPresent('  3. No, and tell Claude what to do (esc to interrupt)')).toBe(true);
    expect(isClaudeTuiPresent('benmaderazo@host project %')).toBe(false);
    expect(isClaudeTuiPresent('➜  claude-mermaid-collab git:(master) ✗')).toBe(false);
  });
});

describe('launchWorker cross-project target (SEAM·collab)', () => {
  const TRACKING = 'test-coordinator-live-xproj';
  const TARGET = '/repos/build123d-ocp-mcp';

  afterEach(() => {
    launchStarted = true;
    resetPool();
    ensureSessionCalls.length = 0;
    ensureSessionOpts.length = 0;
    runTodoCalls.length = 0;
    for (const s of listSupervised()) {
      if (s.project === TRACKING) removeSupervised(s.project, s.session);
    }
  });

  it('spawns the worker with cwd = the todo.targetProject, not the tracking project', async () => {
    const todo = { id: 'aaaa1111-2222-3333-4444-555555555555', type: 'backend', targetProject: TARGET } as Todo;
    await makeCoordinatorDeps().launchWorker(TRACKING, todo);
    const opts = ensureSessionOpts.at(-1)!;
    expect(opts.project).toBe(TARGET);
    // and the worker is told its todo is tracked elsewhere
    expect(opts.contextPrompt).toContain(TRACKING);
    expect(opts.contextPrompt).toMatch(/CROSS-PROJECT TODO/);
  });

  it('defaults cwd to the tracking project when no targetProject (no cross-project note)', async () => {
    const todo = { id: 'bbbb1111-2222-3333-4444-555555555555', type: 'backend', targetProject: null } as Todo;
    await makeCoordinatorDeps().launchWorker(TRACKING, todo);
    const opts = ensureSessionOpts.at(-1)!;
    expect(opts.project).toBe(TRACKING);
    expect(opts.contextPrompt ?? '').not.toMatch(/CROSS-PROJECT TODO/);
  });
});

describe('coordinator self-liveness (1cb49878)', () => {
  // A huge interval keeps the tick from firing during the test, so we exercise the
  // registration + liveness contract deterministically (no real runTick / I/O).
  const P = '/tmp/coord-liveness-test';
  const BIG = 10_000_000;
  afterEach(() => { stopCoordinator(P); });

  it('start registers a healthy (non-stale) loop and reports liveness', () => {
    expect(startCoordinator(P, BIG)).toBe(true);
    expect(isCoordinatorRunning(P)).toBe(true);
    const live = getCoordinatorLiveness(P, BIG);
    expect(live.running).toBe(true);
    expect(live.stale).toBe(false);
    expect(live.lastTickAt).not.toBeNull();
  });

  it('a second start on a healthy loop is a no-op (returns false)', () => {
    expect(startCoordinator(P, BIG)).toBe(true);
    expect(startCoordinator(P, BIG)).toBe(false); // healthy → genuine no-op
  });

  it('stop clears the loop and its heartbeat', () => {
    startCoordinator(P, BIG);
    expect(stopCoordinator(P)).toBe(true);
    expect(isCoordinatorRunning(P)).toBe(false);
    expect(getCoordinatorLiveness(P, BIG).running).toBe(false);
    expect(getCoordinatorLiveness(P, BIG).lastTickAt).toBeNull();
  });

  it('a registered-but-STALE loop is force-restarted by start (the wedge fix)', async () => {
    expect(startCoordinator(P, BIG)).toBe(true);
    // intervalMs=0 makes the staleness window 0 → any elapsed time counts as stale.
    // Wait a beat so (now - seededHeartbeat) > 0 deterministically.
    await new Promise((r) => setTimeout(r, 3));
    expect(getCoordinatorLiveness(P, 0).stale).toBe(true);
    expect(startCoordinator(P, 0)).toBe(true); // stale → force-restart, NOT a no-op
  });
});
