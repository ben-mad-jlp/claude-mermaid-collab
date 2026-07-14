// Runs via `bun test` (uses bun:sqlite) — excluded from vitest.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createTodo, getTodo, splitLeafInto, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'split-title-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});
afterEach(() => {
  _closeProject(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('splitLeafInto child titles (bug 36803c61)', () => {
  test('children lead with the distinguishing basename, are distinct, and carry an ordinal', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', kind: 'epic', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'shared parent title',
      status: 'ready', parentId: epic.id, description: 'spec',
    });
    const { childIds } = await splitLeafInto(project, getTodo(project, leaf.id)!, [
      'src/a/alpha.ts',
      'src/b/beta.ts',
    ]);
    const titles = childIds.map((id) => getTodo(project, id)!.title!);

    // distinct
    expect(new Set(titles).size).toBe(titles.length);
    // each LEADS with its own basename (not the shared parent prefix)
    expect(titles.some((t) => t.startsWith('alpha.ts'))).toBe(true);
    expect(titles.some((t) => t.startsWith('beta.ts'))).toBe(true);
    // none leads with the shared parent title
    expect(titles.every((t) => !t.startsWith('shared parent title'))).toBe(true);
    // ordinal present
    expect(titles.every((t) => /\(part \d+\/2\)$/.test(t))).toBe(true);
  });
});
