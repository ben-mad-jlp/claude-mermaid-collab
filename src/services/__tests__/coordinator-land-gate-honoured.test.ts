/**
 * Regression tests for the gate-honoured fix (blueprint coordinator-land leaf):
 *   1. stampLandLeafOnMerge with injected stampGate returning stamped:false/indeterminate
 *      → returns false, leaf stays not-done (gate-refused audit recorded).
 *   2. stampLandLeafOnMerge with injected stampGate returning stamped:true/gated-clean
 *      → returns true, leaf stamped done.
 *   3. convergeObservedMerge with injected stampGate returning stamped:false/indeterminate
 *      → returns { stamped:false, reason:'indeterminate' }, leaf stays not-done.
 *   4. convergeObservedMerge with injected stampGate returning stamped:true/gated-clean
 *      → returns { stamped:true, ... }, leaf stamped done.
 *
 * Cases 1 and 3 are RED at the pre-fix commit (both complete the leaf today); 2 and 4 are
 * green both sides and pin that the gate-honouring guard did not over-refuse.
 *
 * Mirrors the convergent-land-stamp.test.ts harness: isolate MERMAID_SUPERVISOR_DIR
 * before importing the store, use a temp dir as the project, _closeDb in lifecycle hooks.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-gate-honour-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { stampLandLeafOnMerge, convergeObservedMerge } from '../coordinator-land';
import { createTodo, getTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import type { GateReason } from '../epic-landed-stamp-gate';

const todoBase = mkdtempSync(join(tmpdir(), 'gate-honour-todos-'));
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

describe('stampLandLeafOnMerge + convergeObservedMerge — gate stamp honoured', () => {
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

  it('stampLandLeafOnMerge with gate.stamped:false/indeterminate → returns false, leaf stays not-done', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const result = await stampLandLeafOnMerge(
      project, epicId, landLeafId, true,
      {
        stampGate: async () => ({
          stamped: false,
          reason: 'indeterminate' as GateReason,
        }),
      },
    );

    expect(result).toBe(false);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).not.toBe('done');
  });

  it('stampLandLeafOnMerge with gate.stamped:true/gated-clean → returns true, leaf done', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const result = await stampLandLeafOnMerge(
      project, epicId, landLeafId, true,
      {
        stampGate: async () => ({
          stamped: true,
          reason: 'gated-clean' as GateReason,
        }),
      },
    );

    expect(result).toBe(true);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).toBe('done');
  });

  it('convergeObservedMerge with gate.stamped:false/indeterminate → { stamped:false, reason:indeterminate }, leaf stays not-done', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const result = await convergeObservedMerge(
      project, epicId, landLeafId, async () => 0,
      {
        stampGate: async () => ({
          stamped: false,
          reason: 'indeterminate' as GateReason,
        }),
      },
    );

    expect(result.stamped).toBe(false);
    expect(result.reason).toBe('indeterminate');

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).not.toBe('done');
  });

  it('convergeObservedMerge with gate.stamped:true/gated-clean → { stamped:true, ... }, leaf done', async () => {
    const leafBefore = getTodo(project, landLeafId);
    expect(leafBefore).toBeTruthy();
    expect(leafBefore!.status).not.toBe('done');

    const result = await convergeObservedMerge(
      project, epicId, landLeafId, async () => 0,
      {
        stampGate: async () => ({
          stamped: true,
          reason: 'gated-clean' as GateReason,
        }),
      },
    );

    expect(result.stamped).toBe(true);

    const leafAfter = getTodo(project, landLeafId);
    expect(leafAfter).toBeTruthy();
    expect(leafAfter!.status).toBe('done');
  });
});
