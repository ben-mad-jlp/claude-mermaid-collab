/**
 * Tests for the stamp-after-merge invariant (blueprint F1 leaf A):
 *   1. stampLandLeafOnMerge(landed:true) stamps the leaf done immediately.
 *   2. stampLandLeafOnMerge(landed:false) or (undefined, true) skips the stamp (retried next tick).
 *   3. createEscalation dedup returns a truthy escalation.id equal to the first call's id.
 *
 * Mirrors the land-dirty-tree.test.ts / reconcile-pass.test.ts harness: isolate
 * MERMAID_SUPERVISOR_DIR before importing the store, use a temp dir as the project,
 * _closeDb in lifecycle hooks.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-auto-land-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { stampLandLeafOnMerge } from '../coordinator-live';
import { createTodo, getTodo, _closeProject } from '../todo-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';

const todoBase = mkdtempSync(join(tmpdir(), 'auto-land-todos-'));
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

describe('stampLandLeafOnMerge — post-merge stamp', () => {
  let project: string;
  let landLeafId: string;

  let epicId: string;

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

  it('observed merge (landed:true) stamps the leaf done', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const stamped = await stampLandLeafOnMerge(project, landLeafId, true);
    expect(stamped).toBe(true);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).toBe('done');

    const epicAfter = getTodo(project, epicId);
    expect(epicAfter!.landedAt).not.toBeNull();
  });

  it('refused merge (landed:false) does NOT stamp', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const stamped = await stampLandLeafOnMerge(project, landLeafId, false);
    expect(stamped).toBe(false);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).not.toBe('done');
  });

  it('missing landLeafId with observed merge does NOT stamp', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const stamped = await stampLandLeafOnMerge(project, undefined, true);
    expect(stamped).toBe(false);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).not.toBe('done');
  });
});

describe('createEscalation — dedup returns existing open card id', () => {
  let project: string;

  beforeEach(() => {
    project = freshProject();
  });

  afterEach(() => {
    _closeProject(project);
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('dedup returns a truthy id equal to the first card', () => {
    const { escalation: first, isNew: firstIsNew } = createEscalation({
      project,
      session: 'worker-1',
      kind: 'epic-ready-to-land',
      questionText: 'Land the epic?',
    });

    expect(firstIsNew).toBe(true);
    expect(first.id).toBeTruthy();
    const firstId = first.id;

    const { escalation: second, isNew: secondIsNew } = createEscalation({
      project,
      session: 'worker-1',
      kind: 'epic-ready-to-land',
      questionText: 'Land the epic?',
    });

    expect(secondIsNew).toBe(false);
    expect(second.id).toBeTruthy();
    expect(second.id).toBe(firstId);
  });
});
