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
 *   - the orientation digest  → .collab/mission-digests/<missionId>.md (payload A injects it into
 *                               blueprint nodes).
 *
 * missionConstitutionHealth is the enforcement teeth: a mission that carries a constitution (a
 * handoff doc) but has ZERO active constraint records linked to it never mechanized its rules —
 * flag it so the conductor/human sees that the constitution is stranded as prose.
 */
import { addSessionTodo } from './session-todos.js';
import {
  upsertMission,
  addCriterion,
  setMissionApproved,
  stampMissionNodeApproved,
  enqueueMission,
  projectHasActiveMission,
  getMission,
  listCriteria,
  getMissionRollup,
  assertMissionCreationAllowed,
  assertAllMissionCriteriaCitable,
  setMissionForgeState,
  deleteMission,
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
import { writeMissionDigest, readMissionDigest, formatConsumedFindingsSection } from '../../services/mission-digest.js';
import { getFindingByTodoId } from '../../services/finding-store.js';
import { stripLabel } from '../../services/todo-kind.js';
import { deriveTodoViews, updateTodo, removeTodo, type Todo } from '../../services/todo-store.js';
import { consumeBucketItems } from '../../services/bucket-consumption.js';
import { invokeNode, type NodeSpec, type NodeResult } from '../../agent/node-invoker.js';
import { recordSpend } from '../../services/spend-ledger.js';
import { detectForwardAccrual, toOneShot, ForwardAccrualCriterionError } from '../../services/criterion-closeability.js';
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
  /** Curated orientation facts (≤ ~2k tokens) → .collab/mission-digests/<missionId>.md. */
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
  /** Reuse an existing `createForgeShell` mission instead of minting a new node — the async-forge seam. */
  intoMissionId?: string;
  /** Inbox/bugfix bucket todo ids this mission's criteria address — marked consumed (done +
   *  promotedTo) on forge. */
  consumesTodoIds?: string[];
}

export interface ForgeMissionDeps {
  /** Override the criterion addition function for testing. Defaults to the live addCriterion. */
  addCriterion?: typeof addCriterion;
}

export interface ForgeMissionResult {
  node: ReturnType<typeof deriveTodoViews>[number];
  missionId: string;
  criteria: MissionCriterion[];
  constraints: DecisionRecord[];
  decisions: DecisionRecord[];
  digestWritten: boolean;
  rollup: MissionRollup;
  ratificationMessage: string;
  consumedBucketItems: Awaited<ReturnType<typeof consumeBucketItems>>;
}

export interface ForgeShellInput { session: string; docId: string; title?: string }
export interface ForgeShellResult { missionId: string; node: ReturnType<typeof deriveTodoViews>[number] }

export async function createForgeShell(project: string, input: ForgeShellInput): Promise<ForgeShellResult> {
  const { session, docId } = input;
  if (!project || !session || !docId) throw new Error('createForgeShell: project, session, and docId are required');
  assertMissionCreationAllowed(project);
  const placeholderTitle = stripLabel(input.title?.trim() || `Forging mission from doc ${docId}`);
  const node = await addSessionTodo(project, session, placeholderTitle, undefined, {
    kind: 'mission',
    assigneeSession: session,
  });
  const missionId = node.id;
  upsertMission(project, missionId, {
    handoffDocId: docId,
    awaitingApprovalSince: Date.now(),
    forgeState: 'forging',
  });
  enqueueMission(project, missionId);
  return { missionId, node: deriveTodoViews(project, [node as Todo])[0] };
}

/** Validate + atomically instantiate a mission and its full constitution. Throws on invalid input
 *  BEFORE creating anything (no half-forged mission). */
export async function forgeMission(
  project: string,
  input: ForgeMissionInput,
  deps: ForgeMissionDeps = {},
): Promise<ForgeMissionResult> {
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

  for (const c of criteria) {
    const hit = detectForwardAccrual(c);
    if (hit) throw new ForwardAccrualCriterionError(c, hit.matched);
  }

  assertAllMissionCriteriaCitable(criteria);

  if (!input.intoMissionId) assertMissionCreationAllowed(project);

  // 1. Mission node + row + criteria (same core as create_mission).
  const approved = input.approved ?? true;
  let node: Todo;
  let missionId: string;
  if (input.intoMissionId) {
    missionId = input.intoMissionId;
    if (!getMission(project, missionId)) throw new Error(`forge_mission: intoMissionId not found: ${missionId}`);
    node = await updateTodo(project, missionId, { title: missionTitle, description: input.description });
  } else {
    node = await addSessionTodo(project, session, missionTitle, undefined, {
      kind: 'mission',
      assigneeSession: session,
      description: input.description,
    });
    missionId = node.id;
    upsertMission(project, missionId, {
      budgetUsd: input.budgetUsd ?? null,
      handoffDocId: input.handoffDocId ?? null,
      awaitingApprovalSince: approved ? null : Date.now(),
    });
  }
  if (approved) stampMissionNodeApproved(project, missionId, session);
  const activate = (input.activate ?? true) && approved; // an unapproved mission is never the active driven one
  // One-active-per-project: never steal focus unless explicitly told to activate.
  if (!activate || projectHasActiveMission(project, missionId)) {
    enqueueMission(project, missionId);
  }

  try {
    const addCriterionFn = deps.addCriterion ?? addCriterion;
    for (const c of criteria) addCriterionFn(project, missionId, c);

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

    // 4. Orientation digest → .collab/mission-digests/<missionId>.md (payload A). Curated text,
    //    written verbatim. Compose with findings section from consumed bucket items.
    const consumedBucketItems = await consumeBucketItems(project, input.consumesTodoIds ?? [], { id: missionId, kind: 'mission' });

    let digestWritten = false;
    const findings = [];
    for (const id of consumedBucketItems.consumed) {
      const f = await getFindingByTodoId(project, id);
      if (f) findings.push(f);
    }
    const baseDigest = input.digest?.trim()
      || (!input.digest && input.intoMissionId ? readMissionDigest(project, missionId) ?? '' : '');
    const findingsSection = formatConsumedFindingsSection(findings);
    const composed = [baseDigest, findingsSection].filter((s) => s && s.length > 0).join('\n\n');
    if (composed) {
      writeMissionDigest(project, missionId, composed);
      digestWritten = true;
    }

    if (input.intoMissionId) setMissionForgeState(project, missionId, null);

    return {
      node: deriveTodoViews(project, [node as Todo])[0],
      missionId,
      criteria: listCriteria(project, missionId),
      constraints: constraintRecs,
      decisions: decisionRecs,
      digestWritten,
      rollup: getMissionRollup(project, missionId),
      ratificationMessage: approved ? `forged APPROVED (self-ratified by ${session})` : 'awaiting approval',
      consumedBucketItems,
    };
  } catch (err) {
    // Compensate for a fresh mission created at line 170-181: delete the mission row
    // and the todo node. Do NOT compensate if intoMissionId was supplied (the mission
    // existed before this call and must survive).
    if (!input.intoMissionId) {
      try {
        deleteMission(project, missionId);
      } catch {
        // Swallow: mission row may not exist if the throw happened before line 176.
      }
      try {
        await removeTodo(project, missionId);
      } catch {
        // Swallow: todo node may not exist in exceptional cases.
      }
    }
    throw err;
  }
}

export interface MissionConstitutionHealth {
  missionId: string;
  hasHandoff: boolean;
  linkedActiveConstraints: number;
  linkedProposedConstraints: number;
  /** Active PROJECT-LEVEL constraints (epicId null). These inject into every build node via payload C
   *  regardless of mission linkage, so they DO reach this mission's builders — credited toward 'ok'. */
  projectActiveConstraints: number;
  /** 'ok' — constraints are active and reaching the builders (mission-linked OR project-level), or
   *    there is no constitution to enforce.
   *  'constitution-pending-approval' — the rules exist as PROPOSED records but await a human nod
   *    (the normal doc→node state before approve_mission).
   *  'constitution-not-injected' — a mission with a handoff but ZERO active/proposed constraint records
   *    (linked or project-level): its locked rules were left as prose the builder never sees. */
  flag: 'ok' | 'constitution-pending-approval' | 'constitution-not-injected';
}

/** Enforcement teeth: detect a mission whose constitution never reached the builders. forge_mission
 *  links the records to the mission, so a forged+approved mission is healthy by construction; this
 *  catches the hand-rolled / step-6-skipped path ('not-injected') and the forged-but-unratified state
 *  ('pending-approval'). Project-level active constraints (epicId null) are ALSO credited: payload C
 *  injects them into every build node whether or not they carry this mission's linkedTodos, so the
 *  hand-rolled project-level pattern the mission-forge skill teaches is no longer a false 'not-injected'.
 *  (Advisory tradeoff: an unrelated project-level active constraint can mask a genuinely-unlinked
 *  mission — acceptable for an advisory flag, and the linked* counts stay visible for precision.) */
export function missionConstitutionHealth(project: string, missionId: string): MissionConstitutionHealth {
  const mission = getMission(project, missionId);
  const hasHandoff = mission?.handoffDocId != null;
  let linkedActiveConstraints = 0;
  let linkedProposedConstraints = 0;
  let projectActiveConstraints = 0;
  try {
    const active = listDecisionRecords(project, { kind: 'constraint', status: 'active' });
    linkedActiveConstraints = active.filter((r) => r.linkedTodos.includes(missionId)).length;
    projectActiveConstraints = active.filter((r) => r.epicId == null).length;
    linkedProposedConstraints = listDecisionRecords(project, { kind: 'constraint', status: 'proposed' })
      .filter((r) => r.linkedTodos.includes(missionId)).length;
  } catch {
    // advisory health read — a store failure must never break the caller (mission rollup / conductor).
  }
  const injecting = linkedActiveConstraints > 0 || projectActiveConstraints > 0;
  const flag: MissionConstitutionHealth['flag'] =
    injecting || !hasHandoff ? 'ok'
    : linkedProposedConstraints > 0 ? 'constitution-pending-approval'
    : 'constitution-not-injected';
  return { missionId, hasHandoff, linkedActiveConstraints, linkedProposedConstraints, projectActiveConstraints, flag };
}

export interface ApproveMissionResult {
  mission: MissionRow;
  approvedConstraints: DecisionRecord[];
}

/** Approve a forged (unapproved) mission AND ratify its constitution: clear the mission's
 *  awaitingApprovalSince (→ leaves 'unapproved', becomes active/driveable) and flip its PROPOSED
 *  linked constraint records to active so they inject into the builders (payload C). Idempotent. */
export async function approveMissionAndConstitution(project: string, missionId: string, approvedBy: string): Promise<ApproveMissionResult> {
  const mission = setMissionApproved(project, missionId, approvedBy);
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
 *  capability assertions on TWO independent axes — weakest assertion, strongest check — sequenced by
 *  risk, one measured-outcome last; constraints = hard rules;
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
    '  regression test, the observable state, or the measured threshold.',
    '  WHAT it asserts and HOW it is checked are INDEPENDENT axes — max BOTH, never trade one off:',
    '    * WEAKEST assertion: assert the observable BEHAVIOUR, admitting every implementation that',
    '      produces it. Naming a function/call-site/file as the requirement is a CITABILITY WALL — it',
    '      fails work that solved the problem another way. Weakest, NOT shortest: a long criterion that',
    '      admits many implementations beats a terse one that admits one.',
    '    * STRONGEST check: the named observation must FAIL on a broken build. A check that passes',
    '      either way is a vacuous falsifier and grades nothing.',
    '  The trap: reaching for falsifiability by specifying the implementation. "X no longer happens,',
    '  proven by test T" is right; "module M calls guard G before every write" is the same intent',
    '  authored as a wall. SEQUENCE by risk (each de-risks',
    '  the next). Every criterion must be closeable by a SINGLE observation at a point in time — name',
    '  the test, state, or measured value on a recorded sample. Do NOT emit a criterion asserting',
    '  accrual over future passes/events/missions (e.g. "holds over ≥N runs", "continues to X") — the',
    '  machinery rejects those.',
    '- constraints: the LOCKED invariants that must not regress — each a one-line hard rule with its',
    '  reason. These become active constraints injected into every builder; keep them true and minimal.',
    '- rejectedAlternatives: design decisions whose losing options should not be re-proposed (title +',
    '  the rejected designs verbatim). Omit if none.',
    '- digest: ≤ ~2k tokens of ORIENTATION facts — where the subsystems live, the key seams, what is',
    '  vestigial. Headline facts only; every byte is a per-leaf tax. Omit if the doc is self-contained.',
    '- consumes: inbox/bugfix bucket todo ids this mission\'s criteria address, if any. Omit if none.',
    '',
    'Emit EXACTLY ONE JSON object as your FINAL reply (optionally in a ```json fence), nothing after it:',
    '{',
    '  "title": "<mission goal, bare — no role prefix>",',
    '  "description": "<one or two sentences>",',
    '  "criteria": ["<falsifiable capability assertion>", ...],',
    '  "constraints": [ { "rule": "<one-line hard rule>", "rationale": "<why>" } ],',
    '  "rejectedAlternatives": [ { "title": "<decision>", "rationale": "<why>", "alternatives": ["<killed design>"] } ],',
    '  "digest": "<orientation facts, or omit>",',
    '  "consumes": ["<bucket todo id>"]',
    '}',
  ].join('\n');
}

/** Extract the mission spec JSON from the node's final text, tolerant of a ```json fence or prose. */
export function parseForgeSpec(text: string): Pick<ForgeMissionInput, 'title' | 'description' | 'criteria' | 'constraints' | 'rejectedAlternatives' | 'digest' | 'consumesTodoIds'> {
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
  const criteria = raw.criteria
    .filter((c: unknown) => typeof c === 'string' && c.trim())
    .map((c: string) => {
      const rewritten = toOneShot(c);
      const hit = detectForwardAccrual(rewritten);
      if (hit) throw new ForwardAccrualCriterionError(rewritten, hit.matched);
      return rewritten;
    });
  return {
    title: raw.title,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    criteria,
    constraints: Array.isArray(raw.constraints) ? raw.constraints.filter((c: any) => c && typeof c.rule === 'string') : [],
    rejectedAlternatives: Array.isArray(raw.rejectedAlternatives) ? raw.rejectedAlternatives.filter((r: any) => r && typeof r.title === 'string' && Array.isArray(r.alternatives)) : [],
    digest: typeof raw.digest === 'string' ? raw.digest : undefined,
    consumesTodoIds: Array.isArray(raw.consumes) ? raw.consumes.filter((c: unknown) => typeof c === 'string' && c.trim()) : undefined,
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

export interface ForgeFromDocAck {
  missionId: string;
  jobId: string;
  status: 'forging';
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

/** Validate inputs and set up the forge shell + background job. Returns missionId, jobId, and
 *  the document content for the continuation to use. Throws if doc is missing/empty (no half-started job). */
async function startForge(
  project: string,
  input: ForgeFromDocInput,
  deps: ForgeFromDocDeps = {},
): Promise<{ missionId: string; jobId: string; docContent: string }> {
  if (!project || !input.session || !input.docId) {
    throw new Error('forge_mission_from_doc: project, session, and docId are required');
  }
  const docContent = await (deps.readDoc ?? defaultReadDoc)(project, input.session, input.docId);
  if (!docContent || !docContent.trim()) throw new Error('forge_mission_from_doc: the source document is empty');

  const shell = await createForgeShell(project, { session: input.session, docId: input.docId });
  const { createJob, markJobRunning } = await import('../../services/async-job-store.js');
  const job = createJob(project, { kind: 'forge-mission', targetId: shell.missionId });
  markJobRunning(project, job.id);

  return { missionId: shell.missionId, jobId: job.id, docContent };
}

/** The forge continuation: invoke → parse → forgeMission → recordSpend. On any error, marks the
 *  mission forge-failed, marks the job failed, raises an escalation, and re-throws. On success,
 *  marks the job succeeded and returns the complete result. */
async function runForgeContinuation(
  project: string,
  input: ForgeFromDocInput,
  missionId: string,
  jobId: string,
  deps: ForgeFromDocDeps = {},
  docContent: string,
): Promise<ForgeFromDocResult> {
  let spec: ReturnType<typeof parseForgeSpec> | undefined;
  let forged: ForgeMissionResult | undefined;
  let model: string = '';
  let effort: EffortLevel = 'high';

  try {
    const provider = resolveNodeProvider(project, 'forge', ORCHESTRATION_NODE_PROFILE.forge.allowedTools);
    model = input.model ?? resolveNodeModel(project, 'forge', provider, ORCHESTRATION_NODE_PROFILE.forge.model);
    effort = input.effort ?? resolveOrchestrationEffort(project, 'forge');

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
      skipAutoLedger: true,
      ledgerSource: 'forge',
    });
    if (!res.ok || !res.text || !res.text.trim()) {
      throw new Error(`forge_mission_from_doc: the forge node failed or returned no text${res.rateLimited ? ' (rate-limited)' : ''}`);
    }

    spec = parseForgeSpec(res.text);
    forged = await forgeMission(project, {
      session: input.session,
      ...spec,
      handoffDocId: input.docId,
      approved: false,
      activate: false,
      intoMissionId: missionId,
    });
  } catch (err) {
    await failForge(project, missionId, jobId, input.docId, err, input.session);
    throw err;
  } finally {
    recordSpend({
      project,
      source: 'forge',
      nodeKind: 'forge',
      session: input.session,
      todoId: forged?.missionId ?? missionId,
      model,
      usage: forged ? undefined : {},
      durationMs: 0,
      rateLimited: false,
      ok: !!forged,
    });
  }

  const { markJobSucceeded } = await import('../../services/async-job-store.js');
  markJobSucceeded(project, jobId, JSON.stringify({ missionId }));
  return { ...forged!, spec: spec!, modelUsed: model, effortUsed: effort };
}

/** On forge failure: mark the mission forge-failed, mark the job failed, and raise an escalation. */
async function failForge(
  project: string,
  missionId: string,
  jobId: string,
  docId: string,
  err: unknown,
  session: string,
): Promise<void> {
  const { markJobFailed } = await import('../../services/async-job-store.js');
  const message = err instanceof Error ? err.message : String(err);

  setMissionForgeState(project, missionId, 'forge-failed');
  markJobFailed(project, jobId, message);

  try {
    const { createEscalation } = await import('../../services/supervisor-store.js');
    createEscalation({
      project,
      session,
      kind: 'mission-forge-failed',
      questionText: `Forge mission from doc ${docId} failed: ${message}`,
      audience: 'human',
      todoId: missionId,
      conditionKey: `forge-failed:${missionId}`,
    });
  } catch (escalationErr) {
    console.error('failForge: escalation creation failed:', escalationErr instanceof Error ? escalationErr.message : String(escalationErr));
  }
}

/** Forge a mission FROM a collab doc via a server-side `forge` node (configurable model/effort like
 *  the other daemon nodes). Acks IMMEDIATELY with {missionId, jobId, status:'forging'}; the node
 *  reads the doc + surveys the repo and emits a structured spec, which forgeMission instantiates
 *  as an UNAPPROVED mission (inactive, constraints proposed) that sits in the list until a human
 *  runs approve_mission. Judgment is the node's; instantiation is machinery. Poll the jobId via
 *  async-job-store or watch the mission's status to learn the outcome. */
export async function forgeMissionFromDoc(
  project: string,
  input: ForgeFromDocInput,
  deps: ForgeFromDocDeps = {},
): Promise<ForgeFromDocAck> {
  const { missionId, jobId, docContent } = await startForge(project, input, deps);
  void runForgeContinuation(project, input, missionId, jobId, deps, docContent).catch(() => {});
  return { missionId, jobId, status: 'forging' };
}

/** Deterministic awaited variant for tests and internal callers. Same as forgeMissionFromDoc but
 *  awaits the background continuation. */
export async function forgeMissionFromDocAndWait(
  project: string,
  input: ForgeFromDocInput,
  deps: ForgeFromDocDeps = {},
): Promise<ForgeFromDocResult> {
  const { missionId, jobId, docContent } = await startForge(project, input, deps);
  return runForgeContinuation(project, input, missionId, jobId, deps, docContent);
}
