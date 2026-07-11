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
// Conflict-path test hooks: a configurable completeTodo result (so the merge-back
// branch sees a real targetProject/title) and an updateTodo spy (to assert the
// blocked-park reversal). Defaults keep every existing test unchanged.
let completeResultExtra: Record<string, unknown> = {};
const updateTodoCalls: Array<{ id: string; patch: any }> = [];
let resetTodoCalls: Array<{ id: string; status: string }> = [];
// Overridable by the terminal-children describe block below: listTodos is stubbed
// module-wide (no real DB in this file), so those tests point this at fixture rows
// instead of touching todo-store's real listTodos.
let mockListTodosImpl: (project: string, opts: any) => any[] = () => [];
mock.module('../todo-store', () => ({
  listReadyTodos: () => [],
  claimTodo: async () => null,
  releaseExpiredClaims: async () => {},
  completeTodo: async () => ({ completed: { sessionName: completeSessionName, ...completeResultExtra }, promoted: [], rolledUp: [] }),
  updateTodo: async (_project: string, id: string, patch: any) => { updateTodoCalls.push({ id, patch }); return { id, ...patch }; },
  resetTodo: async (_project: string, id: string, status: string) => { resetTodoCalls.push({ id, status }); return { id, status }; },
  getTodo: () => null,
  listTodos: (project: string, opts: any) => mockListTodosImpl(project, opts),
  reclaimClaim: async () => 'ready',
  releaseClaim: async () => {},
  reclaimOrphan: async () => null,
}));

import { makeCoordinatorDeps, resolveWorkerProfile, detectPermissionPrompt, extractRequestedTool, claudeAliveInSubtree, isClaudeTuiPresent, partitionEpicChildrenByRepo, getColdStartsInFlight, getWorktreeManager, isHeadlessLeaf, headlessExclusionReason, displayTitle } from '../coordinator-live';
import { isSupervised, removeSupervised, listSupervised } from '../supervisor-store';
import { resetPool, listPool, markBusy, markIdle, removeSlot, getOrCreateSlot } from '../worker-pool';
import { promises as fsp } from 'node:fs';
import type { Todo } from '../todo-store';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _clearManifestCache } from '../../config/project-manifest';

// Isolate the GLOBAL supervisor.db so launchWorker's addSupervised/addWatchedProject
// (coordinator-live.ts) NEVER pollute the real ~/.mermaid-collab registry the live
// Bridge reads. Without this, every run of this suite re-registered
// `test-coordinator-live-*` as watched projects that kept reappearing in the Bridge
// after the human removed them. Set before any supervisor-store call (the DB opens
// lazily, reading this env in openDb()).
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'mc-coord-live-supervisor-'));
// Absolute tmp roots so the spawn/pool/xproj suites create their .collab scratch
// under /tmp instead of littering the repo cwd. Basenames are preserved so
// tmuxBaseName slugs (and name assertions) are unchanged.
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'mc-coord-live-projects-'));

describe('isHeadlessLeaf — non-code leaf exclusion', () => {
  const base = (over: Partial<Todo>): Todo => ({ id: 'x', title: 'a leaf', assigneeKind: 'agent', type: 'backend', kind: 'leaf', ...(over as any) }) as Todo;
  it('ADMITS reviewer-type leaves (epic d8ac1a18: they run the review execution shape, no longer stranded)', () => {
    expect(isHeadlessLeaf(base({ type: 'reviewer', id: 'reviewer-no-children' }), TEST_ROOT)).toBe(true);
  });
  it('excludes human-owned, epic-kind, mission-kind, and [GATE] leaves', () => {
    // role now comes from `kind`, not the title; the stage-C strip removed the prefix
    expect(isHeadlessLeaf(base({ assigneeKind: 'human' }), TEST_ROOT)).toBe(false);
    expect(isHeadlessLeaf(base({ kind: 'epic', title: 'Bugfix inbox' }), TEST_ROOT)).toBe(false);
    expect(isHeadlessLeaf(base({ kind: 'mission', title: 'Converge X' }), TEST_ROOT)).toBe(false);
    expect(isHeadlessLeaf(base({ kind: 'leaf', title: '[GATE] x' }), TEST_ROOT)).toBe(false);
    // topic tag ≠ role prefix: a bare-titled leaf that merely starts with a bracket is claimable
    expect(isHeadlessLeaf(base({ kind: 'leaf', title: '[UI] Plan list refresh' }), TEST_ROOT)).toBe(true);
  });
  it('admits an ordinary agent code leaf', () => {
    expect(isHeadlessLeaf(base({ id: 'no-children-in-empty-project' }), TEST_ROOT)).toBe(true);
  });
  it('EXCLUDES land leaves even when agent-assigned (an agent must never build a merge)', () => {
    expect(isHeadlessLeaf(base({ kind: 'land', title: 'merge epic to master', assigneeKind: 'agent' }), TEST_ROOT)).toBe(
      false,
    );
    // The exclusion keys off `kind`: a bare-titled land node is still excluded, and a
    // plain leaf whose title merely mentions landing is still admitted.
    expect(isHeadlessLeaf(base({ kind: 'land', title: 'no bracket in sight' }), TEST_ROOT)).toBe(false);
    expect(isHeadlessLeaf(base({ kind: 'leaf', title: 'fix the landing page copy' }), TEST_ROOT)).toBe(true);
  });
});

describe('displayTitle', () => {
  it('labels a role-kind todo with its bracketed prefix', () => {
    expect(displayTitle({ kind: 'epic', title: 'Bugfix inbox' })).toBe('[EPIC] Bugfix inbox');
  });
  it('is idempotent against a still-prefixed stored title (no doubling)', () => {
    expect(displayTitle({ kind: 'epic', title: '[EPIC] Bugfix inbox' })).toBe('[EPIC] Bugfix inbox');
  });
});

describe('isHeadlessLeaf / headlessExclusionReason — terminal children', () => {
  const parent = { id: 'parent-1', kind: 'leaf', title: 'leaf', assigneeKind: 'agent', type: 'backend' } as Todo;
  const childBase = { id: 'child-1', kind: 'leaf' as const, parentId: 'parent-1', title: 'child', assigneeKind: 'agent', type: 'backend' };
  afterEach(() => {
    mockListTodosImpl = () => [];
  });

  it('a dropped-only child does not make the parent a container', () => {
    mockListTodosImpl = () => [{ ...childBase, status: 'dropped' }];
    expect(isHeadlessLeaf(parent, TEST_ROOT)).toBe(true);
    expect(headlessExclusionReason(parent, TEST_ROOT)).toBeNull();
  });

  it('a done-only child does not make the parent a container (regression pin)', () => {
    mockListTodosImpl = () => [{ ...childBase, status: 'done' }];
    expect(isHeadlessLeaf(parent, TEST_ROOT)).toBe(true);
    expect(headlessExclusionReason(parent, TEST_ROOT)).toBeNull();
  });

  it('a planned (open) child makes the parent a container', () => {
    mockListTodosImpl = () => [{ ...childBase, status: 'planned' }];
    expect(isHeadlessLeaf(parent, TEST_ROOT)).toBe(false);
    expect(headlessExclusionReason(parent, TEST_ROOT)).toBe('has-children');
  });
});

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

describe('reapDeadClaims — dup-dispatch / claim-lost guard (audit c11df7d3)', () => {
  afterEach(() => { mockListTodosImpl = () => []; });

  it('does NOT reclaim a headless leaf (its liveness shield isRunLive is wiped on restart → would re-mint the claim audit-silently and dup-dispatch)', async () => {
    // in_progress headless code leaf, no live run registered (simulates the post-restart
    // liveRuns wipe), a persisted lane name, and a tmux that is not alive.
    const leaf = {
      id: 'headless-leaf-1', kind: 'leaf', type: 'backend', title: '[UI] refresh plan list',
      assigneeKind: 'agent', status: 'in_progress', parentId: 'epic-1',
      sessionName: 'worker-headless-1', claimedBy: 'coordinator', claimToken: 'tok-A',
    } as unknown as Todo;
    mockListTodosImpl = (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]);
    const deps = makeCoordinatorDeps();
    const res = await deps.reapDeadClaims!(TEST_ROOT);
    // Excluded before any probe/reclaim → not reclaimed, not exhausted.
    expect(res.reclaimed).not.toContain('headless-leaf-1');
    expect(res.exhausted).not.toContain('headless-leaf-1');
  });

  it('STILL reclaims a genuinely dead non-headless claim (land leaf) — the reaper keeps its coverage', async () => {
    const land = {
      id: 'land-leaf-1', kind: 'land', type: 'backend', title: 'merge epic to master',
      assigneeKind: 'agent', status: 'in_progress', parentId: 'epic-1',
      sessionName: 'worker-dead-lane', claimedBy: 'coordinator', claimToken: 'tok-B',
    } as unknown as Todo;
    mockListTodosImpl = () => [land];
    const deps = makeCoordinatorDeps();
    const res = await deps.reapDeadClaims!(TEST_ROOT);
    // isHeadlessLeaf(land) === false → not skipped → dead-lane reclaim proceeds (mock → 'ready').
    expect(res.reclaimed).toContain('land-leaf-1');
  });
});

describe('resolveWorkerProfile', () => {
  it('makes the worker autonomous: invokeSkill targets the worker skill with the todo id', () => {
    const todo = { id: 'abc12345-dead-beef-0000-000000000000' } as Todo;
    const profile = resolveWorkerProfile(todo);
    expect(profile.invokeSkill).toBe(`/mermaid-collab:worker ${todo.id}`);
    expect(profile.allowedTools).toContain('mcp__plugin_mermaid-collab_mermaid');
  });

  it('no project / no manifest → composes nothing extra (pure L1)', () => {
    const todo = { id: 't1', type: 'backend' } as Todo;
    const profile = resolveWorkerProfile(todo);
    // capability/base tools present; no pack tools folded in.
    expect(profile.allowedTools).toContain('Bash');
    expect(profile.allowedTools).not.toContain('mcp__build123d');
  });

  describe('L3 composition (capability × tech-packs × project-context)', () => {
    let project: string;
    function writeManifest(obj: unknown): void {
      mkdirSync(join(project, '.collab'), { recursive: true });
      writeFileSync(join(project, '.collab', 'project.json'), JSON.stringify(obj), 'utf8');
      _clearManifestCache(project);
    }
    afterEach(() => {
      if (project) { _clearManifestCache(project); rmSync(project, { recursive: true, force: true }); }
    });

    it('a cad-primary project folds the cad pack tools + context onto the profile, deduped', () => {
      project = mkdtempSync(join(tmpdir(), 'rwp-cad-'));
      writeManifest({
        packs: ['cad'],
        primaryPack: 'cad',
        profiles: { backend: { contextPrompt: 'build123d repo: run pytest under py3.10.' } },
      });
      const todo = { id: 't-cad', type: 'backend' } as Todo;
      const p = resolveWorkerProfile(todo, project);
      // cad pack tools ADDED to the base surface…
      expect(p.allowedTools).toContain('mcp__build123d-ocp-mcp');
      expect(p.allowedTools).toContain('Bash'); // base capability tools still present
      // …with no duplicate tokens.
      const toks = p.allowedTools.split(/\s+/);
      expect(new Set(toks).size).toBe(toks.length);
      // project-context + the cad pack's domain context BOTH composed in.
      expect(p.contextPrompt).toContain('build123d repo: run pytest'); // project-context
      expect(p.contextPrompt).toContain('a script that RUNS is not a part that EXISTS'); // cad pack
    });

    it('primary pack comes first in the composed context', () => {
      project = mkdtempSync(join(tmpdir(), 'rwp-order-'));
      writeManifest({ packs: ['web-react', 'cad'], primaryPack: 'cad' });
      const p = resolveWorkerProfile({ id: 't', type: 'backend' } as Todo, project);
      const cadAt = p.contextPrompt?.indexOf('build123d') ?? -1;
      const reactAt = p.contextPrompt?.indexOf('React + TypeScript') ?? -1;
      expect(cadAt).toBeGreaterThanOrEqual(0);
      expect(reactAt).toBeGreaterThan(cadAt); // primary (cad) precedes the rest
    });
  });
});


// Helper: flip a pool slot back to idle between routes (markIdle is the prod path,
// but importing it here keeps the test intent — "the session is warm and free").

// --- DEFECT 2+3: conflicted merge-back parks BLOCKED + tears down ----------------
// A real temp git repo with an epic branch and a worker branch that genuinely
// CONFLICTS on merge-back. With isolation on, the completeTodo callback must:
//   - NOT leave the todo accepted (park it status='blocked', acceptance cleared);
//   - keep the escalation (human integrates the branch);
//   - tear down the lane slot/worktree so it can't be reused stale.
async function gitRun(cwd: string, args: string[]): Promise<void> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  await proc.exited;
}

describe('completeTodo merge-back conflict (DEFECT 2+3)', () => {
  let repo: string;
  const SESSION = 'backend-claude-1';
  const TODO_ID = '99999999-9999-9999-9999-999999999999';

  afterEach(async () => {
    delete process.env.MERMAID_WORKER_ISOLATION;
    completeSessionName = '';
    completeResultExtra = {};
    updateTodoCalls.length = 0;
    resetTodoCalls = [];
    resetPool();
    if (repo) await fsp.rm(repo, { recursive: true, force: true }).catch(() => {});
  });

  it('parks the todo BLOCKED, keeps it un-accepted, and tears down the slot', async () => {
    process.env.MERMAID_WORKER_ISOLATION = '1';
    repo = mkdtempSync(join(tmpdir(), 'mc-conflict-repo-'));
    await gitRun(repo, ['init', '-q', '-b', 'master']);
    await gitRun(repo, ['config', 'user.email', 't@t']);
    await gitRun(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'f.txt'), 'base\n');
    await gitRun(repo, ['add', '-A']);
    await gitRun(repo, ['commit', '-q', '-m', 'base']);

    const wm = getWorktreeManager(repo);
    // Inbox epic accumulation branch + worktree (resolveEpicId → inbox for a todo
    // with no epic parent).
    const epic = await wm.ensureEpic('inbox');
    expect(epic).not.toBeNull();
    // Advance the epic branch with a conflicting edit to f.txt.
    writeFileSync(join(epic!.path, 'f.txt'), 'epic-side\n');
    await gitRun(epic!.path, ['commit', '-aqm', 'epic edit']);

    // The worker lane: a fresh worktree off the ORIGINAL base, edits f.txt
    // differently → merge into the (now-advanced) epic branch conflicts.
    const wt = await wm.ensure(SESSION, { baseBranch: 'master', fresh: true });
    writeFileSync(join((wt as any).path, 'f.txt'), 'worker-side\n');

    // Register the pool slot so we can prove teardown removes it.
    const slot = getOrCreateSlot(repo, 'backend');
    expect(slot).toBeDefined();
    markBusy(repo, SESSION, TODO_ID, `tmux-${SESSION}`);
    expect(listPool().some((s) => s.project === repo && s.sessionName === SESSION)).toBe(true);

    completeSessionName = SESSION;
    completeResultExtra = { targetProject: repo, title: 'conflicty todo', acceptanceStatus: 'accepted', kind: 'leaf', parentId: null };

    const deps = makeCoordinatorDeps();
    await deps.completeTodo(repo, TODO_ID, 'accepted');

    // The accept was reversed: updateTodo parked it BLOCKED with acceptance cleared.
    const park = updateTodoCalls.find((c) => c.id === TODO_ID && c.patch?.status === 'blocked');
    expect(park).toBeDefined();
    expect(park!.patch.acceptanceStatus).toBeNull();
    expect(park!.patch.completed).toBe(false);

    // The lane slot was torn down (cannot be reused stale).
    expect(listPool().some((s) => s.project === repo && s.sessionName === SESSION)).toBe(false);

    // The worktree dir was removed, but the worker BRANCH survives for the human.
    expect(await wm.existingPath(SESSION)).toBeNull();
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

describe('partitionEpicChildrenByRepo (FBPE P5 — cross-repo epics)', () => {
  const child = (id: string, targetProject: string | null): Todo =>
    ({ id, targetProject } as unknown as Todo);
  const TRACK = '/repo/track';
  const OTHER = '/repo/other';

  it('single-repo: repo-less children fall to the tracking project, no ambiguity', () => {
    const { byRepo, ambiguous } = partitionEpicChildrenByRepo(
      [child('a', null), child('b', null)],
      TRACK,
    );
    expect(ambiguous).toEqual([]);
    expect([...byRepo.keys()]).toEqual([TRACK]);
    expect(byRepo.get(TRACK)).toEqual(['a', 'b']);
  });

  it('cross-repo: children partition by their explicit targetProject (one branch per repo)', () => {
    const { byRepo, ambiguous } = partitionEpicChildrenByRepo(
      [child('a', TRACK), child('b', OTHER), child('c', OTHER)],
      TRACK,
    );
    expect(ambiguous).toEqual([]);
    expect(byRepo.get(TRACK)).toEqual(['a']);
    expect(byRepo.get(OTHER)).toEqual(['b', 'c']);
  });

  it('cross-repo with a repo-less child → that child is ambiguous (unplaceable, escalate)', () => {
    const { byRepo, ambiguous } = partitionEpicChildrenByRepo(
      [child('a', OTHER), child('orphan', null)],
      TRACK,
    );
    expect(ambiguous).toEqual(['orphan']);
    expect(byRepo.get(OTHER)).toEqual(['a']);
    expect(byRepo.has(TRACK)).toBe(false);
  });

  it('children explicitly targeting the tracking project are NOT foreign (no ambiguity)', () => {
    const { byRepo, ambiguous } = partitionEpicChildrenByRepo(
      [child('a', TRACK), child('b', null)],
      TRACK,
    );
    expect(ambiguous).toEqual([]);
    expect(byRepo.get(TRACK)).toEqual(['a', 'b']);
  });
});
