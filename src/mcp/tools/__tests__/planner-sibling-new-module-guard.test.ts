import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'planner-sibling-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { planMissionCriterion } from '../mission-planner';
import { SiblingNewModuleCollisionError } from '../../../services/sibling-new-module-guard';
import { forgeMission } from '../mission-forge';
import { listCriteria, _resetMissionDbCache } from '../../../services/mission-store';
import { listTodos, _closeProject as closeTodos } from '../../../services/todo-store';
import { _closeProject as closeDecisions } from '../../../services/decision-record-store';
import { collectSiblingDeclaredNewFiles, assertNoSiblingNewModuleCollision } from '../../../services/sibling-new-module-guard';
import type { SiblingNewModuleDeps } from '../../../services/sibling-new-module-guard';
import type { Todo } from '../../../services/todo-store';
import type { DiffContract } from '../../../services/diff-contract';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'planner-sibling-')); _resetMissionDbCache(project); });
afterEach(() => { _resetMissionDbCache(project); closeTodos(project); closeDecisions(project); rmSync(project, { recursive: true, force: true }); });

async function approvedMission() {
  const forged = await forgeMission(project, { session: 's1', title: 'Test sibling collisions', criteria: ['first criterion', 'second criterion'] });
  const crits = listCriteria(project, forged.missionId);
  return { missionId: forged.missionId, criterionId: crits[0].id, secondId: crits[1].id };
}

const mockInvoke = (spec: unknown) => async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(spec) + '\n```' } as any);

describe('planner refuses a second sibling epic declaring the same not-on-trunk new file', () => {
  test('a second sibling epic declaring the same not-on-trunk new file is refused at plan time', async () => {
    const { missionId, criterionId, secondId } = await approvedMission();

    // Plan first epic with a new file
    const firstSpec = {
      title: 'First epic',
      description: 'Declares collide-me.ts',
      leaves: [
        { title: 'Create collide-me.ts', description: 'New file', files: ['src/services/collide-me.ts'] },
      ],
    };
    const r1 = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke(firstSpec) });

    // Plan second epic with the same new file
    const secondSpec = {
      title: 'Second epic',
      description: 'Also declares collide-me.ts',
      leaves: [
        { title: 'Also create collide-me.ts', description: 'Same new file', files: ['src/services/collide-me.ts'] },
      ],
    };

    const siblingNewModuleDeps: SiblingNewModuleDeps = {
      restoreBlueprint: (leafId) => {
        // For the first epic's leaf, return a blueprint with filesToCreate
        if (leafId === r1.leafIds[0]) {
          return `Some blueprint\n\`\`\`json\n{"schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 1, "nonEnumerableFanout": false, "filesToCreate": ["src/services/collide-me.ts"], "filesToEdit": [], "tasks": [], "leafKind": "feature", "requirements": [], "outOfScope": []}\n\`\`\``;
        }
        return null;
      },
      existsOnTrunk: () => false,
    };

    let caught: unknown;
    try {
      await planMissionCriterion(
        project,
        { session: 's1', missionId, criterionIds: [secondId] },
        { invoke: mockInvoke(secondSpec), siblingNewModuleDeps },
      );
      throw new Error('expected refusal');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(SiblingNewModuleCollisionError);
    const err = caught as SiblingNewModuleCollisionError;
    expect(err.message).toContain('src/services/collide-me.ts');
    expect(err.message).toContain(r1.epicId.slice(0, 8));
  });

  test('a sibling-declared path that already exists on trunk plans through', async () => {
    const { missionId, criterionId, secondId } = await approvedMission();

    // Plan first epic with a new file
    const firstSpec = {
      title: 'First epic',
      description: 'Declares existing.ts',
      leaves: [
        { title: 'Edit existing.ts', description: 'Existing file', files: ['src/services/existing.ts'] },
      ],
    };
    const r1 = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke(firstSpec) });

    // Create the file on trunk so it's not "new"
    mkdirSync(join(project, 'src', 'services'), { recursive: true });
    writeFileSync(join(project, 'src/services/existing.ts'), '// existing');

    // Plan second epic with the same path (but not new since it exists on trunk)
    const secondSpec = {
      title: 'Second epic',
      description: 'Also edits existing.ts',
      leaves: [
        { title: 'Also edit existing.ts', description: 'Same existing file', files: ['src/services/existing.ts'] },
      ],
    };

    const siblingNewModuleDeps: SiblingNewModuleDeps = {
      restoreBlueprint: (leafId) => {
        if (leafId === r1.leafIds[0]) {
          return `Some blueprint\n\`\`\`json\n{"schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 1, "nonEnumerableFanout": false, "filesToCreate": ["src/services/existing.ts"], "filesToEdit": [], "tasks": [], "leafKind": "feature", "requirements": [], "outOfScope": []}\n\`\`\``;
        }
        return null;
      },
      existsOnTrunk: (proj, path) => path === 'src/services/existing.ts',
    };

    const r2 = await planMissionCriterion(
      project,
      { session: 's1', missionId, criterionIds: [secondId] },
      { invoke: mockInvoke(secondSpec), siblingNewModuleDeps },
    );
    expect(r2.epicId).toBeTruthy();
  });

  test('no live sibling plans through', async () => {
    const { missionId, criterionId } = await approvedMission();

    const spec = {
      title: 'Standalone epic',
      description: 'No siblings',
      leaves: [
        { title: 'Create new-file.ts', description: 'New file', files: ['src/services/new-file.ts'] },
      ],
    };

    const siblingNewModuleDeps: SiblingNewModuleDeps = {
      listTodos: () => [], // No epics exist
      existsOnTrunk: () => false,
    };

    const r = await planMissionCriterion(
      project,
      { session: 's1', missionId, criterionIds: [criterionId] },
      { invoke: mockInvoke(spec), siblingNewModuleDeps },
    );
    expect(r.epicId).toBeTruthy();
  });

  test('the collector sources the declared path from the stored manifest', async () => {
    const { missionId, criterionId } = await approvedMission();

    // Plan an epic with a new file
    const firstSpec = {
      title: 'First epic',
      description: 'Declares a new file',
      leaves: [
        { title: 'Create file.ts', description: 'New', files: ['src/services/file.ts'] },
      ],
    };
    const r1 = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke(firstSpec) });

    // Directly test collectSiblingDeclaredNewFiles
    const siblingNewModuleDeps: SiblingNewModuleDeps = {
      listTodos: (proj, opts) => {
        // Return the first epic as a live epic
        const allTodos = listTodos(proj, opts);
        return allTodos;
      },
      restoreBlueprint: (leafId) => {
        if (leafId === r1.leafIds[0]) {
          return `Blueprint\n\`\`\`json\n{"schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 1, "nonEnumerableFanout": false, "filesToCreate": ["src/services/file.ts"], "filesToEdit": [], "tasks": [], "leafKind": "feature", "requirements": [], "outOfScope": []}\n\`\`\``;
        }
        return null;
      },
      existsOnTrunk: () => false,
    };

    const siblings = collectSiblingDeclaredNewFiles(project, {}, siblingNewModuleDeps);
    expect(siblings.length).toBeGreaterThan(0);
    const match = siblings.find((s) => s.path === 'src/services/file.ts');
    expect(match).toBeTruthy();
    expect(match?.epicId).toBe(r1.epicId);
  });

  test('the live default deps resolve without injection', async () => {
    // Test with an empty project and no injected deps
    const siblings = collectSiblingDeclaredNewFiles(project, {});
    expect(Array.isArray(siblings)).toBe(true);
    expect(siblings.length).toBe(0);
  });
});

describe('assertNoSiblingNewModuleCollision', () => {
  test('throws on collision', () => {
    const siblingNewFiles = [
      { epicId: 'abc123def456', path: 'src/services/collide.ts' },
    ];

    const spec = {
      leaves: [
        { files: ['src/services/collide.ts'] },
      ],
    };

    expect(() => assertNoSiblingNewModuleCollision(spec, siblingNewFiles)).toThrow(SiblingNewModuleCollisionError);
  });

  test('does not throw on no collision', () => {
    const siblingNewFiles = [
      { epicId: 'abc123def456', path: 'src/services/other.ts' },
    ];

    const spec = {
      leaves: [
        { files: ['src/services/new.ts'] },
      ],
    };

    expect(() => assertNoSiblingNewModuleCollision(spec, siblingNewFiles)).not.toThrow();
  });

  test('ignores leaves with no files', () => {
    const siblingNewFiles = [
      { epicId: 'abc123def456', path: 'src/services/collide.ts' },
    ];

    const spec = {
      leaves: [
        {},
      ],
    };

    expect(() => assertNoSiblingNewModuleCollision(spec, siblingNewFiles)).not.toThrow();
  });
});
