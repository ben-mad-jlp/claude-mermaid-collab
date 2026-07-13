import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateStewardProof } from '../steward-proof';
import { isLand } from '../todo-kind';
import type { StewardProof, DepView } from '../steward-proof';

const GREEN_RUNNERS = {
  tscClean: () => true,
  epicMergeClean: () => true,
  unlandedLeaves: () => [],
};

// Completes the P0 fix (surface-land-excludes-land-leaf): surfaceEpicLand's PRE-CHECK
// excluded the [LAND] leaf, but the landEpic EXECUTOR re-derived its own child set
// WITHOUT that filter, so validateStewardProof('land_epic') still counted the pending
// land leaf → epic-children-incomplete → every auto-land rejected forever. The land leaf
// is stamped done AFTER the merge (stampLandLeafOnMerge), so it must never gate the land.
describe('land-executor-excludes-land-leaf', () => {
  it('POSITIVE: executor child set (land leaf excluded) is green while the land leaf is pending', () => {
    const project = '/test/project';
    const epicId = 'epic-123';
    const buildChildId = 'build-456';
    const landChildId = 'land-789';

    const depMap = new Map<string, DepView>();
    depMap.set(buildChildId, { id: buildChildId, status: 'done', acceptanceStatus: 'accepted' });
    depMap.set(landChildId, { id: landChildId, status: 'todo', acceptanceStatus: null }); // land leaf NOT done
    const getDep = (id: string): DepView | null => depMap.get(id) ?? null;

    // Reconstruct the executor's filter (coordinator-live.ts:1819-1822).
    const allTodos = [
      { id: buildChildId, kind: 'leaf' as const, status: 'done' },
      { id: landChildId, kind: 'land' as const, status: 'todo' },
    ];
    const epicChildIds = allTodos
      .filter((t) => t.status !== 'dropped' && !isLand(t))
      .map((t) => t.id);
    expect(epicChildIds).toEqual([buildChildId]); // land leaf excluded

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

  it('NEGATIVE control: a not-done BUILD child still yields epic-children-incomplete', () => {
    const project = '/test/project';
    const epicId = 'epic-123';
    const buildDoneId = 'build-456';
    const buildPendingId = 'build-789';

    const depMap = new Map<string, DepView>();
    depMap.set(buildDoneId, { id: buildDoneId, status: 'done', acceptanceStatus: 'accepted' });
    depMap.set(buildPendingId, { id: buildPendingId, status: 'in_progress', acceptanceStatus: null });
    const getDep = (id: string): DepView | null => depMap.get(id) ?? null;

    // Two BUILD children (neither is a land leaf); the filter keeps both.
    const allTodos = [
      { id: buildDoneId, kind: 'leaf' as const, status: 'done' },
      { id: buildPendingId, kind: 'leaf' as const, status: 'in_progress' },
    ];
    const epicChildIds = allTodos
      .filter((t) => t.status !== 'dropped' && !isLand(t))
      .map((t) => t.id);
    expect(epicChildIds).toEqual([buildDoneId, buildPendingId]);

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

  it('SOURCE GUARD: the landEpic executor child filter excludes land leaves', () => {
    const coordinatorLivePath = join(import.meta.dir, '..', 'coordinator-live.ts');
    const content = readFileSync(coordinatorLivePath, 'utf-8');

    const start = content.indexOf('export async function landEpic(');
    expect(start).toBeGreaterThan(-1);
    const nextExport = content.indexOf('\nexport ', start + 1);
    const body = content.substring(start, nextExport > -1 ? nextExport : content.length);

    // The executor's child set must carry the same !isLand( exclusion as the pre-check.
    expect(body).toMatch(/parentId === epicId[\s\S]{0,80}!isLand\(/);
  });
});
