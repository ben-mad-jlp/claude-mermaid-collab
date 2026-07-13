import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateStewardProof } from '../steward-proof';
import { isLand } from '../todo-kind';
import type { StewardProof, ProofContext, DepView } from '../steward-proof';

const GREEN_RUNNERS = {
  tscClean: () => true,
  epicMergeClean: () => true,
  unlandedLeaves: () => [],
};

describe('surface-land-excludes-land-leaf', () => {
  it('POSITIVE: build-children-only child set (land leaf excluded) is green while the land leaf is pending', () => {
    const project = '/test/project';
    const epicId = 'epic-123';
    const buildChildId = 'build-456';
    const landChildId = 'land-789';

    // Create getDep stub that returns the child todos
    const depMap = new Map<string, DepView>();
    depMap.set(buildChildId, {
      id: buildChildId,
      status: 'done',
      acceptanceStatus: 'accepted',
    });
    depMap.set(landChildId, {
      id: landChildId,
      status: 'in_progress', // Not done
      acceptanceStatus: null,
    });

    const getDep = (id: string): DepView | null => {
      return depMap.get(id) ?? null;
    };

    // Mock todos for the child set to test the filter
    const buildChild = {
      id: buildChildId,
      kind: 'leaf' as const,
      status: 'done',
      acceptanceStatus: 'accepted',
    };

    const landChild = {
      id: landChildId,
      kind: 'land' as const,
      status: 'in_progress', // Not done
      acceptanceStatus: null,
    };

    // Test that the filter correctly excludes the land leaf
    const allTodos = [buildChild, landChild];
    const children = allTodos.filter((t) => t.status !== 'dropped' && !isLand(t));

    // Verify the filter excludes the land leaf
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe(buildChildId);

    // Build the epicChildIds from the filtered children
    const epicChildIds = children.map((c) => c.id);

    // Call validateStewardProof with build-children-only epicChildIds
    const proof: StewardProof = { kind: 'epic-landable', epicId, epicBranch: `epic/${epicId}` };
    const result = validateStewardProof('land_epic', proof, {
      project,
      dependsOn: [],
      getDep,
      epicChildIds,
      epicWorktreeCwd: project,
      masterCwd: project,
      runners: GREEN_RUNNERS,
    });

    expect(result.ok).toBe(true);
    expect(result.reason).not.toBe('epic-children-incomplete');
  });

  it('NEGATIVE control: a not-done BUILD child yields epic-children-incomplete', () => {
    const project = '/test/project';
    const epicId = 'epic-123';
    const buildChild1Id = 'build-456';
    const buildChild2Id = 'build-789';

    // Create getDep stub that returns the child todos
    const depMap = new Map<string, DepView>();
    depMap.set(buildChild1Id, {
      id: buildChild1Id,
      status: 'done',
      acceptanceStatus: 'accepted',
    });
    depMap.set(buildChild2Id, {
      id: buildChild2Id,
      status: 'in_progress', // Not done
      acceptanceStatus: null,
    });

    const getDep = (id: string): DepView | null => {
      return depMap.get(id) ?? null;
    };

    // Both are build children (neither is a land leaf)
    const epicChildIds = [buildChild1Id, buildChild2Id];

    const proof: StewardProof = { kind: 'epic-landable', epicId, epicBranch: `epic/${epicId}` };
    const result = validateStewardProof('land_epic', proof, {
      project,
      dependsOn: [],
      getDep,
      epicChildIds,
      epicWorktreeCwd: project,
      masterCwd: project,
      runners: GREEN_RUNNERS,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('epic-children-incomplete');
  });

  it('SOURCE GUARD: the surfaceEpicLand filter excludes land leaves', () => {
    // Read the coordinator-live.ts file to verify the fix is in place
    const coordinatorLiveDir = join(import.meta.dir, '..');
    const coordinatorLivePath = join(coordinatorLiveDir, 'coordinator-live.ts');
    const content = readFileSync(coordinatorLivePath, 'utf-8');

    // Find the surfaceEpicLand function body
    const surfaceEpicLandStart = content.indexOf('export async function surfaceEpicLand(');
    expect(surfaceEpicLandStart).toBeGreaterThan(-1);

    // Find the next export to determine the end of the function
    const nextExportIndex = content.indexOf('\nexport ', surfaceEpicLandStart + 1);
    const surfaceEpicLandEnd = nextExportIndex > -1 ? nextExportIndex : content.length;
    const functionBody = content.substring(surfaceEpicLandStart, surfaceEpicLandEnd);

    // Assert the body contains the fixed filter with !isLand(
    // Looking for the pattern: parentId === epicId ... !isLand(
    expect(functionBody).toMatch(/parentId === epicId[\s\S]{0,80}!isLand\(/);
  });
});
