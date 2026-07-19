import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The global supervisor DB (node_profile_override / model resolution) caches its handle by
// MERMAID_SUPERVISOR_DIR; keep it STABLE (not the churned per-test project dir) so forgeMissionFromDoc's
// model resolution doesn't hit a removed file. Per-PROJECT stores stay fresh via the project path.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-intake-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-intake-'));
});

import {
  runMissionIntakePass,
  clusterSignature,
  candidatesFromTrends,
  missionCoversCluster,
  renderIntakeBrief,
  INTAKE_SESSION,
  type IntakeCandidate,
  type MissionIntakeDeps,
} from '../mission-intake';
import { summarizeFrictionTrends } from '../friction-trends';
import {
  _closeProject as closeFriction,
  isClusterIntakeActioned,
  getClusterIntakeProvenance,
  listClusterIntakeProvenance,
  type FrictionLayer,
  type FrictionNote,
} from '../friction-store';
import { getMission, listCriteria, listMissions, _resetMissionDbCache, type MissionSummary } from '../mission-store';
import { _closeProject as closeTodos } from '../todo-store';
import { _closeProject as closeDecisions } from '../decision-record-store';

afterEach(() => {
  _resetMissionDbCache(project);
  closeFriction(project);
  closeTodos(project);
  closeDecisions(project);
  rmSync(project, { recursive: true, force: true });
});

// ── fixture helpers ─────────────────────────────────────────────────────────
function notes(layer: FrictionLayer, reason: string, count: number, sessionCount: number): FrictionNote[] {
  const arr: FrictionNote[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      id: `${layer}:${reason}:${i}`,
      todoId: null,
      session: `sess-${reason}-${i % sessionCount}`,
      attempt: 1,
      layer,
      retryReason: reason,
      detail: null,
      createdAt: new Date(2026, 6, 19, 0, 0, count - i).toISOString(),
    });
  }
  return arr;
}
const trendsOf = (...groups: FrictionNote[][]) => () => summarizeFrictionTrends(groups.flat());

/** A forge stub that builds real UNAPPROVED missions via the EXISTING forgeMissionFromDoc, with the
 *  node LLM mocked (readDoc = our brief, invoke = a spec derived from the cluster). */
function realForgeDep(calls: IntakeCandidate[] = []): MissionIntakeDeps['forge'] {
  return async (proj, candidate, brief) => {
    calls.push(candidate);
    const { forgeMissionFromDoc } = await import('../../mcp/tools/mission-forge');
    const spec = {
      title: `Fix recurring ${candidate.retryReason}`,
      description: `From cluster ${candidate.sig}`,
      criteria: [`the ${candidate.retryReason} friction no longer recurs`, 'a regression test proves it'],
      constraints: [{ rule: 'fix the root cause, not the symptom', rationale: 'anti-whack-a-mole' }],
    };
    const res = await forgeMissionFromDoc(
      proj,
      { session: INTAKE_SESSION, docId: 'intake-doc' },
      { readDoc: async () => brief, invoke: async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(spec) + '\n```' } as any) },
    );
    return { missionId: res.missionId };
  };
}

/** A cheap forge stub that only records the call (no real mission created). */
function countingForge(calls: IntakeCandidate[]): MissionIntakeDeps['forge'] {
  let n = 0;
  return async (_proj, candidate) => {
    calls.push(candidate);
    return { missionId: `stub-mission-${++n}` };
  };
}

const cand = (layer: FrictionLayer, reason: string, over = {}): IntakeCandidate => ({
  layer, reasons: [reason], retryReason: reason, count: 9, distinctSessions: 3,
  sig: clusterSignature(layer, [reason]), ...over,
});

// ── A1: deterministic detector — threshold / layer / session gating ──────────
describe('A1 — deterministic detector, no LLM', () => {
  test('operational 20-count cluster selects zero; one 9-count/3-session orchestration cluster among sub-threshold reasons selects exactly one', async () => {
    const calls: IntakeCandidate[] = [];
    const deps: MissionIntakeDeps = {
      intakeEnabled: () => true,
      forge: countingForge(calls),
      trends: trendsOf(
        notes('operational', 'op-flood', 20, 5),   // ineligible layer → 0 even at count 20
        notes('orchestration', 'orch-big', 9, 3),  // ELIGIBLE: count 9 ≥ 8, sessions 3 ≥ 2
        notes('orchestration', 'orch-small', 4, 4),// sub-threshold count
        notes('domain', 'dom-mid', 6, 6),          // sub-threshold count
        notes('domain', 'dom-onesess', 10, 1),     // fails MIN_SESSIONS (1 distinct session)
      ),
    };
    const r = await runMissionIntakePass(project, deps);
    expect(r.reason).toBe('drafted');
    expect(calls).toHaveLength(1);
    expect(calls[0].layer).toBe('orchestration');
    expect(calls[0].retryReason).toBe('orch-big');
  });

  test('operational-only friction (even over threshold across many sessions) never drafts', async () => {
    const calls: IntakeCandidate[] = [];
    const r = await runMissionIntakePass(project, {
      intakeEnabled: () => true,
      forge: countingForge(calls),
      trends: trendsOf(notes('operational', 'stale-worktree', 30, 6)),
    });
    expect(r.reason).toBe('no-eligible-cluster');
    expect(calls).toHaveLength(0);
  });

  test('candidatesFromTrends excludes operational and preserves counts/sessions', () => {
    const t = summarizeFrictionTrends([
      ...notes('operational', 'op', 5, 2),
      ...notes('domain', 'dom', 7, 3),
    ]);
    const cs = candidatesFromTrends(t);
    expect(cs.map((c) => c.layer)).toEqual(['domain']);
    expect(cs[0]).toMatchObject({ retryReason: 'dom', count: 7, distinctSessions: 3, sig: 'domain:dom' });
  });

  test('disabled toggle (default OFF) drafts nothing', async () => {
    const calls: IntakeCandidate[] = [];
    const r = await runMissionIntakePass(project, {
      intakeEnabled: () => false,
      forge: countingForge(calls),
      trends: trendsOf(notes('orchestration', 'orch-big', 12, 4)),
    });
    expect(r.reason).toBe('intake-disabled');
    expect(calls).toHaveLength(0);
  });
});

// ── A2: brief → existing forge path → unapproved + inactive + proposed + provenance ──
describe('A2 — brief → forgeMissionFromDoc → unapproved draft with provenance', () => {
  test('drafts an UNAPPROVED, inactive mission with PROPOSED constraints and a sourceClusterSig stamp', async () => {
    const r = await runMissionIntakePass(project, {
      intakeEnabled: () => true,
      forge: realForgeDep(),
      trends: trendsOf(notes('orchestration', 'gate-format', 9, 3)),
    });
    expect(r.reason).toBe('drafted');
    const missionId = r.drafted!.missionId;

    // Mission is UNAPPROVED + INACTIVE (never self-drives).
    const mission = getMission(project, missionId);
    expect(mission?.status).toBe('unapproved');
    expect(mission?.active).toBe(false);
    expect(mission?.awaitingApprovalSince).not.toBe(null);
    // Criteria instantiated by the forge path.
    expect(listCriteria(project, missionId).length).toBeGreaterThan(0);

    // The brief was written to .collab/intake/<sig>.md.
    expect(r.drafted!.briefPath).toContain(join('.collab', 'intake'));
    expect(existsSync(r.drafted!.briefPath)).toBe(true);
    expect(readFileSync(r.drafted!.briefPath, 'utf8')).toContain('gate-format');

    // Provenance (sourceClusterSig + N occ / M sessions) is queryable from the friction store.
    const prov = getClusterIntakeProvenance(project, 'orchestration:gate-format');
    expect(prov).not.toBe(null);
    expect(prov).toMatchObject({ clusterSig: 'orchestration:gate-format', layer: 'orchestration', count: 9, sessions: 3, missionId });
    expect(listClusterIntakeProvenance(project).map((p) => p.missionId)).toContain(missionId);
  });

  test('renderIntakeBrief carries the provenance line the forge node reads', () => {
    const brief = renderIntakeBrief(cand('domain', 'api-rederived', { count: 11, distinctSessions: 4 }));
    expect(brief).toContain('domain:api-rederived');
    expect(brief).toContain('11 occurrence(s) / 4 session(s)');
    expect(brief).toContain('ROOT CAUSE');
  });
});

// ── A3: anti-spam + ceiling + 3-surface dedup ───────────────────────────────
describe('A3 — anti-spam + ceiling + dedup', () => {
  test('a double-tick drafts exactly one (permanent actioned marker)', async () => {
    const calls: IntakeCandidate[] = [];
    const deps: MissionIntakeDeps = {
      intakeEnabled: () => true,
      forge: countingForge(calls),
      trends: trendsOf(notes('orchestration', 'orch-big', 9, 3)),
    };
    const r1 = await runMissionIntakePass(project, deps);
    const r2 = await runMissionIntakePass(project, deps);
    expect(r1.reason).toBe('drafted');
    expect(r2.reason).toBe('no-eligible-cluster');
    expect(calls).toHaveLength(1);
    expect(isClusterIntakeActioned(project, 'orchestration:orch-big')).toBe(true);
  });

  test('at MAX_PENDING_INTAKE the pass drafts zero (ceiling)', async () => {
    const calls: IntakeCandidate[] = [];
    const stubUnapproved = (id: string): MissionSummary => ({
      node: { id, title: 't', status: 'planned' },
      ownerSession: null, assigneeSession: null,
      mission: { status: 'unapproved' } as any,
      rollup: {} as any, criteria: [], epics: [],
    });
    const r = await runMissionIntakePass(project, {
      intakeEnabled: () => true,
      forge: countingForge(calls),
      maxPending: 3,
      listMissions: () => [stubUnapproved('a'), stubUnapproved('b'), stubUnapproved('c')],
      trends: trendsOf(notes('orchestration', 'orch-big', 20, 5)),
    });
    expect(r.reason).toBe('pending-ceiling');
    expect(r.pending).toBe(3);
    expect(calls).toHaveLength(0);
  });

  test('dedup surface 1 — an open triage BUG todo covering the reason refuses', () => {
    const c = cand('domain', 'missing-model');
    const covered = missionCoversCluster(project, c, {
      listTodos: () => [{ id: 't1', title: 'Recurring friction: missing-model', description: null, status: 'planned', triageTag: 'domain' } as any],
      listMissions: () => [],
      getProvenance: () => null,
    });
    expect(covered).toBe(true);
    // a DONE triage todo does not cover (already resolved).
    const notCovered = missionCoversCluster(project, c, {
      listTodos: () => [{ id: 't1', title: 'Recurring friction: missing-model', description: null, status: 'done', triageTag: 'domain' } as any],
      listMissions: () => [], getProvenance: () => null,
    });
    expect(notCovered).toBe(false);
  });

  test('dedup surface 2 — an open EPIC referencing the reason refuses', () => {
    const c = cand('orchestration', 'wrong-test-cmd');
    const covered = missionCoversCluster(project, c, {
      listTodos: () => [{ id: 'e1', title: '[EPIC] Fix wrong-test-cmd harness', description: null, status: 'planned', kind: 'epic' } as any],
      listMissions: () => [], getProvenance: () => null,
    });
    expect(covered).toBe(true);
  });

  test('dedup surface 3 — a prior forged mission for the signature (still present) refuses', () => {
    const c = cand('orchestration', 'claim-lost');
    const prov = { clusterSig: c.sig, layer: c.layer, reasons: c.reasons, count: 9, sessions: 3, missionId: 'm-prior', briefPath: '/x', at: 'now' };
    const covered = missionCoversCluster(project, c, {
      listTodos: () => [],
      listMissions: () => [{ node: { id: 'm-prior', title: 't', status: 'planned' } } as any],
      getProvenance: () => prov,
    });
    expect(covered).toBe(true);
    // provenance points at a mission that no longer exists → NOT covered (stale, may re-draft).
    const gone = missionCoversCluster(project, c, {
      listTodos: () => [], listMissions: () => [], getProvenance: () => prov,
    });
    expect(gone).toBe(false);
  });
});

// ── A5: multi-tick simulation ────────────────────────────────────────────────
describe('A5 — multi-tick simulation over mixed friction', () => {
  test('≥5 ticks: exactly the over-threshold domain/orchestration clusters draft (one/tick, highest first), zero self-activate, zero duplicate', async () => {
    const calls: IntakeCandidate[] = [];
    const deps: MissionIntakeDeps = {
      intakeEnabled: () => true,
      forge: realForgeDep(calls), // builds REAL unapproved missions so we can assert non-activation
      // Mixed fixture: two ELIGIBLE clusters (domain-12 > orch-9), plus ineligible/sub-threshold noise.
      trends: trendsOf(
        notes('domain', 'dom-huge', 12, 4),        // eligible, highest count → drafts FIRST
        notes('orchestration', 'orch-mid', 9, 3),  // eligible → drafts SECOND
        notes('operational', 'op-flood', 40, 8),   // ineligible layer
        notes('orchestration', 'orch-low', 5, 5),  // sub-threshold count
        notes('domain', 'dom-onesess', 15, 1),     // fails min-sessions
      ),
    };

    const outcomes: string[] = [];
    for (let tick = 0; tick < 6; tick++) {
      const r = await runMissionIntakePass(project, deps);
      outcomes.push(r.reason);
    }

    // Exactly two drafts, one per tick, highest count first, then nothing more.
    const drafted = outcomes.filter((o) => o === 'drafted');
    expect(drafted).toHaveLength(2);
    expect(calls.map((c) => c.retryReason)).toEqual(['dom-huge', 'orch-mid']);
    expect(outcomes.slice(2).every((o) => o === 'no-eligible-cluster')).toBe(true);

    // Zero operational cluster ever drafted.
    expect(calls.some((c) => c.layer === 'operational')).toBe(false);

    // Every drafted mission is UNAPPROVED + INACTIVE — zero self-activation.
    const missions = listMissions(project);
    expect(missions.length).toBe(2);
    expect(missions.every((m) => m.mission.status === 'unapproved')).toBe(true);
    expect(missions.every((m) => m.mission.active === false)).toBe(true);

    // Both cluster signatures are permanently actioned (no duplicate on further ticks).
    expect(isClusterIntakeActioned(project, 'domain:dom-huge')).toBe(true);
    expect(isClusterIntakeActioned(project, 'orchestration:orch-mid')).toBe(true);
    expect(listClusterIntakeProvenance(project)).toHaveLength(2);
  });
});
