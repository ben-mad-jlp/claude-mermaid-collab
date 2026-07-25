import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-corrupt-sup-'));

import { sweepCorruptEpics, _resetCorruptEpicSweepState } from '../coordinator-live';
import { buildEpicBranchStatus, type BranchProbe, type GitProbe } from '../epic-branch-status';
import { createTodo, completeTodo, getTodo, listTodos, stampEpicLandedAt, _closeProject, updateTodo } from '../todo-store';
import { upsertMission, addCriterion, listCriteria, listPendingRechecks, _resetMissionDbCache, setCriterionVerdict, setMissionClosed, getMission, listCriterionVerdictHistory } from '../mission-store';
import { drainMissionRechecks } from '../mission-recheck-drain';

const probeWith = (facts: Record<string, BranchProbe>): GitProbe =>
  async (branch) => facts[branch] ?? { exists: false, ahead: null, behind: null, mergeable: null, newCount: null };

describe('sweepCorruptEpics', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'mc-corrupt-'));
  });

  afterEach(async () => {
    _resetCorruptEpicSweepState();
    _resetMissionDbCache(repo);
    _closeProject(repo);
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('corrupt (land done + ahead>0): report flags corrupt AND sweep reopens the land leaf', async () => {
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', kind: 'epic', status: 'planned' });
    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted'); // FALSELY stamp the land leaf done

    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 } }),
    );
    const e = report.epics.find((x) => x.epicId === epic.id)!;
    expect(e.stranded).toBe(true);
    expect(e.corrupt).toBe(true);
    expect(report.corruptCount).toBe(1);

    const reopened = await sweepCorruptEpics(repo, { report });
    expect(reopened).toContain(land.id);
    expect(getTodo(repo, land.id)!.status).not.toBe('done'); // stamp reverted → ready
  });

  it('clean (land done + ahead==0): NOT corrupt, land leaf NOT reopened', async () => {
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] clean', kind: 'epic', status: 'planned' });
    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] clean → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 } }),
    );
    const e = report.epics.find((x) => x.epicId === epic.id)!;
    expect(e.stranded).toBe(false);
    expect(e.corrupt).toBe(false);

    const reopened = await sweepCorruptEpics(repo, { report });
    expect(reopened).not.toContain(land.id);
    expect(getTodo(repo, land.id)!.status).toBe('done'); // untouched
  });

  it('corrupt epic: landedAt/hollowLandedAt cleared, land leaf ready, served criterion met=false with a pending recheck row', async () => {
    // Seed a mission with a criterion
    const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] m', kind: 'mission' });
    upsertMission(repo, mission.id);
    const crit = addCriterion(repo, mission.id, 'test criterion');

    // Create an epic under the mission
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', parentId: mission.id, kind: 'epic', status: 'planned' });

    // Create a leaf that serves the criterion
    const impl = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[IMPL] impl',
      parentId: epic.id,
      kind: 'leaf',
    });
    // Update it to serve the criterion and complete it
    await updateTodo(repo, impl.id, { servesCriterionIds: [crit.id] });
    await completeTodo(repo, impl.id, 'accepted');

    // Create and complete a [LAND] leaf
    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    // Stamp the epic as landed
    const iso = new Date(0).toISOString();
    stampEpicLandedAt(repo, epic.id, iso);

    // Build report: land done + ahead > 0 = corrupt
    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 } }),
    );

    // Verify land leaf is done before the sweep
    const landBefore = getTodo(repo, land.id)!;
    expect(landBefore.status).toBe('done');

    // Sweep
    const reopened = await sweepCorruptEpics(repo, { report });

    // Verify: landedAt cleared
    const epicAfter = getTodo(repo, epic.id)!;
    expect(epicAfter.landedAt).toBeNull();

    // Verify: land leaf reopened (no longer done)
    expect(reopened).toContain(land.id);
    expect(getTodo(repo, land.id)!.status).not.toBe('done');

    // Verify: criterion met = false with pending recheck
    const criteria = listCriteria(repo, mission.id);
    const criterion = criteria.find((c) => c.id === crit.id)!;
    expect(criterion.met).toBe(false);

    const rechecks = listPendingRechecks(repo);
    expect(rechecks.length).toBe(1);
    expect(rechecks[0].criterionId).toBe(crit.id);
    expect(rechecks[0].reason).toBe('corrupt-land');
    // Verify: todoId is the mission id, NOT the epic id (regression test for the keying bug)
    expect(rechecks[0].todoId).toBe(mission.id);
    expect(rechecks[0].todoId).not.toBe(epic.id);
  });

  it('second sweep is a no-op (no duplicate recheck, no re-clear)', async () => {
    // Seed: mission + criterion + epic + accepted leaf serving it + stamped land leaf
    const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] m', kind: 'mission' });
    upsertMission(repo, mission.id);
    const crit = addCriterion(repo, mission.id, 'test criterion');

    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', parentId: mission.id, kind: 'epic', status: 'planned' });

    const impl = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[IMPL] impl',
      parentId: epic.id,
      kind: 'leaf',
    });
    // Update it to serve the criterion and complete it
    await updateTodo(repo, impl.id, { servesCriterionIds: [crit.id] });
    await completeTodo(repo, impl.id, 'accepted');

    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    const iso = new Date(0).toISOString();
    stampEpicLandedAt(repo, epic.id, iso);

    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 } }),
    );

    // First sweep
    await sweepCorruptEpics(repo, { report });

    const firstRechecks = listPendingRechecks(repo);
    expect(firstRechecks.length).toBe(1);
    const firstEnqueuedAt = firstRechecks[0].enqueuedAt;

    // Second sweep (with force: true to bypass throttle)
    const reopened2 = await sweepCorruptEpics(repo, { report, force: true });

    // Verify: no duplicate recheck
    const secondRechecks = listPendingRechecks(repo);
    expect(secondRechecks.length).toBe(1);
    expect(secondRechecks[0].enqueuedAt).toBe(firstEnqueuedAt); // unchanged

    // Verify: epic's landedAt still null (not re-cleared)
    expect(getTodo(repo, epic.id)!.landedAt).toBeNull();

    // Verify: land leaf still not done (not re-reopened)
    expect(getTodo(repo, land.id)!.status).not.toBe('done');
  });

  it('a newCount===0 epic with a done land leaf is left untouched (landedAt preserved)', async () => {
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] clean', kind: 'epic', status: 'planned' });
    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] clean → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    const iso = new Date(0).toISOString();
    stampEpicLandedAt(repo, epic.id, iso);

    // Report: land done + ahead == 0 = NOT corrupt
    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 } }),
    );

    // Sweep
    await sweepCorruptEpics(repo, { report });

    // Verify: landedAt untouched
    const epicAfter = getTodo(repo, epic.id)!;
    expect(epicAfter.landedAt).toBe(iso);

    // Verify: land leaf still done
    expect(getTodo(repo, land.id)!.status).toBe('done');
  });

  it('terminal mission (converged): criterion stays met with non-null verifiedAt, NOT reopened', async () => {
    // Seed: mission + single criterion
    const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] converged', kind: 'mission' });
    upsertMission(repo, mission.id);
    const crit = addCriterion(repo, mission.id, 'test criterion');

    // Mark criterion met with real provenance
    setCriterionVerdict(repo, crit.id, {
      met: true,
      evidence: 'e1',
      verifiedBy: 'verify-gate',
      evidencePaths: ['src/x.ts'],
    });

    // Clear active flag manually to leave criterion met but mission not terminal
    setMissionClosed(repo, mission.id, null);

    // Create epic + impl serving criterion + land leaf
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', parentId: mission.id, kind: 'epic', status: 'planned' });

    const impl = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[IMPL] impl',
      parentId: epic.id,
      kind: 'leaf',
    });
    await updateTodo(repo, impl.id, { servesCriterionIds: [crit.id] });
    await completeTodo(repo, impl.id, 'accepted');

    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    // Stamp the epic as landed
    const iso = new Date(0).toISOString();
    stampEpicLandedAt(repo, epic.id, iso);

    // Build report: corrupt
    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 } }),
    );

    // Sweep
    await sweepCorruptEpics(repo, { report });

    // Verify: criterion still met with verifiedAt preserved
    const criteria = listCriteria(repo, mission.id);
    const criterion = criteria.find((c) => c.id === crit.id)!;
    expect(criterion.met).toBe(true);
    expect(criterion.verifiedAt).not.toBeNull();

    // Verify: no recheck queued for this criterion
    const rechecks = listPendingRechecks(repo);
    expect(rechecks).toHaveLength(0);
  });

  it('terminal mission (closed): criterion stays met, NOT reopened', async () => {
    // Seed: mission + criterion marked met + mission explicitly closed
    const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] closed', kind: 'mission' });
    upsertMission(repo, mission.id);
    const crit = addCriterion(repo, mission.id, 'test criterion');

    // Mark criterion met with provenance and let deactivateIfTerminal run
    setCriterionVerdict(repo, crit.id, {
      met: true,
      evidence: 'e1',
      verifiedBy: 'verify-gate',
      evidencePaths: ['src/x.ts'],
    });

    // Verify mission is closed (via the auto-stamp from the single met criterion)
    const m = getMission(repo, mission.id)!;
    expect(m.status).toBe('closed');

    // Create epic + impl serving criterion + land leaf
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', parentId: mission.id, kind: 'epic', status: 'planned' });

    const impl = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[IMPL] impl',
      parentId: epic.id,
      kind: 'leaf',
    });
    await updateTodo(repo, impl.id, { servesCriterionIds: [crit.id] });
    await completeTodo(repo, impl.id, 'accepted');

    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    // Stamp the epic as landed
    const iso = new Date(0).toISOString();
    stampEpicLandedAt(repo, epic.id, iso);

    // Build report: corrupt
    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 } }),
    );

    // Sweep
    await sweepCorruptEpics(repo, { report });

    // Verify: criterion still met
    const criteria = listCriteria(repo, mission.id);
    const criterion = criteria.find((c) => c.id === crit.id)!;
    expect(criterion.met).toBe(true);

    // Verify: no recheck queued
    const rechecks = listPendingRechecks(repo);
    expect(rechecks).toHaveLength(0);
  });

  it('live mission: criterion reopened with provenance preserved in history', async () => {
    // Seed: mission with TWO criteria (one met, one unmet — so mission stays active/non-terminal)
    const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] live', kind: 'mission' });
    upsertMission(repo, mission.id);
    const critMet = addCriterion(repo, mission.id, 'met criterion');
    const critUnmet = addCriterion(repo, mission.id, 'unmet criterion');

    // Mark the first criterion met with real provenance
    setCriterionVerdict(repo, critMet.id, {
      met: true,
      evidence: 'e1',
      verifiedBy: 'verify-gate',
      evidencePaths: ['src/x.ts'],
    });

    // Verify mission is still active (unmet criterion prevents terminal)
    const m = getMission(repo, mission.id)!;
    expect(m.active).toBe(true);

    // Create epic + impl serving the met criterion + land leaf
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', parentId: mission.id, kind: 'epic', status: 'planned' });

    const impl = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[IMPL] impl',
      parentId: epic.id,
      kind: 'leaf',
    });
    await updateTodo(repo, impl.id, { servesCriterionIds: [critMet.id] });
    await completeTodo(repo, impl.id, 'accepted');

    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    // Stamp the epic as landed
    const iso = new Date(0).toISOString();
    stampEpicLandedAt(repo, epic.id, iso);

    // Build report: corrupt
    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 } }),
    );

    // Sweep
    await sweepCorruptEpics(repo, { report });

    // Verify: criterion reopened (met = false)
    const criteria = listCriteria(repo, mission.id);
    const criterion = criteria.find((c) => c.id === critMet.id)!;
    expect(criterion.met).toBe(false);

    // Verify: recheck queued with 'corrupt-land' reason
    const rechecks = listPendingRechecks(repo);
    expect(rechecks).toHaveLength(1);
    expect(rechecks[0].criterionId).toBe(critMet.id);
    expect(rechecks[0].reason).toBe('corrupt-land');

    // Verify: prior verdict in history with provenance intact
    const history = listCriterionVerdictHistory(repo, critMet.id);
    expect(history).toHaveLength(1);
    expect(history[0].met).toBe(true);
    expect(history[0].evidence).toBe('e1');
    expect(history[0].verifiedBy).toBe('verify-gate');
    expect(history[0].verifiedAt).not.toBeNull();
    expect(history[0].evidencePaths).toContain('src/x.ts');
  });

  it('corrupt-land recheck is keyed by mission id: drainMissionRechecks returns it as pending (not cleared)', async () => {
    // Seed: mission with TWO criteria (one met, one unmet — so mission stays active/non-terminal)
    const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] m', kind: 'mission' });
    upsertMission(repo, mission.id);
    const critMet = addCriterion(repo, mission.id, 'met criterion');
    const critUnmet = addCriterion(repo, mission.id, 'unmet criterion');

    // Mark the first criterion met (but unmet second criterion keeps mission active)
    setCriterionVerdict(repo, critMet.id, {
      met: true,
      evidence: 'e1',
      verifiedBy: 'verify-gate',
      evidencePaths: ['src/x.ts'],
    });

    // Verify mission is still active
    const m = getMission(repo, mission.id)!;
    expect(m.active).toBe(true);

    // Create epic + impl serving the met criterion + land leaf
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', parentId: mission.id, kind: 'epic', status: 'planned' });

    const impl = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[IMPL] impl',
      parentId: epic.id,
      kind: 'leaf',
    });
    await updateTodo(repo, impl.id, { servesCriterionIds: [critMet.id] });
    await completeTodo(repo, impl.id, 'accepted');

    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    // Stamp epic as landed
    const iso = new Date(0).toISOString();
    stampEpicLandedAt(repo, epic.id, iso);

    // Build report: corrupt
    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 } }),
    );

    // Sweep: re-opens the criterion and enqueues a recheck
    await sweepCorruptEpics(repo, { report });

    // Verify recheck exists and is keyed by mission id
    const rechecks = listPendingRechecks(repo);
    expect(rechecks.length).toBe(1);
    expect(rechecks[0].todoId).toBe(mission.id);

    // END-TO-END: drain the recheck with the mission id — must return it as pending
    const drainResult = drainMissionRechecks(repo, mission.id);
    expect(drainResult.pending.length).toBe(1);
    expect(drainResult.pending[0].criterionId).toBe(critMet.id);
    expect(drainResult.pending[0].todoId).toBe(mission.id);
    expect(drainResult.cleared.length).toBe(0);
  });

  it('corrupt-land recheck cleared if mission is terminal (closed/converged)', async () => {
    // Seed: mission with single criterion marked met (making it terminal)
    const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] terminal', kind: 'mission' });
    upsertMission(repo, mission.id);
    const crit = addCriterion(repo, mission.id, 'test criterion');

    // Mark criterion met with provenance (auto-closes mission)
    setCriterionVerdict(repo, crit.id, {
      met: true,
      evidence: 'e1',
      verifiedBy: 'verify-gate',
      evidencePaths: ['src/x.ts'],
    });

    // Verify mission is now terminal
    const m = getMission(repo, mission.id)!;
    expect(m.status).toBe('closed');

    // Create epic + impl serving criterion + land leaf
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] corrupt', parentId: mission.id, kind: 'epic', status: 'planned' });

    const impl = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[IMPL] impl',
      parentId: epic.id,
      kind: 'leaf',
    });
    await updateTodo(repo, impl.id, { servesCriterionIds: [crit.id] });
    await completeTodo(repo, impl.id, 'accepted');

    const land = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[LAND] corrupt → master', parentId: epic.id, kind: 'land', status: 'planned' });
    await completeTodo(repo, land.id, 'accepted');

    // Stamp epic as landed
    const iso = new Date(0).toISOString();
    stampEpicLandedAt(repo, epic.id, iso);

    // Build report: corrupt
    const branch = `collab/epic/${epic.id.slice(0, 8)}`;
    const report = await buildEpicBranchStatus(
      listTodos(repo, { includeCompleted: true }),
      probeWith({ [branch]: { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 } }),
    );

    // Sweep: should NOT reopen criterion because mission is terminal
    await sweepCorruptEpics(repo, { report });

    // Verify: no recheck queued for terminal mission
    const rechecks = listPendingRechecks(repo);
    expect(rechecks.length).toBe(0);

    // Verify: criterion still met (not cleared by terminal check)
    const criteria = listCriteria(repo, mission.id);
    const criterion = criteria.find((c) => c.id === crit.id)!;
    expect(criterion.met).toBe(true);
  });
});
