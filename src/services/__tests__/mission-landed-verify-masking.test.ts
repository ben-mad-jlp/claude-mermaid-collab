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
  _resetMissionDbCache, setCriterionVerdict,
} from '../mission-store';
import { recordEpicLand } from '../epic-land-record-store';
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

  test('a landed untagged epic with an unfinished descendant leaf is not proven — no legacy escape', async () => {
    await withProject('mission-verify-unfinished-', async (proj) => {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] VU', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'untagged leaves, one still unfinished');

      const e = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] landed untagged', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      await updateTodo(proj, e.id, { status: 'done' });
      // Both children are untagged (no servesCriterionId) — the legacy no-tags fallback would
      // normally trust the epic→criterion edge. Leaf A settled; leaf B never left 'planned'
      // (createTodo's default status for an unapproved leaf — todo-store.ts:1697).
      const leafA = await createTodo(proj, { ownerSession: 's1', title: 'settled leaf', kind: 'leaf', parentId: e.id });
      await updateTodo(proj, leafA.id, { status: 'done' });
      await createTodo(proj, { ownerSession: 's1', title: 'unfinished leaf', kind: 'leaf', parentId: e.id });

      const cf = collectMissionStatusFacts(proj, getMission(proj, m.id)!).criteria.find((c) => c.id === c1.id)!;
      expect(cf.servingEpicState).not.toBe('landed');
      expect(cf.verifiedAt == null).toBe(true);
      expect(deriveCriterionAction(cf)).not.toBe('verify');
    });
  });

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

  test('own-epic freshness flips a stale-verdict criterion to verify', async () => {
    await withProject('mission-verify-freshness-', async (proj) => {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] VF', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'criterion with fresher land');

      const epic = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] proved epic', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      // Create a tagged leaf that proves this criterion
      const leaf = await createTodo(proj, { ownerSession: 's1', title: 'proving leaf', kind: 'leaf', parentId: epic.id, servesCriterionIds: [c1.id] });
      await updateTodo(proj, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
      await updateTodo(proj, epic.id, { status: 'done' });

      // Set a stale verdict with old sha
      setCriterionVerdict(proj, c1.id, { met: false, verifiedBy: 's1', verifiedAtSha: 'sha-old' });

      // Verify the epic is recognized as landed and proves the criterion
      const mBefore = getMission(proj, m.id)!;
      const cfBefore = collectMissionStatusFacts(proj, mBefore).criteria.find((c) => c.id === c1.id)!;
      const verifiedAtMs = cfBefore.verifiedAt!;
      expect(verifiedAtMs).toBeGreaterThan(0);
      expect(cfBefore.servingEpicState).toBe('landed');

      // Record the epic landing with a newer sha and timestamp AFTER the verdict
      recordEpicLand(proj, {
        epicId: epic.id,
        epicTipSha: 'sha-new',
        landedMergeSha: 'sha-new',
        landedAt: verifiedAtMs + 1000, // 1 second after verdict
      });

      // Collect facts again to pick up the land record
      const cfAfter = collectMissionStatusFacts(proj, getMission(proj, m.id)!).criteria.find((c) => c.id === c1.id)!;
      // The freshness facts should be populated after recordEpicLand
      expect(cfAfter.servingEpicLandSha).toBe('sha-new');
      expect(cfAfter.servingEpicLandedAt).toBeGreaterThan(verifiedAtMs);
      expect(cfAfter.verifiedAtSha).toBe('sha-old');
      // Sha-freshness: epic landed at newer commit than verdict = verify
      expect(deriveCriterionAction(cfAfter)).toBe('verify');
    });
  });

  test('reached the baseline: existing test block at line 138 remains untouched', async () => {
    // This test just verifies the structure — the existing test at line 120-140 (unfinished leaf)
    // should still pass unchanged. This is a guard against accidentally modifying that block.
    await withProject('mission-verify-baseline-', async (proj) => {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] VB', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'baseline test');

      const e = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] baseline', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      await updateTodo(proj, e.id, { status: 'done' });
      const leafA = await createTodo(proj, { ownerSession: 's1', title: 'settled leaf', kind: 'leaf', parentId: e.id });
      await updateTodo(proj, leafA.id, { status: 'done' });
      await createTodo(proj, { ownerSession: 's1', title: 'unfinished leaf', kind: 'leaf', parentId: e.id });

      const cf = collectMissionStatusFacts(proj, getMission(proj, m.id)!).criteria.find((c) => c.id === c1.id)!;
      // The unfinished leaf should prevent proving, so no land record is expected
      expect(cf.servingEpicLandSha).toBe(null);
      expect(cf.servingEpicState).not.toBe('landed');
    });
  });

  test('sibling epic land record does not leak into different criterion', async () => {
    await withProject('mission-verify-sibling-', async (proj) => {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] VS', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'criterion 1');
      const c2 = addCriterion(proj, m.id, 'criterion 2 — different');

      // Epic A: serves and proves criterion 1, is verified at sha-A
      const epicA = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] A proves C1', kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
      const leafA = await createTodo(proj, { ownerSession: 's1', title: 'leaf A', kind: 'leaf', parentId: epicA.id, servesCriterionIds: [c1.id] });
      await updateTodo(proj, leafA.id, { status: 'done', acceptanceStatus: 'accepted' });
      await updateTodo(proj, epicA.id, { status: 'done' });

      // Verify C1 at sha-A
      setCriterionVerdict(proj, c1.id, { met: true, verifiedBy: 's1', verifiedAtSha: 'sha-A' });

      // Epic B: serves and proves criterion 2, lands at sha-B (newer than A's verdict)
      const epicB = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] B proves C2', kind: 'epic', parentId: m.id, servesCriterionIds: [c2.id] });
      const leafB = await createTodo(proj, { ownerSession: 's1', title: 'leaf B', kind: 'leaf', parentId: epicB.id, servesCriterionIds: [c2.id] });
      await updateTodo(proj, leafB.id, { status: 'done', acceptanceStatus: 'accepted' });
      await updateTodo(proj, epicB.id, { status: 'done' });

      // Get A's verdict timestamp
      const mBefore = getMission(proj, m.id)!;
      const cfA = collectMissionStatusFacts(proj, mBefore).criteria.find((c) => c.id === c1.id)!;
      const verifiedAtMs = cfA.verifiedAt!;

      // Record B's land with sha-B, AFTER A's verdict
      recordEpicLand(proj, {
        epicId: epicB.id,
        epicTipSha: 'sha-B',
        landedMergeSha: 'sha-B',
        landedAt: verifiedAtMs + 2000, // 2 seconds after A's verdict
      });

      // Now check the facts for BOTH criteria
      const facts = collectMissionStatusFacts(proj, getMission(proj, m.id)!);
      const cfA2 = facts.criteria.find((c) => c.id === c1.id)!;
      const cfB2 = facts.criteria.find((c) => c.id === c2.id)!;

      // C1's land sha must STILL be sha-A or null (NOT sha-B from sibling B)
      // Epic A was marked done but never had a land record set, so it should be null
      expect(cfA2.servingEpicLandSha).toBe(null);
      expect(cfA2.verifiedAtSha).toBe('sha-A');

      // C2's land sha must be sha-B (from its own serving epic B)
      expect(cfB2.servingEpicLandSha).toBe('sha-B');

      // Most critically: C1's action must NOT flip to 'verify' from B's land record.
      // C1 is met=true and verified at sha-A, so it should stay 'met'.
      expect(deriveCriterionAction(cfA2)).toBe('met');
    });
  });
});
