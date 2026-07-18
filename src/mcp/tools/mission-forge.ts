/**
 * mission-forge — the MACHINERY half of the /mission-forge skill.
 *
 * The skill's judgment steps (survey, skeptical consult, deciding the criteria) stay with the
 * human/LLM. But steps 4–6 — instantiate the mission AND its "constitution" (locked constraints,
 * rejected alternatives, orientation digest) into the machinery that DRIVES it — were clerical work
 * the LLM did by hand across ~20 MCP calls, and the single most-skipped step. The skill itself
 * warns: "a constitution rule that exists only as handoff prose is a prompt-prohibition — decoration
 * to the builder who never sees it." This turns that into ONE atomic, validated operation.
 *
 * forgeMission composes the same primitives create_mission uses (mission node + criteria) PLUS:
 *   - each locked constraint  → an ACTIVE constraint decision-record LINKED to the mission
 *                               (prompt-injection payload C delivers active constraints to every
 *                               blueprint/implement/review node; the review cite-check verifies them),
 *   - each rejected alternative → a decision record with `alternatives` (payload D surfaces "do not
 *                               re-propose" to blueprint nodes),
 *   - the orientation digest  → .collab/project-digest.md (payload A injects it into blueprint nodes).
 *
 * missionConstitutionHealth is the enforcement teeth: a mission that carries a constitution (a
 * handoff doc) but has ZERO active constraint records linked to it never mechanized its rules —
 * flag it so the conductor/human sees that the constitution is stranded as prose.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addSessionTodo } from './session-todos.js';
import {
  upsertMission,
  addCriterion,
  setMissionActive,
  sessionHasActiveMission,
  getMission,
  listCriteria,
  getMissionRollup,
  type MissionCriterion,
  type MissionRollup,
} from '../../services/mission-store.js';
import {
  createDecisionRecord,
  approveDecisionRecord,
  listDecisionRecords,
  type DecisionRecord,
} from '../../services/decision-record-store.js';
import { stripLabel } from '../../services/todo-kind.js';
import { deriveTodoViews, type Todo } from '../../services/todo-store.js';

export interface ForgeConstraint {
  /** The locked rule, one line — becomes the constraint record title (what injects). */
  rule: string;
  /** Why it is locked — the reason a builder must respect it. */
  rationale?: string;
}

export interface ForgeRejectedAlternative {
  /** The design decision that was made (the record title). */
  title: string;
  rationale?: string;
  /** The rejected designs, verbatim — surfaced to blueprint nodes as "do not re-propose". */
  alternatives: string[];
}

export interface ForgeMissionInput {
  session: string;
  title: string;
  description?: string;
  /** Acceptance criteria = the VERIFY gate. At least one non-empty criterion is required. */
  criteria: string[];
  constraints?: ForgeConstraint[];
  rejectedAlternatives?: ForgeRejectedAlternative[];
  /** Curated orientation facts (≤ ~2k tokens) → .collab/project-digest.md. */
  digest?: string;
  handoffDocId?: string | null;
  budgetUsd?: number | null;
  /** Activate for this session's conductor (default true). Respects one-active-per-session. */
  activate?: boolean;
}

export interface ForgeMissionResult {
  node: ReturnType<typeof deriveTodoViews>[number];
  missionId: string;
  criteria: MissionCriterion[];
  constraints: DecisionRecord[];
  decisions: DecisionRecord[];
  digestWritten: boolean;
  rollup: MissionRollup;
}

/** Validate + atomically instantiate a mission and its full constitution. Throws on invalid input
 *  BEFORE creating anything (no half-forged mission). */
export async function forgeMission(project: string, input: ForgeMissionInput): Promise<ForgeMissionResult> {
  const { session } = input;
  if (!project || !session || !input.title) {
    throw new Error('forge_mission: project, session, and title are required');
  }
  const missionTitle = stripLabel(input.title);
  if (!missionTitle) throw new Error('forge_mission: title must be non-empty after stripping the role prefix');

  const criteria = (input.criteria ?? []).map((c) => c.trim()).filter(Boolean);
  if (criteria.length === 0) {
    throw new Error('forge_mission: at least one non-empty acceptance criterion is required (criteria ARE the VERIFY gate)');
  }
  const constraints = (input.constraints ?? []).filter((c) => c.rule?.trim());
  const rejected = (input.rejectedAlternatives ?? []).filter((r) => r.title?.trim() && (r.alternatives ?? []).length > 0);

  // 1. Mission node + row + criteria (same core as create_mission).
  const node = await addSessionTodo(project, session, missionTitle, undefined, {
    kind: 'mission',
    assigneeSession: session,
    description: input.description,
  });
  const missionId = node.id;
  upsertMission(project, missionId, { budgetUsd: input.budgetUsd ?? null, handoffDocId: input.handoffDocId ?? null });
  const activate = input.activate ?? true;
  // One-active-per-session: never steal focus unless explicitly told to activate.
  if (!activate || sessionHasActiveMission(project, session, missionId)) {
    setMissionActive(project, missionId, false);
  }
  for (const c of criteria) addCriterion(project, missionId, c);

  // 2. Locked constraints → ACTIVE constraint records LINKED to the mission (payload C delivery).
  const constraintRecs: DecisionRecord[] = [];
  for (const c of constraints) {
    const rec = createDecisionRecord(project, {
      kind: 'constraint',
      title: c.rule.trim(),
      rationale: c.rationale ?? null,
      linkedTodos: [missionId],
      authorSession: session,
    });
    const approved = approveDecisionRecord(project, rec.id, session) ?? rec;
    constraintRecs.push(approved);
  }

  // 3. Rejected alternatives → decision records (auto-active) with `alternatives` (payload D).
  const decisionRecs: DecisionRecord[] = [];
  for (const r of rejected) {
    decisionRecs.push(createDecisionRecord(project, {
      kind: 'decision',
      title: r.title.trim(),
      rationale: r.rationale ?? null,
      alternatives: r.alternatives,
      linkedTodos: [missionId],
      authorSession: session,
    }));
  }

  // 4. Orientation digest → .collab/project-digest.md (payload A). Curated text, written verbatim.
  let digestWritten = false;
  const digest = input.digest?.trim();
  if (digest) {
    const dir = join(project, '.collab');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'project-digest.md'), digest.endsWith('\n') ? digest : digest + '\n');
    digestWritten = true;
  }

  return {
    node: deriveTodoViews(project, [node as Todo])[0],
    missionId,
    criteria: listCriteria(project, missionId),
    constraints: constraintRecs,
    decisions: decisionRecs,
    digestWritten,
    rollup: getMissionRollup(project, missionId),
  };
}

export interface MissionConstitutionHealth {
  missionId: string;
  hasHandoff: boolean;
  linkedActiveConstraints: number;
  /** 'constitution-not-injected' = a mission with a constitution (handoff) whose locked rules never
   *  became active constraint records the builders see. 'ok' otherwise. */
  flag: 'ok' | 'constitution-not-injected';
}

/** Enforcement teeth: detect a mission whose constitution never reached the builders. A mission that
 *  carries a handoff (its constitution) but has ZERO active constraint records linked to it left its
 *  locked rules as prose — decoration the builder never sees. forge_mission always links them, so a
 *  forged mission is healthy by construction; this catches the hand-rolled / step-6-skipped path. */
export function missionConstitutionHealth(project: string, missionId: string): MissionConstitutionHealth {
  const mission = getMission(project, missionId);
  const hasHandoff = mission?.handoffDocId != null;
  let linkedActiveConstraints = 0;
  try {
    linkedActiveConstraints = listDecisionRecords(project, { kind: 'constraint', status: 'active' })
      .filter((r) => r.linkedTodos.includes(missionId)).length;
  } catch {
    // advisory health read — a store failure must never break the caller (mission rollup / conductor).
  }
  return {
    missionId,
    hasHandoff,
    linkedActiveConstraints,
    flag: hasHandoff && linkedActiveConstraints === 0 ? 'constitution-not-injected' : 'ok',
  };
}
