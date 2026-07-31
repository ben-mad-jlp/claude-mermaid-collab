/**
 * declaredFiles persistence.
 *
 * A leaf's declared `files` set is persisted as a durable `declaredFiles` column
 * (distinct from the split-child `inheritedFiles` slice) so dispatch-layer
 * same-file contention detection can read it back later. This pins:
 *  - the round-trip through addLeavesToEpic → a FRESH openDb,
 *  - that agent-profile type inference is unchanged by the new column,
 *  - that a leaf with no `files` reads back `[]`, never null/undefined.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-declared-files-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { createEpicWithLandLeaf, addLeavesToEpic } from '../../mcp/workgraph-tools';
import { inferProfileType } from '../../config/agent-profiles';
import { inferTypeFromManifest } from '../../config/project-manifest';

const todoBase = mkdtempSync(join(tmpdir(), 'declared-files-todos-'));
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

describe('declaredFiles persistence', () => {
  it('persists declaredFiles through addLeavesToEpic and a fresh openDb', async () => {
    const project = freshProject();
    const { epic } = await createEpicWithLandLeaf(project, 'test-session', {
      title: 'Declared files epic',
      home: null, homeProvided: true,
    });
    const { createdIds } = await addLeavesToEpic(project, 'test-session', epic.id, [
      { title: 'touch conductor-pass', files: ['src/services/conductor-pass.ts'] },
    ]);
    expect(createdIds.length).toBe(1);

    // Drop the cached handle so the read below comes from a FRESH openDb.
    _closeProject(project);

    const leaf = getTodo(project, createdIds[0])!;
    expect(leaf.declaredFiles).toEqual(['src/services/conductor-pass.ts']);
  });

  it('leaves agent-profile type inference unchanged for the same files array', async () => {
    const project = freshProject();
    const files = ['src/services/conductor-pass.ts'];
    const { epic } = await createEpicWithLandLeaf(project, 'test-session', {
      title: 'Inference epic',
      home: null, homeProvided: true,
    });
    const { createdIds } = await addLeavesToEpic(project, 'test-session', epic.id, [
      { title: 'infer from files', files },
    ]);
    const leaf = getTodo(project, createdIds[0])!;

    // Assert against what the inference functions themselves produce today —
    // never a hardcoded guess.
    const expectedType = inferTypeFromManifest(project, files) ?? inferProfileType(files);
    expect(leaf.type).toBe(expectedType);
  });

  it('a leaf created with no files reads back declaredFiles: []', async () => {
    const project = freshProject();
    const { epic } = await createEpicWithLandLeaf(project, 'test-session', {
      title: 'No files epic',
      home: null, homeProvided: true,
    });
    const { createdIds } = await addLeavesToEpic(project, 'test-session', epic.id, [
      { title: 'no files declared' },
    ]);
    _closeProject(project);

    const leaf = getTodo(project, createdIds[0])!;
    expect(leaf.declaredFiles).toEqual([]);
  });
});
