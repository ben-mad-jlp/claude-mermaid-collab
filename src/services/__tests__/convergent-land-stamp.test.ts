/**
 * Tests for the convergent land-leaf stamp (blueprint F1 leaf B):
 *   1. convergeObservedMerge probes ahead==0 + pending land leaf → stamps done with reason 'observed-merged'.
 *   2. convergeObservedMerge probes ahead>0 → returns stamped:false / reason 'epic-ahead', leaf stays not-done.
 *   3. convergeObservedMerge re-run on already-done leaf → no-op, returns stamped:false / reason 'land-leaf-already-done'.
 *   4. convergeObservedMerge probes with error (ahead<0) → returns stamped:false / reason 'ahead-unknown', leaf stays pending.
 *
 * Mirrors the auto-land-stamp-after-merge.test.ts harness: isolate MERMAID_SUPERVISOR_DIR
 * before importing the store, use a temp dir as the project, _closeDb in lifecycle hooks.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-converge-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { convergeObservedMerge } from '../coordinator-live';
import { createTodo, getTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

const todoBase = mkdtempSync(join(tmpdir(), 'converge-todos-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('convergeObservedMerge — convergent crash-window stamp', () => {
  let project: string;
  let epicId: string;
  let landLeafId: string;

  beforeEach(async () => {
    project = freshProject();
    const epic = await createTodo(project, {
      allowOrphan: true,
      title: '[EPIC] test',
      ownerSession: 'test',
      kind: 'epic',
    });
    const landLeaf = await createTodo(project, {
      allowOrphan: true,
      title: '[LAND] → master',
      ownerSession: 'test',
      parentId: epic.id,
      kind: 'land',
    });
    epicId = epic.id;
    landLeafId = landLeaf.id;
  });

  afterEach(() => {
    _closeProject(project);
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('merged (ahead==0) + pending land leaf → stamps done with reason observed-merged', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const result = await convergeObservedMerge(
      project, epicId, landLeafId, async () => 0,
    );

    expect(result.stamped).toBe(true);
    expect(result.reason).toBe('observed-merged');
    expect(result.ahead).toBe(0);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).toBe('done');

    const epicAfter = getTodo(project, epicId);
    expect(epicAfter!.landedAt).not.toBeNull();
  });

  it('ahead>0 (unlanded) → NOT stamped, reason epic-ahead, leaf stays not-done', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const result = await convergeObservedMerge(
      project, epicId, landLeafId, async () => 3,
    );

    expect(result.stamped).toBe(false);
    expect(result.reason).toBe('epic-ahead');
    expect(result.ahead).toBe(3);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).not.toBe('done');
  });

  it('probe error (ahead<0) → NOT stamped, reason ahead-unknown, leaf stays pending', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const result = await convergeObservedMerge(
      project, epicId, landLeafId, async () => { throw new Error('probe failed'); },
    );

    expect(result.stamped).toBe(false);
    expect(result.reason).toBe('ahead-unknown');
    expect(result.ahead).toBe(-1);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).not.toBe('done');
  });

  it('re-run on already-done leaf → no-op, reason land-leaf-already-done, does not throw', async () => {
    // First stamp it done
    const firstStamp = await convergeObservedMerge(
      project, epicId, landLeafId, async () => 0,
    );
    expect(firstStamp.stamped).toBe(true);

    const leafAfterFirst = getTodo(project, landLeafId);
    expect(leafAfterFirst!.status).toBe('done');

    // Second call should be a no-op
    const secondStamp = await convergeObservedMerge(
      project, epicId, landLeafId, async () => 0,
    );

    expect(secondStamp.stamped).toBe(false);
    expect(secondStamp.reason).toBe('land-leaf-already-done');

    const leafAfterSecond = getTodo(project, landLeafId);
    expect(leafAfterSecond!.status).toBe('done');
  });

  it('missing landLeafId → NOT stamped, reason no-land-leaf', async () => {
    const result = await convergeObservedMerge(
      project, epicId, undefined, async () => 0,
    );

    expect(result.stamped).toBe(false);
    expect(result.reason).toBe('no-land-leaf');

    const leaf = getTodo(project, landLeafId);
    expect(leaf!.status).not.toBe('done');
  });
});
