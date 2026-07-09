/**
 * Tests for conductor land authority (G11): ownership gating + actor recording.
 *
 * Tests the authority decision at its real seam — checkOwnership composed with
 * resolveEpicId — plus default-actor invariant, landedByTrailer, and error cases.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-actor-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { checkOwnership, landedByTrailer, type LandActor } from '../../services/land-authority';
import { createTodo, getTodo, _closeProject, listTodos } from '../../services/todo-store';
import { upsertMission, setMissionPhase } from '../../services/mission-store';
import { _closeDb as _closeSupervisorDb } from '../../services/supervisor-store';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('land-epic-actor — authority gating', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-actor-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  });

  afterEach(() => {
    _closeProject(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('test 1 — actor omitted defaults to human, checkOwnership passes n/a', () => {
    // No actor specified → defaults to { kind: 'human' }
    const actor: LandActor = { kind: 'human' };
    const epic = { id: 'epic-123', title: '[EPIC] Test', status: 'planned' } as any;

    const result = checkOwnership(repo, epic.id, actor, [epic]);
    expect(result.ok).toBe(true);
    expect(result.ownership).toBe('n/a');
  });

  it('test 2 — daemon actor returns n/a ownership', () => {
    const actor: LandActor = { kind: 'daemon', level: 'auto' };
    const epic = { id: 'epic-456', title: '[EPIC] Test 2', status: 'planned' } as any;

    const result = checkOwnership(repo, epic.id, actor, [epic]);
    expect(result.ok).toBe(true);
    expect(result.ownership).toBe('n/a');
  });

  it('test 3 — daemon trailer is Landed-By: daemon:auto', () => {
    const actor: LandActor = { kind: 'daemon', level: 'auto' };
    const trailer = landedByTrailer(actor);
    expect(trailer).toBe('Landed-By: daemon:auto');
  });

  it('test 4 — human trailer is Landed-By: human', () => {
    const actor: LandActor = { kind: 'human' };
    const trailer = landedByTrailer(actor);
    expect(trailer).toBe('Landed-By: human');
  });

  it('test 5 — conductor trailer includes session', () => {
    const actor: LandActor = { kind: 'conductor', session: 'conductor-session-1' };
    const trailer = landedByTrailer(actor);
    expect(trailer).toBe('Landed-By: conductor:conductor-session-1');
  });

  it('test 6 — conductor + bucket epic (Inbox) → refuses with bucket-epic code', async () => {
    const bucketEpic = await createTodo(repo, {
      allowOrphan: true,
      title: '[EPIC] Inbox',
      ownerSession: 'conductor-1',
    });

    const actor: LandActor = { kind: 'conductor', session: 'conductor-1' };
    const todos = listTodos(repo, { includeCompleted: true });
    const result = checkOwnership(repo, bucketEpic.id, actor, todos);

    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('bucket');
    expect(result.blocker?.code).toBe('bucket-epic');
    expect(result.blocker?.message).toContain('bucket root');
  });

  it('test 7 — conductor + bucket epic (Bugfix inbox) → refuses with bucket-epic code', async () => {
    const bucketEpic = await createTodo(repo, {
      allowOrphan: true,
      title: '[EPIC] Bugfix inbox',
      ownerSession: 'conductor-1',
    });

    const actor: LandActor = { kind: 'conductor', session: 'conductor-1' };
    const todos = listTodos(repo, { includeCompleted: true });
    const result = checkOwnership(repo, bucketEpic.id, actor, todos);

    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('bucket');
    expect(result.blocker?.code).toBe('bucket-epic');
  });

  it("test 8 — conductor + epic under different session's active mission → refuses with foreign-mission code", async () => {
    // Create a mission owned by conductor-2
    const mission = await createTodo(repo, {
      allowOrphan: true,
      title: '[MISSION] Task for conductor-2',
      ownerSession: 'conductor-2',
    });
    upsertMission(repo, mission.id);
    setMissionPhase(repo, mission.id, 'execute');

    // Create an epic under that mission
    const epic = await createTodo(repo, {
      title: '[EPIC] Child of mission',
      ownerSession: 'conductor-2',
      parentId: mission.id,
    });

    // Try to land it as conductor-1
    const actor: LandActor = { kind: 'conductor', session: 'conductor-1' };
    const todos = listTodos(repo, { includeCompleted: true });
    const result = checkOwnership(repo, epic.id, actor, todos);

    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('foreign');
    expect(result.blocker?.code).toBe('foreign-mission');
    expect(result.blocker?.message).toContain('conductor-2'); // ownership record names the owner
  });

  it("test 9 — conductor + epic under its own active mission → authorized with owned status", async () => {
    // Create a mission owned by conductor-1
    const mission = await createTodo(repo, {
      allowOrphan: true,
      title: '[MISSION] Task for conductor-1',
      ownerSession: 'conductor-1',
    });
    upsertMission(repo, mission.id);
    setMissionPhase(repo, mission.id, 'execute');

    // Create an epic under that mission
    const epic = await createTodo(repo, {
      title: '[EPIC] Child of mission',
      ownerSession: 'conductor-1',
      parentId: mission.id,
    });

    // Land it as conductor-1
    const actor: LandActor = { kind: 'conductor', session: 'conductor-1' };
    const todos = listTodos(repo, { includeCompleted: true });
    const result = checkOwnership(repo, epic.id, actor, todos);

    expect(result.ok).toBe(true);
    expect(result.ownership).toBe('owned');
    expect(result.blocker).toBeUndefined();
  });

  it('test 10 — conductor lands its owned epic → trailer is Landed-By: conductor', async () => {
    const mission = await createTodo(repo, {
      allowOrphan: true,
      title: '[MISSION] Conductor test',
      ownerSession: 'conductor-session-xyz',
    });
    upsertMission(repo, mission.id);
    setMissionPhase(repo, mission.id, 'execute');

    const epic = await createTodo(repo, {
      title: '[EPIC] Owned work',
      ownerSession: 'conductor-session-xyz',
      parentId: mission.id,
    });

    const actor: LandActor = { kind: 'conductor', session: 'conductor-session-xyz' };
    const trailer = landedByTrailer(actor);
    expect(trailer).toBe('Landed-By: conductor:conductor-session-xyz');

    const todos = listTodos(repo, { includeCompleted: true });
    const check = checkOwnership(repo, epic.id, actor, todos);
    expect(check.ok).toBe(true);
  });

  it('test 11 — conductor landing a non-epic → refuses with not-an-epic code', async () => {
    // Create a regular work todo (not an epic)
    const workTodo = await createTodo(repo, {
      allowOrphan: true,
      title: 'Regular work',
      ownerSession: 'conductor-1',
    });

    const actor: LandActor = { kind: 'conductor', session: 'conductor-1' };
    const todos = listTodos(repo, { includeCompleted: true });
    const result = checkOwnership(repo, workTodo.id, actor, todos);

    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('not-an-epic');
  });

  it('test 12 — conductor + epic with no owning mission → refuses with no-active-mission code', async () => {
    // Create a solo epic without a mission parent
    const soloEpic = await createTodo(repo, {
      allowOrphan: true,
      title: '[EPIC] Orphan',
      ownerSession: 'conductor-1',
    });

    const actor: LandActor = { kind: 'conductor', session: 'conductor-1' };
    const todos = listTodos(repo, { includeCompleted: true });
    const result = checkOwnership(repo, soloEpic.id, actor, todos);

    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('no-active-mission');
  });

  it('test 13 — conductor + epic under a terminal mission → refuses with no-active-mission code', async () => {
    const mission = await createTodo(repo, {
      allowOrphan: true,
      title: '[MISSION] Done task',
      ownerSession: 'conductor-1',
    });
    upsertMission(repo, mission.id);
    setMissionPhase(repo, mission.id, 'converged');

    const epic = await createTodo(repo, {
      title: '[EPIC] Child of done mission',
      ownerSession: 'conductor-1',
      parentId: mission.id,
    });

    const actor: LandActor = { kind: 'conductor', session: 'conductor-1' };
    const todos = listTodos(repo, { includeCompleted: true });
    const result = checkOwnership(repo, epic.id, actor, todos);

    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('no-active-mission');
  });
});
