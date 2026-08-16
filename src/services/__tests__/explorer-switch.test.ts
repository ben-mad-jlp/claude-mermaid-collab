/**
 * EXPLORER — the fourth per-project operator lever.
 *
 * It gates explore-leaf DISPATCH (claim) and the repair-verify explore filer. It does NOT
 * gate file_explore or promote-on-file: sending filed explores back to a bucket would
 * recreate the unschedulable-leaf wall that promote-on-file (mission 949dda42) was built
 * to remove, and would LOSE work. Pause the spend, never the memory.
 *
 * The two load-bearing claims pinned here:
 *  1. A held explore is VISIBLE — diagnoseClaimSuppression names `explorer-off` for it,
 *     rather than the leaf silently vanishing from the claimable set.
 *  2. The verify-filer gate is left of shouldRunRepairVerifyFilerPass, which stamps its
 *     own throttle clock (same discipline as the AutoFix gate).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTodo, listTodos, _closeProject } from '../todo-store';
import { _closeDb as supervisorCloseDb } from '../supervisor-store';
import { _closeDb as orchestratorConfigCloseDb } from '../orchestrator-config';
import {
  EXPLORER_LEVELS,
  EXPLORER_DEFAULT,
  getExplorerLevel,
  setExplorerLevel,
  isExplorerEnabled,
} from '../orchestrator-config';
import {
  EXPLORE_RUN_EPIC_TITLE,
  ensureExploreRunEpic,
  exploreRunEpicIds,
  filterExplorerHeld,
  EXPLORER_OFF_SUPPRESSION_REASON,
} from '../explore-run-epic';
import { diagnoseClaimSuppression, makeCoordinatorDeps } from '../coordinator-live';
import { fileExploreRequest } from '../../mcp/workgraph-tools';
import { runOrchestratorTick, type TickDeps } from '../orchestrator-live';
import {
  shouldRunRepairVerifyFilerPass,
  _resetRepairVerifyFilerThrottle,
} from '../repair-verify-filer';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'explorer-switch-'));
  mkdirSync(join(project, '.collab'), { recursive: true });
  process.env.MERMAID_SUPERVISOR_DIR = project;
  supervisorCloseDb();
  orchestratorConfigCloseDb();
});
afterEach(() => {
  _closeProject(project);
  supervisorCloseDb();
  orchestratorConfigCloseDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Seed the rolling 'Explore runs' epic plus one ready explore leaf under it and one ready
 *  NON-explore leaf under an ordinary epic. Returns both leaf ids. */
async function seedExploreAndOther(): Promise<{ exploreEpicId: string; exploreLeafId: string; otherLeafId: string }> {
  const exploreEpicId = await ensureExploreRunEpic(project);
  const exploreLeaf = await createTodo(project, {
    allowOrphan: true, ownerSession: 's1', kind: 'leaf', parentId: exploreEpicId,
    title: 'explore: where does X live?', type: 'explore', status: 'ready',
  });
  const otherEpic = await createTodo(project, {
    allowOrphan: true, ownerSession: 's1', kind: 'epic', title: '[EPIC] ordinary work', status: 'ready',
  });
  const otherLeaf = await createTodo(project, {
    allowOrphan: true, ownerSession: 's1', kind: 'leaf', parentId: otherEpic.id,
    title: 'ordinary build leaf', status: 'ready',
  });
  return { exploreEpicId, exploreLeafId: exploreLeaf.id, otherLeafId: otherLeaf.id };
}

describe('Explorer level store', () => {
  it('exposes exactly the two stops and DEFAULTS TO ON (explores auto-run today)', () => {
    expect(EXPLORER_LEVELS).toEqual(['off', 'on']);
    expect(EXPLORER_DEFAULT).toBe('on');
    // No stored row for this project — the read must fall through to 'on'.
    expect(getExplorerLevel(project)).toBe('on');
    expect(isExplorerEnabled(project)).toBe(true);
  });

  it('setting off then reading returns off; setting on returns on', () => {
    setExplorerLevel(project, 'off');
    expect(getExplorerLevel(project)).toBe('off');
    expect(isExplorerEnabled(project)).toBe(false);
    setExplorerLevel(project, 'on');
    expect(getExplorerLevel(project)).toBe('on');
    expect(isExplorerEnabled(project)).toBe(true);
  });
});

describe('Explorer OFF holds explore DISPATCH (and nothing else)', () => {
  it('an explore leaf under the Explore runs epic is NOT claimable, and is REPORTED as explorer-off', async () => {
    const { exploreLeafId, otherLeafId } = await seedExploreAndOther();
    setExplorerLevel(project, 'off');

    const report = await diagnoseClaimSuppression(project);

    expect(report.claimableIds).not.toContain(exploreLeafId);
    // VISIBILITY: the hold is named, not silent — a lever whose effect you cannot see on
    // the board is how wedges happen. Assert the reason string, not just the absence.
    const held = report.suppressed.find((s) => s.todoId === exploreLeafId);
    expect(held).toBeTruthy();
    expect(held!.reason).toContain('explorer-off');
    expect(held!.reason).toBe(EXPLORER_OFF_SUPPRESSION_REASON);
    // And the non-explore leaf is untouched (neither held nor mis-attributed).
    expect(report.claimableIds).toContain(otherLeafId);
    expect(report.suppressed.some((s) => s.todoId === otherLeafId)).toBe(false);
  });

  it('a NON-explore leaf still claims while the Explorer is off', async () => {
    const { otherLeafId } = await seedExploreAndOther();
    setExplorerLevel(project, 'off');
    const report = await diagnoseClaimSuppression(project);
    expect(report.claimableIds).toContain(otherLeafId);
  });

  it('Explorer ON: the explore leaf claims exactly as today', async () => {
    const { exploreLeafId, otherLeafId } = await seedExploreAndOther();
    setExplorerLevel(project, 'on');
    const report = await diagnoseClaimSuppression(project);
    expect(report.claimableIds).toContain(exploreLeafId);
    expect(report.claimableIds).toContain(otherLeafId);
    expect(report.suppressed.some((s) => s.reason.includes('explorer-off'))).toBe(false);
  });

  it('ANTI-REGRESSION (the bucket-planning wall): with the Explorer off, file_explore STILL files and STILL promotes into the Explore runs epic', async () => {
    setExplorerLevel(project, 'off');

    const { leaf } = await fileExploreRequest(project, 's1', {
      scope: 'src/services',
      target: 'the claim pipeline',
      oracle: 'name the function that drops a ready leaf from the claimable set',
    });

    const all = listTodos(project, { includeCompleted: true });
    const epicIds = exploreRunEpicIds(all);
    const stored = all.find((t) => t.id === leaf.id);

    // Filed (not lost), and PROMOTED — homed under the live 'Explore runs' epic rather
    // than dropped into an unschedulable bucket. Only DISPATCH is held.
    expect(stored).toBeTruthy();
    expect(stored!.parentId).toBeTruthy();
    expect(epicIds.has(stored!.parentId!)).toBe(true);
    const parent = all.find((t) => t.id === stored!.parentId);
    expect(parent!.title).toContain(EXPLORE_RUN_EPIC_TITLE);
    expect(stored!.status).not.toBe('dropped');

    // ...and it is visibly HELD rather than silently gone.
    const report = await diagnoseClaimSuppression(project);
    expect(report.claimableIds).not.toContain(leaf.id);
    expect(report.suppressed.find((s) => s.todoId === leaf.id)?.reason).toContain('explorer-off');

    // Flipping the switch back on DRAINS the queue — the same leaf becomes claimable.
    setExplorerLevel(project, 'on');
    const after = await diagnoseClaimSuppression(project);
    expect(after.claimableIds).toContain(leaf.id);
  });
});

describe('the REAL claim pipeline (makeCoordinatorDeps().claimGuard), not just the diagnostic', () => {
  it('Explorer OFF drops the explore leaf and keeps the ordinary leaf; ON keeps both', async () => {
    const { exploreLeafId, otherLeafId } = await seedExploreAndOther();
    const { claimGuard } = makeCoordinatorDeps();
    if (!claimGuard) throw new Error('claimGuard is not wired — the Explorer hold has no dispatch seam');
    const ready = listTodos(project, { includeCompleted: true })
      .filter((t) => t.id === exploreLeafId || t.id === otherLeafId);

    setExplorerLevel(project, 'off');
    const heldOff = (await claimGuard(project, ready)).map((t) => t.id);
    expect(heldOff).toContain(otherLeafId);
    expect(heldOff).not.toContain(exploreLeafId);

    setExplorerLevel(project, 'on');
    const heldOn = (await claimGuard(project, ready)).map((t) => t.id);
    expect(heldOn).toContain(otherLeafId);
    expect(heldOn).toContain(exploreLeafId);
  });
});

describe('filterExplorerHeld (pure)', () => {
  it('holds only leaves parented to a LIVE Explore runs epic', async () => {
    const { exploreLeafId, otherLeafId } = await seedExploreAndOther();
    const all = listTodos(project, { includeCompleted: true });
    const ready = all.filter((t) => t.id === exploreLeafId || t.id === otherLeafId);

    const heldOff = filterExplorerHeld(ready, all, false).map((t) => t.id);
    expect(heldOff).toEqual([otherLeafId]);

    // Enabled ⇒ the identical array back (and no snapshot scan paid).
    expect(filterExplorerHeld(ready, all, true)).toBe(ready);
  });
});

describe('Explorer gates the repair-verify explore filer', () => {
  function baseDeps(p: string): TickDeps {
    return {
      listProjects: async () => [{ path: p }],
      watchedProjects: () => new Set([p]),
      getLevel: () => 'off',
      listConfigured: () => [],
      setLevel: () => {},
      dirExists: () => true,
      shouldRunNotify: () => false,
      shouldRunMissionLoop: () => false,
      shouldRunFrictionWatch: () => false,
      shouldRunFrictionTriage: () => false,
      shouldRunBurnWatch: () => false,
      shouldRunMissionIntake: () => false,
      isAutoFixEnabled: () => false, // the forge is out of scope for this test
    };
  }

  it('Explorer OFF: the filer files nothing AND its throttle clock is NOT advanced', async () => {
    _resetRepairVerifyFilerThrottle(project);
    const calls: string[] = [];

    await runOrchestratorTick({
      ...baseDeps(project),
      isExplorerEnabled: () => false,
      // Delegates to the REAL (side-effecting) gate: a wrong && order would stamp the clock.
      shouldRunRepairVerifyFiler: (p: string) => { calls.push('gate'); return shouldRunRepairVerifyFilerPass(p); },
      repairVerifyFiler: async () => { calls.push('filer'); return { filed: ['explore-1'] }; },
      recycle: async () => ({}),
    });

    // ORDERING CLAIM: the clock is untouched, so the next due check still says "run".
    expect(shouldRunRepairVerifyFilerPass(project)).toBe(true);
    expect(calls).toEqual([]); // nothing filed, gate never reached
    _resetRepairVerifyFilerThrottle(project);
  });

  it('Explorer ON: the filer runs exactly as today', async () => {
    _resetRepairVerifyFilerThrottle(project);
    const calls: string[] = [];

    await runOrchestratorTick({
      ...baseDeps(project),
      isExplorerEnabled: () => true,
      shouldRunRepairVerifyFiler: (p: string) => { calls.push('gate'); return shouldRunRepairVerifyFilerPass(p); },
      repairVerifyFiler: async () => { calls.push('filer'); return { filed: [] }; },
      recycle: async () => ({}),
    });

    expect(calls).toEqual(['gate', 'filer']);
    _resetRepairVerifyFilerThrottle(project);
  });

  it('with NO stored row the real gate defaults to enabled — the filer still runs', async () => {
    _resetRepairVerifyFilerThrottle(project);
    const calls: string[] = [];

    await runOrchestratorTick({
      ...baseDeps(project),
      shouldRunRepairVerifyFiler: () => true,
      repairVerifyFiler: async () => { calls.push('filer'); return { filed: [] }; },
      recycle: async () => ({}),
    });

    expect(calls).toEqual(['filer']);
    _resetRepairVerifyFilerThrottle(project);
  });
});
