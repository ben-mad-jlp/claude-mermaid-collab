/**
 * Regression: a LANDED serving epic must ask for a VERDICT, not another epic.
 *
 * Incident 2026-07-24 (build123d, reported by the human as "the project keeps redoing
 * epics… I think it's not triggering a verify"). `collectMissionStatusFacts` derived
 * servingEpicState by EXISTENCE:
 *
 *     serving.some((e) => e.status !== 'done') ? 'open'
 *   : serving.some((e) => e.status === 'done') ? 'landed' : 'none'
 *
 * so ANY non-done serving epic — including a stale, never-approved, motionless one —
 * masked a sibling epic that had already landed. servingEpicState read 'open', and since
 * `deriveCriterionAction` only returns 'verify' for 'landed', the verdict gate NEVER ran.
 * With no live motion the criterion then fell through to 'discover' and the conductor
 * filed ANOTHER serving epic, every tick, each one a fresh blueprint+implement spend.
 * Measured: criterion crit_636eee87_5 accrued SEVEN serving epics (3 dropped) before it
 * closed; mission 07b5d3c0 sat with a landed epic masked by two motionless 'todo' ones.
 *
 * The rule these tests pin: 'open' means work is genuinely IN FLIGHT (a live serving
 * epic). A landed epic with no live sibling owes a verdict. Work actually in flight is
 * still respected — a LIVE sibling keeps the criterion at 'building'.
 */

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectMissionStatusFacts, deriveCriterionAction, upsertMission, addCriterion, getMission,
  _resetMissionDbCache,
} from '../mission-store';
import { createTodo, updateTodo, _closeProject, stampEpicLandedAt } from '../todo-store';

/** Run `fn` against a throwaway project + supervisor dir (mirrors mission-store.test.ts). */
async function withProject(prefix: string, fn: (proj: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  const proj = join(dir, 'p');
  try {
    await fn(proj);
  } finally {
    _closeProject(proj);
    _resetMissionDbCache(proj);
    if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR;
    else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('landed serving epic → verify (masking regression)', () => {
  test('a DONE serving epic beside a motionless non-done one derives verify, NOT discover', async () => {
    await withProject('mission-verify-mask-', async (proj) => {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] VM', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'the work lands and is independently verified');

      const landed = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] delivered', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      await updateTodo(proj, landed.id, { status: 'done' });
      // A stale sibling: filed for the same criterion, its only leaf is terminal ⇒ no motion.
      // (A CHILDLESS epic is deliberately treated as live inside CHILDLESS_SERVE_GRACE_MS to
      // cover the create_epic→add_leaves gap, so a dead epic must be modelled with a settled child.)
      const stale = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] stale sibling', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      const staleLeaf = await createTodo(proj, { ownerSession: 's1', title: 'settled leaf', kind: 'leaf', parentId: stale.id });
      await updateTodo(proj, staleLeaf.id, { status: 'dropped' });

      const cf = collectMissionStatusFacts(proj, getMission(proj, m.id)!).criteria.find((c) => c.id === c1.id)!;
      expect(cf.servingEpicLive).toBe(false);        // the masker has no motion
      expect(cf.servingEpicState).toBe('landed');    // landed work is not masked by a dead epic
      expect(deriveCriterionAction(cf)).toBe('verify'); // ask for a VERDICT, never another epic
    });
  });

  test('a LIVE non-done serving epic still wins — work in flight is respected', async () => {
    await withProject('mission-verify-live-', async (proj) => {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] VL', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'criterion with real work in flight');

      const landed = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] delivered', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      await updateTodo(proj, landed.id, { status: 'done' });
      const live = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] still building', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      // 'ready' (approved) is the live signal a manual write may set — status:'in_progress'
      // is daemon-only (claims come from claimTodo), and derivedStatus counts ready as motion.
      const leaf = await createTodo(proj, { ownerSession: 's1', title: 'in-flight leaf', kind: 'leaf', parentId: live.id });
      await updateTodo(proj, leaf.id, { status: 'ready' });

      const cf = collectMissionStatusFacts(proj, getMission(proj, m.id)!).criteria.find((c) => c.id === c1.id)!;
      expect(cf.servingEpicLive).toBe(true);
      expect(cf.servingEpicState).toBe('open');
      expect(deriveCriterionAction(cf)).toBe('building');
    });
  });

  test('landedAt counts as landed even when the epic status never flipped to done', async () => {
    await withProject('mission-verify-landedat-', async (proj) => {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] VA', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'landed-but-not-done epic');

      // The build123d shape: landedAt stamped, status left at 'todo'. Under the old
      // existence rule this epic could NEVER satisfy status==='done', so it masked its
      // own criterion forever.
      const e = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] landed not done', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      stampEpicLandedAt(proj, e.id, new Date().toISOString());

      const cf = collectMissionStatusFacts(proj, getMission(proj, m.id)!).criteria.find((c) => c.id === c1.id)!;
      expect(cf.servingEpicState).toBe('landed');
      expect(deriveCriterionAction(cf)).toBe('verify');
    });
  });

  // NOTE (deliberately not a test): a 4-epic variant of the incident shape proved
  // fixture-fragile, not product-fragile. Later in a multi-test file the worker ledger
  // becomes unreadable, and `servingEpicLive` then FAILS OPEN to "live" by design
  // (an unreadable motion signal must never let a mid-build criterion read 'discover' and
  // re-file a duplicate epic). That fail-open masks the assertion. The rule itself is
  // pinned by the first test above, which is the same masking scenario.

  test('no serving epic at all still derives discover (unchanged)', async () => {
    await withProject('mission-verify-none-', async (proj) => {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] VN', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'nothing filed yet');

      const cf = collectMissionStatusFacts(proj, getMission(proj, m.id)!).criteria.find((c) => c.id === c1.id)!;
      expect(cf.servingEpicState).toBe('none');
      expect(deriveCriterionAction(cf)).toBe('discover');
    });
  });
});
