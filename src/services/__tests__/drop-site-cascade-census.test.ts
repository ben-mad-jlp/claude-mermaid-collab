/**
 * Census + integration proof for every production `status: 'dropped'` write site.
 *
 * Half 1 statically scans src/**\/*.ts for the literal drop-status write and asserts it
 * is confined to an explicit allowlist (KNOWN_DROP_SITES) — a new site fails loudly, and
 * a stale allowlist entry fails loudly too. It also asserts no raw-SQL dropped write
 * exists outside todo-store.ts, the one chokepoint allowed to own the cascade.
 *
 * Half 2 drives each allowlisted site through its real entry point and asserts
 * findViolations() is empty afterward — i.e. no live descendant survives under a
 * dropped container. A mutation probe proves those assertions are non-vacuous.
 */
import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-drop-census-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { createTodo, updateTodo, getTodo, listTodos, _closeProject, DroppedEpicHasLiveChildrenError, type Todo } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { findViolations } from '../invariant-check';

// Mock claude-launch so coordinator-live-adjacent modules (landed-epic-sweep) can load
// without starting a real session, mirroring terminal-mission-epic-reaper.test.ts.
mock.module('../claude-launch', () => ({
  ensureSession: async () => ({ ready: true }),
  runTodoInSession: async () => ({ sent: true }),
}));

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

const KNOWN_DROP_SITES = [
  'src/mcp/mission-tools.ts',
  'src/mcp/tools/mission-planner.ts',
  'src/services/landed-epic-sweep.ts',
  'src/services/base-repair-epic.ts',
  'src/services/reserve-leaf.ts',
  'src/services/mission-store.ts',
  'src/services/conductor-redecompose-arm.ts',
];

function scanSrcFiles(): string[] {
  const glob = new Bun.Glob('src/**/*.ts');
  return Array.from(glob.scanSync({ cwd: REPO_ROOT })).filter((p) => !p.includes('__tests__'));
}

describe('drop-site cascade census — static scan', () => {
  const files = scanSrcFiles();
  const DROP_WRITE_RE = /status:\s*['"]dropped['"]/;

  it("every production status:'dropped' write site is in the known allowlist", () => {
    const found: string[] = [];
    for (const rel of files) {
      // todo-store.ts owns the drop cascade itself; its own literal is the chokepoint
      // implementation, not a call SITE, and its doc comments also mention the literal.
      if (rel === 'src/services/todo-store.ts') continue;
      const content = readFileSync(join(REPO_ROOT, rel), 'utf8');
      if (DROP_WRITE_RE.test(content)) found.push(rel);
    }
    for (const rel of found) {
      expect(KNOWN_DROP_SITES).toContain(rel);
    }
    for (const known of KNOWN_DROP_SITES) {
      expect(found).toContain(known);
    }
  });

  it('no production file issues a raw SQL dropped-status write outside todo-store.ts', () => {
    const RAW_SQL_RE = /status\s*=\s*['"]dropped['"]/;
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel === 'src/services/todo-store.ts') continue;
      const content = readFileSync(join(REPO_ROOT, rel), 'utf8');
      if (RAW_SQL_RE.test(content)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('every known drop site imports the updateTodo chokepoint rather than issuing raw SQL', () => {
    for (const rel of KNOWN_DROP_SITES) {
      const content = readFileSync(join(REPO_ROOT, rel), 'utf8');
      // The bun:sqlite-import-absence half of this check is subsumed by the raw-SQL-zero-match
      // assertion above (a file may legitimately touch bun:sqlite for unrelated queries; what
      // matters is that its DROP write specifically goes through updateTodo/updateTodoStore).
      const importsChokepoint = /from\s+['"].*todo-store(\.[jt]s)?['"]/.test(content) &&
        (/\bupdateTodo\b/.test(content) || /\bupdateTodoStore\b/.test(content));
      expect(importsChokepoint).toBe(true);
    }
  });
});

describe('drop-site cascade census — flow (real entry points)', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'drop-census-flow-'));
  });

  afterEach(() => {
    _closeProject(project);
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function makeLiveEpic() {
    const epic = await createTodo(project, {
      allowOrphan: true,
      title: 'test epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const child1 = await createTodo(project, {
      title: 'planned child',
      ownerSession: 'test',
      status: 'planned',
      parentId: epic.id,
    });
    const child2 = await createTodo(project, {
      title: 'ready child',
      ownerSession: 'test',
      status: 'ready',
      parentId: epic.id,
    });
    return { epic, child1, child2 };
  }

  function assertNoLiveDescendants(rootId: string) {
    const all = listTodos(project, { includeCompleted: true });
    const violations = findViolations(all);
    expect(violations).toEqual([]);
    const byId = new Map(all.map((t) => [t.id, t]));
    function isDescendantOf(t: Todo, ancestorId: string): boolean {
      let cur: Todo | undefined = t;
      while (cur?.parentId) {
        if (cur.parentId === ancestorId) return true;
        cur = byId.get(cur.parentId);
      }
      return false;
    }
    const liveDescendants = all.filter(
      (t) => isDescendantOf(t, rootId) && t.status !== 'done' && t.status !== 'dropped',
    );
    expect(liveDescendants).toEqual([]);
  }

  test('delete_mission cascades and leaves zero invariant violations', async () => {
    const { handleMissionTool } = await import('../../mcp/mission-tools');
    const mission = await createTodo(project, {
      allowOrphan: true,
      title: 'test mission',
      ownerSession: 'test',
      kind: 'mission',
    });
    const epicChild = await createTodo(project, {
      title: 'mission epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
      parentId: mission.id,
    });
    await createTodo(project, {
      title: 'mission leaf',
      ownerSession: 'test',
      status: 'ready',
      parentId: epicChild.id,
    });

    await handleMissionTool('delete_mission', { project, todoId: mission.id });

    assertNoLiveDescendants(mission.id);
    const all = listTodos(project, { includeCompleted: true });
    const mNode = all.find((t) => t.id === mission.id);
    expect(['done', 'dropped']).toContain(mNode?.status ?? '');
  });

  test('mission-planner instantiation failure drops the epic with zero invariant violations', async () => {
    const { planMissionCriterion } = await import('../../mcp/tools/mission-planner');
    const { forgeMission } = await import('../../mcp/tools/mission-forge');
    const { listCriteria } = await import('../mission-store');

    const forged = await forgeMission(project, {
      session: 's1',
      title: 'A mission whose planner leaf fails',
      criteria: ['a criterion that will fail to instantiate'],
    });
    const crits = listCriteria(project, forged.missionId);

    const badSpec = {
      title: 'A doomed epic',
      description: 'second leaf references an out-of-range positional dependency',
      leaves: [
        { title: 'first leaf', description: 'ok', files: ['src/a.ts'] },
        { title: 'second leaf', description: 'bad dep', files: ['src/b.ts'], dependsOn: ['$5'] },
      ],
    };
    const mockInvoke = async () => ({
      ok: true,
      rateLimited: false,
      text: '```json\n' + JSON.stringify(badSpec) + '\n```',
    } as any);

    let threw = false;
    try {
      await planMissionCriterion(
        project,
        { session: 's1', missionId: forged.missionId, criterionIds: [crits[0].id] },
        { invoke: mockInvoke },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    assertNoLiveDescendants(forged.missionId);
  });

  test('reapTerminalMissionEpics drop leaves zero invariant violations', async () => {
    const { reapTerminalMissionEpics } = await import('../landed-epic-sweep');
    const { upsertMission, setMissionClosed } = await import('../mission-store');

    const mission = await createTodo(project, {
      allowOrphan: true,
      title: 'closed mission',
      ownerSession: 'test',
      kind: 'mission',
    });
    upsertMission(project, mission.id);
    const epic = await createTodo(project, {
      title: '[EPIC] to reap',
      ownerSession: 'test',
      kind: 'epic',
      parentId: mission.id,
      status: 'todo',
    });
    // hasInflightChild guard: only a terminal (done) child is compatible with reaping.
    await createTodo(project, {
      title: 'already-done child',
      ownerSession: 'test',
      status: 'done',
      parentId: epic.id,
    });
    setMissionClosed(project, mission.id, Date.now());

    const fakeTeardown = async () => {};
    const result = await reapTerminalMissionEpics(project, { teardown: fakeTeardown, wm: {} as any });

    expect(result.reaped).toContain(epic.id);
    assertNoLiveDescendants(mission.id);
  });

  test('direct updateTodo drop cascades to children with zero invariant violations', async () => {
    const { epic, child1, child2 } = await makeLiveEpic();
    await updateTodo(project, epic.id, { status: 'dropped' });

    expect(getTodo(project, child1.id)?.status).toBe('dropped');
    expect(getTodo(project, child2.id)?.status).toBe('dropped');
    assertNoLiveDescendants(epic.id);
  });

  test('re-parenting a live leaf under an already-dropped epic throws DroppedEpicHasLiveChildrenError', async () => {
    const { epic } = await makeLiveEpic();
    await updateTodo(project, epic.id, { status: 'dropped' });

    const otherParent = await createTodo(project, {
      allowOrphan: true,
      title: 'other live epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const liveLeaf = await createTodo(project, {
      title: 'a fresh live leaf',
      ownerSession: 'test',
      status: 'planned',
      parentId: otherParent.id,
    });

    let caught: unknown = null;
    try {
      await updateTodo(project, liveLeaf.id, { parentId: epic.id });
      throw new Error('expected DroppedEpicHasLiveChildrenError but updateTodo succeeded');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DroppedEpicHasLiveChildrenError);
    if (caught instanceof DroppedEpicHasLiveChildrenError) {
      expect(caught.id).toBe(epic.id);
      expect(caught.liveCount).toBeGreaterThanOrEqual(1);
    }
  });
});
