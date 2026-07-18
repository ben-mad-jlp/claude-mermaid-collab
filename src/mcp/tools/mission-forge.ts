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
  setMissionApproved,
  sessionHasActiveMission,
  getMission,
  listCriteria,
  getMissionRollup,
  type MissionCriterion,
  type MissionRollup,
  type MissionRow,
} from '../../services/mission-store.js';
import {
  createDecisionRecord,
  approveDecisionRecord,
  listDecisionRecords,
  type DecisionRecord,
} from '../../services/decision-record-store.js';
import { stripLabel } from '../../services/todo-kind.js';
import { deriveTodoViews, type Todo } from '../../services/todo-store.js';
import { invokeNode, type NodeSpec, type NodeResult } from '../../agent/node-invoker.js';
import { resolveNodeModel, resolveNodeProvider, resolveOrchestrationEffort } from '../../services/node-provider.js';
import { ORCHESTRATION_NODE_PROFILE } from '../../services/node-kinds.js';
import type { EffortLevel } from '../../agent/contracts.js';

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
  /** Whether the mission is APPROVED on creation (default true — a HUMAN authoring the forge
   *  decided the rules). Pass false (the doc→node path) to create it UNAPPROVED: derived status
   *  'unapproved', INACTIVE, and its constraints left PROPOSED — it sits in the list until a human
   *  approves it (approve_mission), which activates it AND ratifies the constraints so they inject. */
  approved?: boolean;
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
  const approved = input.approved ?? true;
  upsertMission(project, missionId, {
    budgetUsd: input.budgetUsd ?? null,
    handoffDocId: input.handoffDocId ?? null,
    awaitingApprovalSince: approved ? null : Date.now(), // unapproved mission → status 'unapproved'
  });
  const activate = (input.activate ?? true) && approved; // an unapproved mission is never the active driven one
  // One-active-per-session: never steal focus unless explicitly told to activate.
  if (!activate || sessionHasActiveMission(project, session, missionId)) {
    setMissionActive(project, missionId, false);
  }
  for (const c of criteria) addCriterion(project, missionId, c);

  // 2. Locked constraints → constraint records LINKED to the mission (payload C delivery). Approved
  //    (active → injects now) when the mission is approved; left PROPOSED until approve_mission when
  //    it is unapproved (the doc→node path — an LLM-inferred constitution waits for a human nod).
  const constraintRecs: DecisionRecord[] = [];
  for (const c of constraints) {
    const rec = createDecisionRecord(project, {
      kind: 'constraint',
      title: c.rule.trim(),
      rationale: c.rationale ?? null,
      linkedTodos: [missionId],
      authorSession: session,
    });
    const final = approved ? (approveDecisionRecord(project, rec.id, session) ?? rec) : rec;
    constraintRecs.push(final);
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
  linkedProposedConstraints: number;
  /** 'ok' — constraints are active (injecting) or there is no constitution to enforce.
   *  'constitution-pending-approval' — the rules exist as PROPOSED records but await a human nod
   *    (the normal doc→node state before approve_mission).
   *  'constitution-not-injected' — a mission with a handoff but ZERO constraint records at all: its
   *    locked rules were left as prose the builder never sees (the hand-rolled / step-6-skipped path). */
  flag: 'ok' | 'constitution-pending-approval' | 'constitution-not-injected';
}

/** Enforcement teeth: detect a mission whose constitution never reached the builders. forge_mission
 *  always links the records, so a forged+approved mission is healthy by construction; this catches
 *  the hand-rolled / step-6-skipped path ('not-injected') and the forged-but-unratified state
 *  ('pending-approval'). */
export function missionConstitutionHealth(project: string, missionId: string): MissionConstitutionHealth {
  const mission = getMission(project, missionId);
  const hasHandoff = mission?.handoffDocId != null;
  let linkedActiveConstraints = 0;
  let linkedProposedConstraints = 0;
  try {
    const linked = (status: 'active' | 'proposed') =>
      listDecisionRecords(project, { kind: 'constraint', status }).filter((r) => r.linkedTodos.includes(missionId)).length;
    linkedActiveConstraints = linked('active');
    linkedProposedConstraints = linked('proposed');
  } catch {
    // advisory health read — a store failure must never break the caller (mission rollup / conductor).
  }
  const flag: MissionConstitutionHealth['flag'] =
    linkedActiveConstraints > 0 || !hasHandoff ? 'ok'
    : linkedProposedConstraints > 0 ? 'constitution-pending-approval'
    : 'constitution-not-injected';
  return { missionId, hasHandoff, linkedActiveConstraints, linkedProposedConstraints, flag };
}

export interface ApproveMissionResult {
  mission: MissionRow;
  approvedConstraints: DecisionRecord[];
}

/** Approve a forged (unapproved) mission AND ratify its constitution: clear the mission's
 *  awaitingApprovalSince (→ leaves 'unapproved', becomes active/driveable) and flip its PROPOSED
 *  linked constraint records to active so they inject into the builders (payload C). Idempotent. */
export function approveMissionAndConstitution(project: string, missionId: string, approvedBy: string): ApproveMissionResult {
  const mission = setMissionApproved(project, missionId);
  const approvedConstraints: DecisionRecord[] = [];
  try {
    const proposed = listDecisionRecords(project, { kind: 'constraint', status: 'proposed' })
      .filter((r) => r.linkedTodos.includes(missionId));
    for (const r of proposed) {
      const a = approveDecisionRecord(project, r.id, approvedBy);
      if (a) approvedConstraints.push(a);
    }
  } catch {
    // best-effort constraint ratification — the mission approval itself already committed.
  }
  return { mission, approvedConstraints };
}

// ─────────────────────────── doc → mission (server-side forge NODE) ───────────────────────────

/** The mission-forge NODE prompt: read a problem/design doc (inlined), survey the repo, and emit a
 *  structured mission spec as JSON. Encodes the /mission-forge discipline (criteria = falsifiable
 *  capability assertions, sequenced by risk, one measured-outcome last; constraints = hard rules;
 *  rejected alternatives; a ≤2k orientation digest). Self-contained — references nothing in skills/. */
export function buildForgePrompt(docContent: string): string {
  return [
    'You are the MISSION FORGE node. Turn the problem/design document below into a DRIVEN convergence',
    'mission spec. READ-ONLY: use Read/Grep/Glob and Bash for INSPECTION only (survey the repo to',
    'ground the criteria in real files/seams). Do NOT edit anything.',
    '',
    '=== SOURCE DOCUMENT START ===',
    docContent,
    '=== SOURCE DOCUMENT END ===',
    '',
    'Produce a mission spec with this DISCIPLINE:',
    '- criteria: 3–7 ACCEPTANCE CRITERIA = the VERIFY gate. Each is a CAPABILITY assertion (not a task)',
    '  that an independent reviewer can check against ground truth. Make them FALSIFIABLE — name the',
    '  regression test, the observable state, or the measured threshold. SEQUENCE by risk (each de-risks',
    '  the next). Make the LAST one a measured-outcome check ("did this actually work" over ≥N runs).',
    '- constraints: the LOCKED invariants that must not regress — each a one-line hard rule with its',
    '  reason. These become active constraints injected into every builder; keep them true and minimal.',
    '- rejectedAlternatives: design decisions whose losing options should not be re-proposed (title +',
    '  the rejected designs verbatim). Omit if none.',
    '- digest: ≤ ~2k tokens of ORIENTATION facts — where the subsystems live, the key seams, what is',
    '  vestigial. Headline facts only; every byte is a per-leaf tax. Omit if the doc is self-contained.',
    '',
    'Emit EXACTLY ONE JSON object as your FINAL reply (optionally in a ```json fence), nothing after it:',
    '{',
    '  "title": "<mission goal, bare — no role prefix>",',
    '  "description": "<one or two sentences>",',
    '  "criteria": ["<falsifiable capability assertion>", ...],',
    '  "constraints": [ { "rule": "<one-line hard rule>", "rationale": "<why>" } ],',
    '  "rejectedAlternatives": [ { "title": "<decision>", "rationale": "<why>", "alternatives": ["<killed design>"] } ],',
    '  "digest": "<orientation facts, or omit>"',
    '}',
  ].join('\n');
}

/** Extract the mission spec JSON from the node's final text, tolerant of a ```json fence or prose. */
export function parseForgeSpec(text: string): Pick<ForgeMissionInput, 'title' | 'description' | 'criteria' | 'constraints' | 'rejectedAlternatives' | 'digest'> {
  const t = (text ?? '').trim();
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  let jsonStr = fenced && fenced[1].includes('{') ? fenced[1] : t;
  if (!fenced) {
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first >= 0 && last > first) jsonStr = jsonStr.slice(first, last + 1);
  }
  let raw: any;
  try { raw = JSON.parse(jsonStr.trim()); } catch (e) {
    throw new Error(`forge node emitted no parseable mission-spec JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('forge node spec is not a JSON object');
  if (typeof raw.title !== 'string' || !raw.title.trim()) throw new Error('forge node spec is missing a title');
  if (!Array.isArray(raw.criteria) || raw.criteria.filter((c: unknown) => typeof c === 'string' && c.trim()).length === 0) {
    throw new Error('forge node spec has no criteria (the VERIFY gate)');
  }
  return {
    title: raw.title,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    criteria: raw.criteria.filter((c: unknown) => typeof c === 'string' && c.trim()),
    constraints: Array.isArray(raw.constraints) ? raw.constraints.filter((c: any) => c && typeof c.rule === 'string') : [],
    rejectedAlternatives: Array.isArray(raw.rejectedAlternatives) ? raw.rejectedAlternatives.filter((r: any) => r && typeof r.title === 'string' && Array.isArray(r.alternatives)) : [],
    digest: typeof raw.digest === 'string' ? raw.digest : undefined,
  };
}

export interface ForgeFromDocInput {
  session: string;
  /** The collab document id (the problem/design writeup) to forge from. */
  docId: string;
  /** Per-call model override (else node_profile_override['forge'] → opus). */
  model?: string;
  /** Per-call effort override (else node_profile_override['forge'] → high). */
  effort?: EffortLevel;
}

export interface ForgeFromDocDeps {
  /** Read a collab doc's content. Default resolves the session's documents dir. Injected in tests. */
  readDoc?: (project: string, session: string, docId: string) => Promise<string>;
  /** Spawn the forge node. Default = the real claude node invoker. Injected in tests. */
  invoke?: (spec: NodeSpec) => Promise<NodeResult>;
}

export interface ForgeFromDocResult extends ForgeMissionResult {
  spec: ReturnType<typeof parseForgeSpec>;
  modelUsed: string;
  effortUsed: EffortLevel;
}

async function defaultReadDoc(project: string, session: string, docId: string): Promise<string> {
  const { sessionRegistry } = await import('../../services/session-registry.js');
  const { DocumentManager } = await import('../../services/document-manager.js');
  await sessionRegistry.registerIfAbsent(project, session);
  const dir = sessionRegistry.resolvePath(project, session, 'documents');
  const dm = new DocumentManager(dir);
  await dm.initialize();
  const doc = await dm.getDocument(docId);
  if (!doc) throw new Error(`forge_mission_from_doc: document not found: ${docId} (session ${session})`);
  return doc.content;
}

/** Forge a mission FROM a collab doc via a server-side `forge` node (configurable model/effort like
 *  the other daemon nodes). The node reads the doc + surveys the repo and emits a structured spec,
 *  which forgeMission instantiates as an UNAPPROVED mission (inactive, constraints proposed) that
 *  sits in the list until a human runs approve_mission. Judgment is the node's; instantiation is
 *  machinery. */
export async function forgeMissionFromDoc(
  project: string,
  input: ForgeFromDocInput,
  deps: ForgeFromDocDeps = {},
): Promise<ForgeFromDocResult> {
  if (!project || !input.session || !input.docId) {
    throw new Error('forge_mission_from_doc: project, session, and docId are required');
  }
  const docContent = await (deps.readDoc ?? defaultReadDoc)(project, input.session, input.docId);
  if (!docContent || !docContent.trim()) throw new Error('forge_mission_from_doc: the source document is empty');

  const provider = resolveNodeProvider(project, 'forge', ORCHESTRATION_NODE_PROFILE.forge.allowedTools);
  const model = input.model ?? resolveNodeModel(project, 'forge', provider, ORCHESTRATION_NODE_PROFILE.forge.model);
  const effort: EffortLevel = input.effort ?? resolveOrchestrationEffort(project, 'forge');

  const res = await (deps.invoke ?? invokeNode)({
    prompt: buildForgePrompt(docContent),
    model,
    effort,
    allowedTools: ORCHESTRATION_NODE_PROFILE.forge.allowedTools,
    strictMcpConfig: true,
    permissionMode: 'bypassPermissions',
    cwd: project,
    project,
    transcriptLabel: 'forge',
  });
  if (!res.ok || !res.text || !res.text.trim()) {
    throw new Error(`forge_mission_from_doc: the forge node failed or returned no text${res.rateLimited ? ' (rate-limited)' : ''}`);
  }

  const spec = parseForgeSpec(res.text);
  const forged = await forgeMission(project, {
    session: input.session,
    ...spec,
    handoffDocId: input.docId, // the source doc IS the mission's constitution
    approved: false,           // UNAPPROVED: sits in the list, inactive, constraints proposed
    activate: false,
  });
  return { ...forged, spec, modelUsed: model, effortUsed: effort };
}
