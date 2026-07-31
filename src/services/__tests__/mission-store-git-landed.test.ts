import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, completeTodo, updateTodo, _closeProject } from '../todo-store';
import { upsertMission, addCriterion, listCriteriaWithActions } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-store-git-landed-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  // worker-ledger.ts's DB handle is a module-level singleton memoized on first open,
  // keyed by MERMAID_SUPERVISOR_DIR at that time — leaving it open across tests makes the
  // NEXT test's ledger read (collectMissionStatusFacts) resolve against THIS test's
  // already-rmSync'd project dir, throw, and flip ledgerUnavailable to true (which forces
  // servingEpicLive to `!isLanded(e)`, ignoring `resolveLanded`'s landTruth override and
  // making the whole fixture nondeterministic). Reset it so each test opens its own ledger.
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

// The serving epic gets one settled, accepted, criterion-tagged leaf child so
// servingEpicLive reads false (no ready/in_progress leaf, no childless-grace branch) and
// provingLanded's proof check succeeds directly via the proven leaf (once resolveLanded
// says landed) — isolating the landTruth override's effect on `landed`/`action` from
// liveness noise.
//
// The epic is held (status:'blocked', which sets heldAt) BEFORE the leaf is accepted so
// completeTodo's parent
// roll-up (todo-store.ts:2719, guarded on `parent.heldAt != null`) does NOT auto-close
// the epic to status:'done'. Without this, the leaf's `completeTodo` cascade would land
// the epic for real, making `isLanded(e)` already true and the `landTruth` override a
// no-op — exactly the vacuous-test defect this fixture must avoid. The epic's raw
// status/landedAt stay genuinely unlanded, so only the override can flip `landed`.
async function makeFixture() {
  const m = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: 'Mission: converge',
    kind: 'mission',
  });
  upsertMission(project, m.id);
  const c = addCriterion(project, m.id, 'the capability under test');
  const e = await createTodo(project, {
    ownerSession: 's1',
    title: '[EPIC] serve',
    kind: 'epic',
    parentId: m.id,
    servesCriterionIds: [c.id],
  });
  await updateTodo(project, e.id, { status: 'blocked' });
  const leaf = await createTodo(project, {
    ownerSession: 's1',
    title: 'prove it',
    kind: 'leaf',
    parentId: e.id,
    servesCriterionIds: [c.id],
  });
  await completeTodo(project, leaf.id, 'accepted');
  return { m, c, e };
}

describe('listCriteriaWithActions landTruth override', () => {
  test('landTruth override marks a landedAt-unset serving epic as landed and flips the criterion off building', async () => {
    const { m, e } = await makeFixture();
    const rows = listCriteriaWithActions(project, m.id, { landTruth: new Map([[e.id, true]]) });
    const servingEpic = rows[0].servingEpics.find((s) => s.id === e.id)!;
    expect(servingEpic.landed).toBe(true);
    expect(rows[0].action).not.toBe('building');
    expect(rows[0].action).toBe('verify');
  });

  test('no landTruth override yields identical landed/action to today\'s isLanded-only behavior', async () => {
    const { m, e } = await makeFixture();
    // No opts at all vs. an opts object whose landTruth map doesn't cover this epic — both
    // must fall through resolveLanded's `?? isLanded(e)` to the exact same isLanded-only
    // result, matching every pre-existing caller that passes no 4th/3rd arg.
    const withoutOpts = listCriteriaWithActions(project, m.id);
    const withEmptyMap = listCriteriaWithActions(project, m.id, { landTruth: new Map() });
    expect(withoutOpts).toEqual(withEmptyMap);
    const servingEpic = withoutOpts[0].servingEpics.find((s) => s.id === e.id)!;
    // The epic was held (not auto-rolled-up to done) and never stamped landedAt, so
    // isLanded(e) — and thus resolveLanded with no override — is genuinely false.
    expect(servingEpic.landed).toBe(false);
    expect(withoutOpts[0].action).toBe('discover');
  });
});
