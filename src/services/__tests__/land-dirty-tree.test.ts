/**
 * Tests for the L1 land-path hardening:
 *   1. landEpic refuses when the main checkout is dirty (lists dirty paths).
 *   2a. allowDirty:true bypasses the refusal and records a friction note
 *       (retryReason: 'land-allow-dirty').
 *   2b. landEpicToMaster with allowDirtyPaths appends an Allow-Dirty: trailer.
 *
 * Tests 1 and 2a use the full landEpic path (via coordinator-live).
 * Test 2b is deliberately tested at the landEpicToMaster seam: landEpic's success
 * path calls realRunners.tscClean (npx tsc), which fails in a tsconfig-less temp
 * repo — so we cannot assert landed:true through landEpic without a real project.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-dirty-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { landEpic } from '../coordinator-live';
import { createTodo, getTodo, _closeProject } from '../todo-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { listFriction, _closeProject as _closeFriction } from '../friction-store';
import { WorktreeManager } from '../../agent/worktree-manager';

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

describe('landEpic — dirty-tree refusal and allowDirty bypass', () => {
  let repo: string;
  let epicId: string;
  let escalationId: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-dirty-repo-'));
    // Must be master — landEpicToMaster defaults to baseRef='master'.
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    // Seed the work-graph so landEpic can resolve the escalation → todo → epic.
    // Explicit kind (decision e852fb0c, stage C) — the title prefix no longer decides role.
    const epic = await createTodo(repo, { allowOrphan: true,
      title: '[EPIC] land test',
      ownerSession: 'test',
      kind: 'epic',
    });
    epicId = epic.id;
    const landChild = await createTodo(repo, { allowOrphan: true,
      title: '[LAND] → master',
      ownerSession: 'test',
      parentId: epic.id,
      kind: 'land',
    });
    const { escalation } = createEscalation({
      project: repo,
      session: 'sX',
      kind: 'epic-ready-to-land',
      questionText: 'ready to land?',
      todoId: landChild.id,
    });
    escalationId = escalation.id;
  });

  afterEach(() => {
    _closeProject(repo);
    _closeFriction(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('test 1 — refuses when the main checkout is dirty and lists the dirty paths', async () => {
    // Write an untracked file to make the checkout dirty.
    writeFileSync(join(repo, 'dirty.txt'), 'uncommitted\n');

    const out = await landEpic(repo, escalationId);

    expect(out.ok).toBe(false);
    expect(out.landed).toBe(false);
    expect(out.reason).toBe('dirty-tree');
    expect(Array.isArray((out as any).dirtyPaths)).toBe(true);
    expect((out as any).dirtyPaths).toContain('dirty.txt');
  });

  it('test 2a — allowDirty:true bypasses refusal and records land-allow-dirty friction', async () => {
    // Same dirty checkout.
    writeFileSync(join(repo, 'dirty.txt'), 'uncommitted\n');

    const out = await landEpic(repo, escalationId, { allowDirty: true });

    // Did NOT refuse with dirty-tree — it proceeded past the guard.
    // Will fail later (tsc-failed / epic-children-incomplete) in the temp repo; that's fine.
    expect(out.reason).not.toBe('dirty-tree');

    // A friction note with retryReason 'land-allow-dirty' must have been recorded.
    const notes = listFriction(repo, {});
    const note = notes.find((n) => n.retryReason === 'land-allow-dirty');
    expect(note).toBeTruthy();
    expect(note!.layer).toBe('orchestration');
    expect(note!.detail).toContain('dirty.txt');
  });
});

describe('landEpicToMaster — Allow-Dirty trailer on the land commit', () => {
  let repo: string;
  let mgr: WorktreeManager;
  const epicId = 'trailer-epic';

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-trailer-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: join(repo, '.collab', 'agent-sessions', 'worktrees'),
      persistDir: join(repo, '.collab', 'agent-sessions'),
    });
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('test 2b — Allow-Dirty trailer is appended when allowDirtyPaths is provided', async () => {
    // Create the epic accumulation branch with a non-conflicting commit.
    const epicBranch = mgr.epicBranchName(epicId);
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');
    writeFileSync(join(epicInfo.path, 'epic-file.txt'), 'epic content\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit']);

    // Land with allowDirtyPaths to get the trailer.
    const res = await mgr.landEpicToMaster(epicId, { allowDirtyPaths: ['foo.ts', 'bar.ts'] });

    expect(res.landed).toBe(true);
    expect(res.conflict).toBe(false);

    // Read the land commit message from master.
    const logRes = await runGit(repo, ['log', 'master', '-1', '--format=%B']);
    expect(logRes.stdout).toContain('Allow-Dirty: foo.ts, bar.ts');
    expect(logRes.stdout).toContain('Collab-Epic:');
    expect(logRes.stdout).toContain('Collab-Land:');
  });

  it('test 2b-clean — no Allow-Dirty trailer when opts is omitted', async () => {
    const epicInfo = await mgr.ensureEpic(epicId + '-2');
    if (!epicInfo) throw new Error('ensureEpic returned null');
    writeFileSync(join(epicInfo.path, 'epic-file2.txt'), 'clean content\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'clean epic commit']);

    const res = await mgr.landEpicToMaster(epicId + '-2');

    expect(res.landed).toBe(true);
    const logRes = await runGit(repo, ['log', 'master', '-1', '--format=%B']);
    expect(logRes.stdout).not.toContain('Allow-Dirty:');
  });
});
