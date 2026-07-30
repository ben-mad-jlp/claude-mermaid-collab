/**
 * conductor-pass — the AUTONOMOUS CONDUCTOR (Phase 2). A per-tick, per-project pass that spawns a
 * conductor NODE to drive the project's approved+active mission toward convergence, based on the
 * /conductor skill. The pass is thin SCHEDULING (toggle + find mission + debounce + spawn); the NODE
 * is the intelligence (reads the mission, serves gaps, runs VERIFY, LANDS a converged mission) via
 * its MCP tools. Decisions (docs/autonomous-conductor.md): per-tick node (not a session), triggered
 * on the orchestrator tick + event nudges, DEBOUNCED by a status/criteria fingerprint so a tick with
 * no material change spends nothing, the conductor LANDS (only on converged+verify-green), per-project
 * toggle (default OFF — opt-in autonomy).
 */
import { getConductorEnabled, listOpenEscalations, listEscalationsResolvedSince, setConductorLastPass, createEscalation, reopenResolvedEscalationByConditionKey } from './supervisor-store.js';
import {
  listMissions,
  getMission,
  listCriteriaWithActions,
  stampConductorRun,
  stampConductorTimeout,
  readConductorTimeoutRecurrence,
  CRITERION_SERVE_CAP,
  promoteQueuedMissions,
  type MissionRecheck,
} from './mission-store.js';
import { CONDUCTOR_SERVE_RETRY_CAP, CONDUCTOR_NODE_TIMEOUT_MS, CONDUCTOR_TIMEOUT_RECUR_CAP } from './harness-caps.js';
import { raiseOverBudgetRebetCard } from './mission-budget-gate.js';
import { runInfraRejectionArm, classifyInfraRejection, defaultEpicBaseProbe, type EpicBaseProbe, type InfraArmResult } from './conductor-infra-arm.js';
import { runRedecomposeArm, type RedecomposeArmResult } from './conductor-redecompose-arm.js';
import { runTestOnlyCloseArm } from './conductor-test-only-close-arm.js';
import { runVerifyPanelArm, type VerifyPanelArmResult } from './conductor-verify-panel-arm.js';
import { runCardTriageArm, type CardTriageArmResult } from './conductor-card-triage-arm.js';
import { drainMissionRechecks } from './mission-recheck-drain.js';
import { listTodos } from './todo-store.js';
import { syncMissionSubscription } from './mission-subscription.js';
import { getOrchestratorLevel } from './orchestrator-config.js';
import { resolveNodeModel, resolveNodeProvider, resolveOrchestrationEffort } from './node-provider.js';
import { invokeNode, mcpConfigFor, isTransientNodeFault, type NodeSpec, type NodeResult } from '../agent/node-invoker.js';
import { config } from '../config.js';
import type { EffortLevel } from '../agent/contracts.js';
import { ORCHESTRATION_NODE_PROFILE } from './node-kinds.js';
import { listApproachAttempts, ladderExhausted, type ApproachAttempt } from './criterion-approach-store.js';
import { summariseEpicOutcomes } from './epic-churn.js';
import { listLeafRuns } from './ledger-stats.js';
import { openPassRow, appendPassProgress, finalizePassRow } from './conductor-pass-journal.js';

/** The conductor node DIRECTS the work-graph — it never hand-edits source. Read/Grep/Glob/Bash to
 *  ground; the mermaid MCP tools to serve criteria (create_epic/add_leaves), record VERIFY verdicts
 *  (set_mission_criterion), check readiness and LAND (epic_land_readiness/land_epic). */
export const CONDUCTOR_ALLOWED_TOOLS = ORCHESTRATION_NODE_PROFILE.conductor.allowedTools;

import { buildServeSignature, buildPassSignature, collectMissionCardIds, conductorFingerprint } from './conductor-signature.js';
export { conductorFingerprint, type ConductorActionRow } from './conductor-signature.js';
import { buildWakeContextBlock, type WakeContextInput } from './conductor-wake-context.js';
import { collectVerifyStakesInput } from './criterion-verify-facts.js';
import { classifyVerifyStakes } from './criterion-verify-stakes.js';
import { todoServesCriterion } from './criterion-edges.js';
export { buildWakeContextBlock, WAKE_CARD_RENDER_CAP, WAKE_CARD_EXCERPT_CHARS } from './conductor-wake-context.js';

/** The kind stamped on a serve-cap escalation. One OPEN card per (mission, criterion) at a
 *  time — the debounce below skips creating a second while one is still open. */
export const CRITERION_SERVE_CAP_KIND = 'criterion-serve-cap';

// CONDUCTOR_SERVE_RETRY_CAP moved to harness-caps.ts (the harness's single loop-breaker
// cap surface); imported above and re-exported here so existing importers (tests) keep
// working unchanged.
export { CONDUCTOR_SERVE_RETRY_CAP };

/** Debounce marker embedded in the escalation questionText so listOpenEscalations can be
 *  matched back to an exact (mission, criterion) even though the card carries only todoId
 *  (=missionId) and free text. Stable + greppable. */
export function serveCapMarker(criterionId: string): string {
  return `[serve-cap:${criterionId}]`;
}

/** The mission id plus every todo in its transitive descendant tree (any status — a card hanging
 *  off a done/dropped descendant is still live escalation state and must move the signature,
 *  unlike collectInfraRejectedLeaves which skips terminal epics because it re-dispatches work).
 *  One listTodos call; fail-open to just the mission id on a store throw. */
export function collectMissionTodoIds(project: string, missionId: string): Set<string> {
  try {
    const all = listTodos(project, { includeCompleted: true });
    const childrenByParent = new Map<string, string[]>();
    for (const t of all) {
      if (t.parentId == null) continue;
      const siblings = childrenByParent.get(t.parentId);
      if (siblings) siblings.push(t.id);
      else childrenByParent.set(t.parentId, [t.id]);
    }
    const ids = new Set<string>([missionId]);
    const stack = [missionId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const childId of childrenByParent.get(cur) ?? []) {
        if (ids.has(childId)) continue; // cyclic/self parent-edge guard
        ids.add(childId);
        stack.push(childId);
      }
    }
    return ids;
  } catch {
    return new Set([missionId]);
  }
}

/** The store's durable identity for a criterion-serve-cap card: one per criterion. Used as
 *  `conditionKey` so an open card is bumped instead of re-raised (supervisor-store.ts
 *  createEscalation :824-842), and a resolved card is REOPENED (not left suppressed) via
 *  `reopenResolvedEscalationByConditionKey` when the criterion is still capped+unmet. */
export function serveCapConditionKey(criterionId: string): string {
  return `serve-cap:${criterionId}`;
}

/** Build serve-cap diagnosis: a pure renderer that emits REASONS SEEN, LADDER, and RECOMMEND blocks.
 *  Pure — no DB, no clock. */
export function buildServeCapDiagnosis(input: {
  criterionText: string;
  servedEpicCount: number;
  attempts: ApproachAttempt[];
  distinctReasons: string[];
  verdict?: { evidence: string | null; verifiedAt: number | null; verifiedAtSha: string | null };
  newestReasonAt?: number;
  exhaustedBy?: 're-decompose' | 'serve-cap' | 'store-fault';
}): string {
  // REASONS SEEN block: up to 5 reasons, each max 200 chars
  const slicedReasons = input.distinctReasons.slice(0, 5);
  const reasonsBlock = slicedReasons.length > 0
    ? slicedReasons.map((r) => `- ${r.substring(0, 200)}`).join('\n')
    : '- (none recorded)';

  const verdictWins = input.verdict?.verifiedAt != null
    && input.verdict.verifiedAt > (input.newestReasonAt ?? -Infinity);
  const historicalHeader = verdictWins ? 'EARLIER ATTEMPTS (REASONS SEEN)' : 'REASONS SEEN';

  // LADDER block: three rungs in order
  const ladderOrder: Array<'fresh-blueprint' | 'tier-bump' | 're-decompose'> = ['fresh-blueprint', 'tier-bump', 're-decompose'];
  const attemptsByRung = new Map<string, ApproachAttempt>();
  for (const attempt of input.attempts) {
    if (!attemptsByRung.has(attempt.rung) || attempt.attemptedAt > attemptsByRung.get(attempt.rung)!.attemptedAt) {
      attemptsByRung.set(attempt.rung, attempt);
    }
  }

  const ladderLines = ladderOrder.map((rung) => {
    const attempt = attemptsByRung.get(rung);
    if (!attempt) {
      return `${rung} — not recorded`;
    }
    const detail = attempt.detail ? `, ${attempt.detail}` : (attempt.epicId ? `, epic ${attempt.epicId}` : '');
    return `${rung} — ${attempt.outcome}${detail}`;
  });

  // RECOMMEND line based on what rungs are present
  const presentRungs = ladderOrder.filter((rung) => attemptsByRung.has(rung));
  const missingRungs = ladderOrder.filter((rung) => !attemptsByRung.has(rung));

  let recommendLine = '';
  if (presentRungs.length === ladderOrder.length && input.distinctReasons.length === 1) {
    recommendLine = `RECOMMEND: the criterion likely needs a human action / rescope: ${input.distinctReasons[0]}`;
  } else if (presentRungs.length === ladderOrder.length) {
    recommendLine = 'RECOMMEND: all ladder rungs ran and the criterion is still unmet — human rescope';
  } else if (input.exhaustedBy === 'serve-cap') {
    recommendLine = `RECOMMEND: criterion hit the serve cap (${CRITERION_SERVE_CAP}) with ${input.servedEpicCount} serving epics — human rescope`;
  } else if (input.exhaustedBy === 'store-fault') {
    recommendLine = 'RECOMMEND: the approach-attempt store could not be read — exhaustion could not be established; human rescope';
  } else {
    recommendLine = `RECOMMEND: ladder incomplete — ${missingRungs.join(', ')} never ran; investigate the rung owner`;
  }

  const verdictBlock = verdictWins
    ? [
        'CURRENT VERDICT',
        `sha ${input.verdict!.verifiedAtSha}`,
        input.verdict!.evidence ?? '(no evidence recorded)',
        '',
      ]
    : [];

  return [
    ...verdictBlock,
    historicalHeader,
    reasonsBlock,
    '',
    'LADDER',
    ...ladderLines,
    '',
    recommendLine,
  ].join('\n');
}

/** Build the conductor NODE prompt: a self-contained distillation of the /conductor skill for ONE
 *  pass against ONE mission. References nothing in skills/.
 *
 *  `wakeBlock` is the pre-rendered WAKE CONTEXT (conductor-wake-context.ts) — the cards and deltas
 *  that CAUSED this pass, handed to the node as DATA. It goes at the TOP, before the steps, because
 *  the thing that kicked the conductor must be in the conductor's context. Omitted/empty ⇒ the
 *  prompt is byte-identical to the pre-injection one (the fail-open path). */
export function buildConductorPrompt(project: string, missionId: string, missionTitle: string, session: string, wakeBlock?: string): string {
  const wake = wakeBlock && wakeBlock.trim().length > 0 ? [wakeBlock, ''] : [];
  return [
    ...wake,
    `You are the MISSION CONDUCTOR for project ${project}, driving mission ${missionId} ("${missionTitle}")`,
    `as conductor session "${session}". You DIRECT the work-graph and the build daemon — you NEVER`,
    'hand-edit source (no Edit/Write to product code). Do EXACTLY ONE focused pass, then stop.',
    '',
    'Steps this pass:',
    '1. `mcp__mermaid__get_mission` for the mission. Read each criterion\'s DERIVED `action`',
    '   (met | building | verify | discover) — that is your work list.',
    '2. For criteria with action `discover` (no live serving epic): GROUND them first (Read/Grep the',
    '   real code to confirm the gaps are real and not already built), then DELEGATE planning to the',
    '   specialist — `mcp__mermaid__plan_mission_criterion` with the `criterionIds` for ONE right-sized',
    '   epic (group related criteria into one epic; call it once per distinct epic). The planner',
    '   decomposes them into an epic + leaves and promotes them to ready for the daemon. Do NOT plan',
    '   the leaves or build them yourself.',
    '3. Criteria with action `verify` are auto-checked by the deterministic verify panel arm',
    '   BEFORE this pass ever runs (1 lens low-stakes, 3 distinct-model lenses high-stakes), and',
    '   recorded via `set_mission_criterion` already. A criterion still showing action `verify`',
    '   here means that auto-run was inconclusive (an infra-degraded run, or an unchanged-sha',
    '   skip) — it needs no action from you and retries next pass.',
    '4. Criteria with action `building` are in flight — leave them; the daemon is on it. BUT there is no',
    '   longer an AI steward auto-answering escalations — YOU are the authority for stuck work. This',
    '   mission\'s OPEN CARDS ARE LISTED ABOVE in WAKE CONTEXT — act on them; do not go looking for them.',
    '   (`mcp__mermaid__escalation_list` is still available for the untruncated text of a card, for cards',
    '   beyond the render cap, or for other projects — but the list above is the mission\'s work.) For each',
    '   carded todo, call `mcp__mermaid__leaf_inspect` { todoId } and read',
    '   `attempts` — how many times that leaf has re-run (EVERY attempt re-pays an expensive blueprint;',
    '   a todo failing the same way over and over is burn, not progress). Read `parseError`/`reason` for',
    '   WHY it failed. Then DECIDE — never let a todo silently re-blueprint attempt after attempt:',
    '     • Fixable spec/constraint → tighten it (`plan_mission_criterion` to re-plan, or correct a bad',
    '       ACTIVE CONSTRAINT) so the next build can actually pass.',
    '     • Genuinely handled → `mcp__mermaid__escalation_resolve` to close the stale card.',
    '5. LANDING (you LAND — this is autonomous): when a serving epic is build-green and VERIFY-green,',
    '   the reconcile pass surfaces an OPEN `epic-ready-to-land` escalation for it. Find it via',
    '   `mcp__mermaid__escalation_list`, confirm with `mcp__mermaid__epic_land_readiness` (green',
    `   mechanical + deps satisfied), then \`mcp__mermaid__land_epic\` with { escalationId, actor:`,
    `   "conductor", session: "${session}" } — the ownership gate authorizes you to land only YOUR`,
    '   mission\'s epics (never a bucket root or a foreign mission). Never land on a bare tick or an',
    '   unverified change; a red proof / conflict leaves master untouched.',
    '',
    'Serve EVERY open `discover`/`verify` gap you find in THIS pass (don\'t stop at one). If nothing is',
    'actionable (all building, or converged), say so and stop — do not invent work. Keep the mission\'s',
    'ACTIVE CONSTRAINTS (injected into your builders) intact; do not re-litigate locked decisions.',
  ].join('\n');
}

export interface ConductorPassDeps {
  invoke?: (spec: NodeSpec) => Promise<NodeResult>;
  /** Injectable for the serve-cap escalation (test spy). Defaults to the store fns. */
  createEscalation?: typeof createEscalation;
  listOpenEscalations?: typeof listOpenEscalations;
  /** Injectable resolved-card reopen (test spy). Defaults to the store fn. */
  reopenResolvedEscalation?: typeof reopenResolvedEscalationByConditionKey;
  /** Injectable resolved-card read for the WAKE CONTEXT block. Defaults to the store fn. */
  listEscalationsResolvedSince?: typeof listEscalationsResolvedSince;
  /** Injectable WAKE CONTEXT renderer (test seam for the fail-open path). Defaults to the pure
   *  buildWakeContextBlock. A throw here must degrade to a prompt WITHOUT the block. */
  buildWakeBlock?: (input: WakeContextInput) => string;
  /** Injectable INFRA stuck-work arm (test spy). Defaults to runInfraRejectionArm. */
  infraArm?: typeof runInfraRejectionArm;
  /** Injectable re-decompose churn-breaking arm (test spy). Defaults to runRedecomposeArm. */
  redecomposeArm?: typeof runRedecomposeArm;
  /** Injectable test-only close-out arm (test spy). Defaults to runTestOnlyCloseArm. */
  closeArm?: typeof runTestOnlyCloseArm;
  /** Injectable verify-panel auto-fire arm (test spy). Defaults to runVerifyPanelArm. */
  verifyPanelArm?: typeof runVerifyPanelArm;
  /** Injectable card-triage arm (test spy). Defaults to runCardTriageArm. */
  cardTriageArm?: typeof runCardTriageArm;
  /** Injected base re-probe, forwarded into the default arm so tests stay hermetic (no git/gate). */
  epicBaseProbe?: EpicBaseProbe;
  /** Injectable approach attempts read for the serve-cap diagnosis. Defaults to the store fn. */
  listApproachAttempts?: typeof listApproachAttempts;
  /** Injectable leaf runs read for the serve-cap diagnosis. Defaults to the store fn. */
  listLeafRuns?: typeof listLeafRuns;
  /** Injectable todo list read for the serve-cap diagnosis. Defaults to the store fn. */
  listTodos?: typeof listTodos;
}

export interface ConductorPassResult {
  ran: boolean;
  reason: 'conductor-disabled' | 'daemon-off' | 'no-actionable-mission' | 'target-not-actionable' | 'target-cleared' | 'building-wait' | 'criteria-escalated' | 'debounced' | 'conducted' | 'node-failed' | 'infra-leaf-reset' | 'redecomposed' | 'over-budget-rebet' | 'pass-ran' | 'pass-error' | 'verify-paneled' | 'card-triaged' | 'conductor-timeouts-capped';
  /** How many serve-cap escalations this pass raised (0 unless a criterion hit the cap). */
  escalationsRaised?: number;
  /** Criteria at the cap whose ladder is not yet exhausted, so no card was raised this pass. */
  serveCapDeferred?: number;
  /** INFRA-rejected leaves un-parked this pass (their base re-probed green). */
  infraResets?: number;
  /** INFRA-rejection human cards raised this pass (probe could not prove green). */
  infraCards?: number;
  /** Criteria re-decomposed this pass (dropped churning epics and re-planned with tighter hints). */
  redecomposed?: number;
  /** Test-only close-out leaves minted this pass (capped criterion, test-only verdict). */
  closeOutsMinted?: number;
  /** Criteria with high-stakes verify panel run this pass, verdict met. */
  verifyPaneled?: number;
  /** Criteria with high-stakes verify panel run this pass, verdict not met. */
  verifyHeld?: number;
  /** mission_recheck rows GC'd this pass. */
  rechecksDrained?: number;
  /** Leaves parked this pass by the card-triage arm — deterministic, zero node spend. */
  cardsParked?: number;
  missionId?: string;
  modelUsed?: string;
}

/** The SETTLED conductor-pass reasons that mean the mission is stuck on a HUMAN — the pass
 *  produced a "— needs you" status line (see conductorStatusLine) but has no more autonomous
 *  move to make. These are the reasons whose status ends in "needs you": a capped criterion
 *  ladder that's exhausted (`criteria-escalated`) and a mission that blew its rebet budget
 *  (`over-budget-rebet`). The Bridge keys the RED project-card / "needs you" signal off this so
 *  a needs-you conductor status can never sit next to a green card (the serve-cap card is
 *  reopened via reopenResolvedEscalationByConditionKey when the criterion is still capped+unmet,
 *  so it always backs a needs-you status). Single source of truth, shared by conductorStatusLine
 *  and the /conductor-running route. */
export function conductorNeedsHuman(reason: ConductorPassResult['reason'] | null | undefined): boolean {
  return reason === 'criteria-escalated' || reason === 'over-budget-rebet';
}

/** SHORT (<=60 char) human status line for a SETTLED conductor pass — what the pass DID this run,
 *  for the Bridge last-pass readout (so a stopped-looking conductor still says WHY). Pure; the unit
 *  test covers every reason value. Set at the end of each pass in runConductorPass. */
export function conductorStatusLine(
  reason: ConductorPassResult['reason'],
  counts: Pick<ConductorPassResult, 'escalationsRaised' | 'serveCapDeferred' | 'infraResets' | 'infraCards' | 'redecomposed' | 'cardsParked'> = {},
): string {
  const n = (x?: number): number => x ?? 0;
  // Plain-language status shown in the Bridge conductor line. Keep these HUMAN-READABLE — an
  // operator who has never read the code should understand each one. (Display only; nothing keys
  // off the string — the debounce/ownership logic keys off `reason`.)
  switch (reason) {
    case 'conducted': {
      const extra: string[] = [];
      if (n(counts.escalationsRaised)) extra.push(`${n(counts.escalationsRaised)} raised for you`);
      if (n(counts.infraResets)) extra.push(`${n(counts.infraResets)} unblocked`);
      if (n(counts.redecomposed)) extra.push(`${n(counts.redecomposed)} re-planned`);
      return extra.length ? `assigned work · ${extra.join(', ')}` : 'assigned new work';
    }
    case 'debounced': return 'idle — nothing to do';
    case 'building-wait': return 'building — waiting on work';
    case 'criteria-escalated': return n(counts.serveCapDeferred) ? `${n(counts.serveCapDeferred)} stuck — needs you` : 'stuck — needs you';
    case 'redecomposed': return 're-planned an epic';
    case 'over-budget-rebet': return 'over budget — needs you';
    case 'node-failed': return 'hit an error — retrying';
    case 'pass-error': return 'hit an error';
    case 'no-actionable-mission': return 'no active mission';
    case 'target-not-actionable': return "mission can't run yet";
    case 'target-cleared': return 'stopped driving';
    case 'infra-leaf-reset': return n(counts.infraResets) ? `unblocked ${n(counts.infraResets)} stuck leaf${n(counts.infraResets) === 1 ? '' : 's'}` : 'unblocked stuck work';
    case 'verify-paneled': return 'verifying criteria';
    case 'card-triaged': return n(counts.cardsParked) ? `parked ${n(counts.cardsParked)} stuck leaf${n(counts.cardsParked) === 1 ? '' : 's'}` : 'parked stuck work';
    case 'conductor-disabled': return 'off';
    case 'daemon-off': return 'daemon off';
    case 'pass-ran': return 'running…';
    default: return reason;
  }
}

// telemetry — never break the run. The journal is an observer of a pass, not a dependency of
// one: any throw from either wrapper is swallowed so a journal DB hiccup can never sink a pass.
function note(rowId: string | null, patch: Parameters<typeof appendPassProgress>[1]): void {
  if (rowId == null) return;
  try {
    appendPassProgress(rowId, patch);
  } catch {
    /* fail-open */
  }
}

function seal(rowId: string | null, patch: Parameters<typeof finalizePassRow>[1]): void {
  if (rowId == null) return;
  try {
    finalizePassRow(rowId, patch);
  } catch {
    /* fail-open */
  }
}

/** One conductor pass for a project. No-op (spends nothing) unless the toggle is on AND there is an
 *  approved+active mission with a NEW actionable state (a discover/verify gap the conductor hasn't
 *  already served at this exact fingerprint). */
export async function runConductorPass(project: string, deps: ConductorPassDeps = {}): Promise<ConductorPassResult> {
  let journalRowId: string | null = null;
  try {
    journalRowId = openPassRow(project, null, Date.now());
  } catch {
    journalRowId = null;
  }
  try {
    const result = await runConductorPassInner(project, deps, journalRowId);
    setConductorLastPass(project, {
      missionId: result.missionId ?? null,
      reason: result.reason,
      tickAt: Date.now(),
      status: conductorStatusLine(result.reason, result),
    });
    seal(journalRowId, { missionId: result.missionId ?? null, outcome: result.reason, ran: result.ran });
    return result;
  } catch (err) {
    // Error stamp: records that the pass failed (rethrow so callers keep seeing the failure).
    setConductorLastPass(project, {
      missionId: null,
      reason: 'pass-error',
      tickAt: Date.now(),
      status: conductorStatusLine('pass-error'),
    });
    seal(journalRowId, { missionId: null, outcome: 'pass-error', ran: false });
    throw err;
  }
}

async function runConductorPassInner(project: string, deps: ConductorPassDeps = {}, journalRowId: string | null = null): Promise<ConductorPassResult> {
  if (!getConductorEnabled(project)) return { ran: false, reason: 'conductor-disabled' };
  // The conductor DIRECTS the daemon — it grounds gaps, files serving epics, and promotes leaves to
  // READY for the daemon to build & land. With the daemon OFF the build pass never runs (the tick
  // skips it at `lvl === 'off'`), so those leaves sit unclaimed and the mission stalls at 'building'
  // while the conductor keeps spending expensive nodes on a pipeline that can't move. Conductor is a
  // DEPENDENT of the daemon, not an independent switch: no daemon ⇒ no conductor spend.
  if (getOrchestratorLevel(project) === 'off') return { ran: false, reason: 'daemon-off' };

  try {
    const promoted = promoteQueuedMissions(project);
    for (const missionId of promoted) {
      try {
        syncMissionSubscription(project, missionId);
      } catch {
        /* fail-open */
      }
    }
  } catch {
    /* fail-open — promotion must never block a conductor pass */
  }

  // The approved + active, non-terminal, actionable mission — the project's SINGLE active mission is
  // what the conductor drives. No pin: the human "drive this one instead" override lives in
  // set_active_mission, which swaps the active flag (auto-enqueueing the displaced mission), so there
  // is exactly one active mission to resolve here. listMissions self-heals terminal-active rows, so a
  // converged mission can never survive this filter; mission.status/awaitingApprovalSince carry the
  // authoritative derived status.
  const actionable = listMissions(project).filter((m) =>
    m.mission.active && m.mission.awaitingApprovalSince == null && m.mission.status != null &&
    !['unapproved', 'abandoned', 'converged', 'closed'].includes(m.mission.status));
  if (actionable.length === 0) return { ran: false, reason: 'no-actionable-mission' };
  // If >1 survive (should not happen — one active mission per project is the invariant), drive the
  // first in listMissions order. The pin, its total order, and its advisory are all retired.
  const selected = actionable[0];
  const target: { summary: ReturnType<typeof listMissions>[number]; row: NonNullable<ReturnType<typeof getMission>> } =
    { summary: selected, row: selected.mission };
  const missionId = target.row.todoId;
  const status = target.row.status!;
  const session = 'conductor';
  note(journalRowId, { missionId });

  let rechecksDrained = 0;
  let pendingRechecks: MissionRecheck[] = [];
  try {
    const drained = drainMissionRechecks(project, missionId);
    rechecksDrained = drained.cleared.length;
    pendingRechecks = drained.pending;
  } catch {
    /* fail-open — a drain hiccup must never abort a conductor pass */
  }

  const armFor = (reason: ConductorPassResult['reason']): 'infra' | 'redecompose' | 'verify-panel' | 'node' | 'none' => {
    switch (reason) {
      case 'infra-leaf-reset': return 'infra';
      case 'redecomposed': return 'redecompose';
      case 'verify-paneled': return 'verify-panel';
      case 'conducted':
      case 'node-failed': return 'node';
      default: return 'none';
    }
  };

  const declinedFor = (reason: ConductorPassResult['reason'], serveCapDeferredCount?: number): Array<{ what: string; why: string }> => {
    switch (reason) {
      case 'debounced': return [{ what: 'pass', why: 'fingerprint unchanged' }];
      case 'building-wait': return [{ what: 'pass', why: 'daemon already building, no gap' }];
      case 'criteria-escalated':
        return (serveCapDeferredCount ?? 0) > 0
          ? [{ what: 'criteria', why: 'serve-cap ladder not exhausted' }]
          : [];
      default: return [];
    }
  };

  const done = (r: ConductorPassResult): ConductorPassResult => {
    note(journalRowId, {
      arm: armFor(r.reason),
      filed: {
        escalationsRaised: r.escalationsRaised, infraResets: r.infraResets, infraCards: r.infraCards,
        redecomposed: r.redecomposed, closeOutsMinted: r.closeOutsMinted,
        verifyPaneled: r.verifyPaneled, verifyHeld: r.verifyHeld,
      },
      declined: declinedFor(r.reason, r.serveCapDeferred),
    });
    return { ...r, rechecksDrained };
  };

  // OVER-BUDGET FINAL ACT (mission a6ab522b). The authoritative derived status says this
  // mission's spend has crossed its ceiling. Everything below this line costs money — the
  // per-criterion facts scan, the INFRA arm's git probes, and above all the conductor NODE.
  // So the conductor's LAST act is to raise ONE re-bet decision card and stop. The card is
  // pure arithmetic over reads the status derivation already paid for (no LLM node), which
  // is why it needs no exemption from the gate it is being raised under, and the store's
  // condition-key dedup (mission + ceiling crossed) bounds it to exactly one per crossing:
  // repeated ticks bump recurrence in place, and a raised ceiling later crossed mints a
  // fresh card. Before this, the pass silently drove an over-budget mission (missionStatusRank
  // ranks it 'still actionable') or the loop silently returned none — either way, no card.
  if (status === 'over-budget') {
    const card = raiseOverBudgetRebetCard(project, missionId, session, target.summary.node.title ?? missionId, {
      createEscalation: deps.createEscalation,
    });
    return done({ ran: false, reason: 'over-budget-rebet', missionId, escalationsRaised: card.isNew ? 1 : 0 });
  }

  const criteriaWithActions = listCriteriaWithActions(project, missionId);
  note(journalRowId, { criteriaActed: criteriaWithActions.map((a) => ({ criterionId: a.id, action: a.action })) });
  const actions = criteriaWithActions.map((a) => ({ action: a.action, id: a.id, rejectedParked: a.rejectedParkedCount }));
  // SERVE-CAP: a criterion that has burned CRITERION_SERVE_CAP serving epics and is still
  // unmet derives 'escalate' (not 'discover') — re-filing is thrash. Gate card raise on
  // ladder exhaustion: only raise when all rungs have been attempted. This runs BEFORE
  // the hasGap/no-op decision so a mission whose only gaps are capped never spends a node.
  const escalated = criteriaWithActions.filter((a) => a.action === 'escalate');
  let escalationsRaised = 0;
  let serveCapDeferred = 0;
  let closeOutsMinted = 0;
  // Hoist the serving epics read outside the loop, fail-open to []
  let servingEpicsByComp: Map<string, typeof criteriaWithActions[number]['id'][]> = new Map();
  let epicTargetProjectById: Map<string, string | null> = new Map();
  try {
    const allTodos = (deps.listTodos ?? listTodos)(project, { includeCompleted: true });
    for (const c of escalated) {
      const matching = allTodos.filter(
        (t) => t.parentId === missionId && t.kind === 'epic' && todoServesCriterion(t, c.id),
      );
      servingEpicsByComp.set(c.id, matching.map((t) => t.id));
      for (const t of matching) epicTargetProjectById.set(t.id, t.targetProject);
    }
  } catch {
    // fail-open to empty serving epics
  }

  if (escalated.length > 0) {
    const createEsc = deps.createEscalation ?? createEscalation;
    const listApproachFn = deps.listApproachAttempts ?? listApproachAttempts;
    const listLeafRunsFn = deps.listLeafRuns ?? listLeafRuns;

    for (const c of escalated) {
      try {
        // Read approach attempts; on throw set storeFaulted to treat ladder as exhausted
        let attempts: ApproachAttempt[] = [];
        let storeFaulted = false;
        try {
          attempts = listApproachFn(project, c.id);
        } catch {
          storeFaulted = true;
        }

        // Check if ladder is exhausted
        const ladder = storeFaulted ? { exhausted: true, tried: [], missing: [] } : ladderExhausted({ attempts, servedEpicCount: c.servedEpicCount });
        const { exhausted } = ladder;

        // If not exhausted, defer and skip card creation
        if (!exhausted) {
          serveCapDeferred++;
          continue;
        }

        const exhaustedBy: 'store-fault' | 're-decompose' | 'serve-cap' =
          storeFaulted ? 'store-fault' : c.servedEpicCount >= CRITERION_SERVE_CAP ? 'serve-cap' : 're-decompose';

        // TEST-ONLY-CLOSE ARM: if the criterion's verdict cites test paths only, mint a
        // narrow close-out leaf instead of raising a human card. Own try/catch (not the
        // outer per-criterion one) so a thrown deps fn falls through to the card path below
        // exactly as a `mint-failed` result would, rather than being swallowed and skipping
        // the card entirely.
        let closeMinted = false;
        try {
          const closeResult = await (deps.closeArm ?? runTestOnlyCloseArm)(project, session, missionId, {
            id: c.id,
            text: c.text,
            evidence: c.evidence,
            evidencePaths: c.evidencePaths,
            verifiedAtSha: c.verifiedAtSha,
          });
          closeMinted = closeResult.minted;
        } catch {
          closeMinted = false;
        }
        if (closeMinted) {
          closeOutsMinted++;
          continue;
        }

        // Collect reasons from serving epics
        let distinctReasons: string[] = [];
        let newestReasonAt: number | undefined;
        try {
          const servingEpicIds = servingEpicsByComp.get(c.id) ?? [];
          const allRuns: Array<ReturnType<typeof listLeafRunsFn>[number]> = [];
          for (const epicId of servingEpicIds) {
            try {
              const runs = listLeafRunsFn({ project, epicId });
              allRuns.push(...runs);
            } catch {
              // per-epic try/catch → []
            }
          }
          if (allRuns.length > 0) {
            distinctReasons = summariseEpicOutcomes(allRuns).distinctReasons;
            const contributing = allRuns.filter((r) => (r.finalOutcome === 'rejected' || r.finalOutcome === 'blocked') && !!r.reason);
            if (contributing.length > 0) newestReasonAt = Math.max(...contributing.map((r) => r.lastTs));
          }
        } catch {
          // fail-open to empty reasons
        }

        // Build diagnosis
        const diagnosis = buildServeCapDiagnosis({
          criterionText: c.text,
          servedEpicCount: c.servedEpicCount,
          attempts,
          distinctReasons,
          verdict: { evidence: c.evidence, verifiedAt: c.verifiedAt, verifiedAtSha: c.verifiedAtSha },
          newestReasonAt,
          exhaustedBy,
        });

        let suppressed = false;
        if (distinctReasons.length > 0 && distinctReasons.every((r) => classifyInfraRejection(r) === 'epic-base-red')) {
          try {
            const probeFn = deps.epicBaseProbe ?? defaultEpicBaseProbe;
            const servingEpicIds = servingEpicsByComp.get(c.id) ?? [];
            const verdicts = await Promise.all(
              servingEpicIds.map((epicId) => probeFn(epicId, epicTargetProjectById.get(epicId) ?? project)),
            );
            if (verdicts.length > 0 && verdicts.every((v) => v === 'pass')) {
              suppressed = true;
            }
          } catch {
            // fail-open — do not suppress on a probe throw
          }
        }
        if (suppressed) {
          serveCapDeferred++;
          continue;
        }

        const marker = serveCapMarker(c.id);
        const questionText =
          `Mission "${target.summary.node.title ?? missionId}" — criterion "${c.text}" ${marker}: ` +
          `${c.servedEpicCount} serving epics filed but the criterion is still unmet — it likely needs ` +
          `HUMAN action (a live measurement / deploy / rescope); the conductor will not re-file. ` +
          `Resolve or rescope this criterion.\n` +
          diagnosis;
        const res = createEsc({
          project,
          session,
          kind: CRITERION_SERVE_CAP_KIND,
          todoId: missionId,
          operatorGated: true,
          audience: 'human',
          conditionKey: serveCapConditionKey(c.id),
          conditionTuple: ['serve-cap', c.id],
          questionText,
        });
        if (res && res.isNew) {
          escalationsRaised++;
        } else if (res && !res.isNew && res.escalation.status === 'resolved') {
          const reopen = deps.reopenResolvedEscalation ?? reopenResolvedEscalationByConditionKey;
          const reopened = reopen({ project, conditionKey: serveCapConditionKey(c.id), questionText });
          if (reopened && reopened.reopened) escalationsRaised++;
        }
      } catch {
        // fail-open per criterion — one bad card must not sink the rest of the pass.
      }
    }
  }

  // RECOVERY ARMS: infraArm + redecomposeArm. Even if a mission is escalate-blocked (a capped
  // criterion), both arms MUST run first — they fix INFRA (base-red leaves) and re-decompose
  // churning epics. Only after both arms find nothing (and hasGap remains false) do we reach
  // the criteria-escalated return at line 556. This lock is tested in conductor-pass.test.ts.
  //
  // INFRA STUCK-WORK ARM. A leaf parked on `epic-base-red` (or a gate that could not run, or a
  // mis-homed target) is INFRA-dead, not content-dead: its rejection moves rejectedParkedCount
  // exactly ONCE, after which the fingerprint below is constant and every later pass debounces —
  // even after a commit repairs the base. The arm re-probes that precondition deterministically and
  // either un-parks the leaf or raises exactly one human card; either way the debounce is broken for
  // this tick so the stuck work cannot sit invisible forever. Fail-open: an arm fault degrades to a
  // no-op pass, never a broken conductor.
  let arm: InfraArmResult = { candidates: [], reset: [], cardsRaised: 0, skipped: [], baseRepairEpics: [], reapedBaseRepairEpics: [] };
  try {
    arm = await (deps.infraArm ?? runInfraRejectionArm)(project, missionId, session, {
      probe: deps.epicBaseProbe,
      createEscalation: deps.createEscalation,
      listOpenEscalations: deps.listOpenEscalations,
    });
  } catch {
    arm = { candidates: [], reset: [], cardsRaised: 0, skipped: [], baseRepairEpics: [], reapedBaseRepairEpics: [] };
  }
  if (arm.reset.length > 0) {
    // A leaf just went back to READY. Spend NOTHING on a conductor node and do NOT stamp the run:
    // the daemon rebuilds the un-parked leaf on its own tick, and the fingerprint moves for real
    // once that rebuild changes rejectedParkedCount.
    return done({
      ran: true,
      reason: 'infra-leaf-reset',
      missionId,
      escalationsRaised,
      serveCapDeferred,
      closeOutsMinted,
      infraResets: arm.reset.length,
      infraCards: arm.cardsRaised,
    });
  }

  let cardTriage: CardTriageArmResult = { parked: [], skipped: [] };
  try {
    cardTriage = await (deps.cardTriageArm ?? runCardTriageArm)(project, missionId, session, {});
  } catch {
    cardTriage = { parked: [], skipped: [] };
  }
  if (cardTriage.parked.length > 0) {
    return done({
      ran: true, reason: 'card-triaged', missionId, escalationsRaised, serveCapDeferred,
      closeOutsMinted, infraResets: arm.reset.length, infraCards: arm.cardsRaised,
      cardsParked: cardTriage.parked.length,
    });
  }

  let redecomposed: string[] = [];
  try { redecomposed = (await (deps.redecomposeArm ?? runRedecomposeArm)(project, missionId, session, {})).redecomposed }
  catch { redecomposed = [] }
  if (redecomposed.length > 0)
    return done({ ran: true, reason: 'redecomposed', missionId, escalationsRaised, serveCapDeferred, closeOutsMinted, redecomposed: redecomposed.length,
                  infraResets: arm.reset.length, infraCards: arm.cardsRaised });

  const hasGap = actions.some((a) => a.action === 'discover' || a.action === 'verify');
  // ONE post-arm escalation snapshot, taken AFTER runInfraRejectionArm so the arm's own
  // leaf-infra-rejected cards are already in it (that is what breaks the debounce for a
  // newly-carded stuck leaf) — feeds BOTH the hard-block and land-ready card id sets.
  const cardSnapshot = (() => { try { return (deps.listOpenEscalations ?? listOpenEscalations)(); } catch { return []; } })();
  const missionTodoIds = collectMissionTodoIds(project, missionId);
  const { hardCardIds, landCardIds } = collectMissionCardIds(cardSnapshot, project, missionTodoIds);

  // The SUCCESS-debounce key includes the open land-ready card ids: a new epic-ready-to-land card is
  // genuinely new work (the conductor must wake to land it), so it must reopen a previously-served
  // state. The FAIL-RETRY counter, however, keys on the SERVE SIGNATURE ALONE (status + per-criterion
  // actions + mission-scoped hard-block card ids) — NOT on landCardIds. The old landCards was a
  // project-GLOBAL count that flipped as unrelated epics across the project surfaced/cleared their
  // land cards; folding it into the fail key let any such flip reset priorFails and re-spawn
  // CONDUCTOR_SERVE_RETRY_CAP fresh (expensive) conductor nodes on a mission whose serve-state is
  // structurally UNSERVABLE (the 9688e874 crit7 token churn: an undelegatable criterion got 3
  // brand-new nodes every time an unrelated land card came or went). Keying the cap on the serve
  // signature alone makes an unservable state cap ONCE and STAY capped until the serve signature
  // itself changes (a criterion actually progresses, OR a mission-scoped hard card opens/resolves —
  // both are genuinely new information, so a changed serveFp is itself the re-arm; there is no
  // separate infraActed bypass to key on).
  const serveFp = buildServeSignature({ status, actions, hardCardIds });
  const fp = buildPassSignature(serveFp, landCardIds);
  const lastKey = target.row.lastConductorKey;
  const selfKey = target.row.lastConductorSelfKey;
  // A prior SUCCESSFUL pass on this exact state (incl. land cards) ⇒ debounce (unchanged behaviour).
  // A signature equal to the SELF key the conductor stamped after its OWN last productive pass is
  // also a debounce: the only delta since then is cards the pass (or its INFRA arm) minted, which is
  // a self-echo, not a wake-up.
  if (lastKey === fp || selfKey === fp) return done({ ran: false, reason: 'debounced', missionId });
  // A prior FAILED pass encodes `${serveFp}|fail:N`. A node FAILURE (or empty serve) used to stamp
  // the plain fp and permanently wedge the mission; it now retries up to CONDUCTOR_SERVE_RETRY_CAP
  // times across ticks, then stops respinning an expensive node on an unservable serve-state
  // (bounded, not a permanent wedge — and NOT re-armed by landCardIds drift). Because hard-card ids
  // now live INSIDE serveFp, a new hard card changes failPrefix itself and the counter restarts from
  // 0 for the new serve-state — the intended re-arm (a new card is new information), still bounded by
  // CONDUCTOR_SERVE_RETRY_CAP per distinct card set.
  const failPrefix = `${serveFp}|fail:`;
  const priorFails = lastKey && lastKey.startsWith(failPrefix) ? Number(lastKey.slice(failPrefix.length)) || 0 : 0;
  if (priorFails >= CONDUCTOR_SERVE_RETRY_CAP) return done({ ran: false, reason: 'debounced', missionId });

  // Distinct bounded loop-breaker for CONSECUTIVE node timeouts on this unchanged serve-state
  // (see CONDUCTOR_TIMEOUT_RECUR_CAP). A serve-state that structurally can't be processed
  // inside CONDUCTOR_NODE_TIMEOUT_MS must not be re-spun forever; unlike the fail counter this
  // never falls into isTransientNodeFault's no-stamp exemption, so it needs its own cap + card.
  const timeoutRecurrence = readConductorTimeoutRecurrence(target.row, serveFp);
  if (timeoutRecurrence >= CONDUCTOR_TIMEOUT_RECUR_CAP) {
    try {
      (deps.createEscalation ?? createEscalation)({
        project, session, kind: 'conductor-timeouts-capped', todoId: missionId,
        operatorGated: true, audience: 'human',
        conditionKey: `conductor-timeout:${missionId}`,
        conditionTuple: ['conductor-timeout', missionId],
        questionText: `Mission "${target.summary.node.title ?? missionId}" — the conductor node ` +
          `has timed out ${timeoutRecurrence} times in a row on the same serve-state (signature ` +
          `${serveFp}, mission status "${status}"). The conductor will not re-invoke; this state ` +
          `likely needs a smaller/cheaper serve-state or human investigation.`,
      });
    } catch { /* fail-open — the cap itself must not throw */ }
    return done({ ran: false, reason: 'conductor-timeouts-capped', missionId, escalationsRaised, serveCapDeferred, closeOutsMinted });
  }

  // No servable gap and no land card to drive: nothing for the node to do. A capped
  // ('escalate') criterion is NOT a servable gap — we already raised its human escalation
  // above and must NOT spend a node re-filing for it (the thrash this cap kills). Report
  // 'criteria-escalated' when the only remaining work is escalated, else fall through to the
  // building-wait (daemon working) no-op.
  if (!hasGap && landCardIds.length === 0) {
    if (escalated.length > 0) return done({ ran: false, reason: 'criteria-escalated', missionId, escalationsRaised, serveCapDeferred, closeOutsMinted });
    // 'building' normally means "the daemon is on it — leave it". An open mission-scoped hard card
    // (e.g. a just-carded INFRA leaf) is the exception: reaching this line already proves the
    // signature differs from both stored keys, and step 4 of the conductor prompt makes the node the
    // authority for exactly that stuck work. Wakes at most once per distinct card set — the
    // productive pass stamps the self key over it.
    if (status === 'building' && hardCardIds.length === 0) return done({ ran: false, reason: 'building-wait', missionId });
  }

  const provider = resolveNodeProvider(project, 'conductor', CONDUCTOR_ALLOWED_TOOLS);
  const model = resolveNodeModel(project, 'conductor', provider, ORCHESTRATION_NODE_PROFILE.conductor.model);
  const effort: EffortLevel = resolveOrchestrationEffort(project, 'conductor');

  // Interim heartbeat: refreshes liveness while the node is mid-flight; the terminal stamp
  // in runConductorPass records the pass's actual outcome.
  setConductorLastPass(project, { missionId, reason: 'pass-ran', tickAt: Date.now(), status: 'running…' });

  // WAKE CONTEXT. The cards + deltas that CAUSED this pass, handed to the node as data instead of
  // being left for it to (not) go fetch. Built ONLY from values already in scope for this pass —
  // cardSnapshot, missionTodoIds, criteriaWithActions, lastConductorPassAt — plus one narrow,
  // SQL-filtered resolved-card read (a resolution breaks the debounce, so the node must be told a
  // human answered). FAIL OPEN, mirroring the `// telemetry — never break the run` discipline
  // elsewhere in this file: a prompt DECORATION that throws must never sink a conductor pass, so
  // any fault degrades to today's prompt with no block.
  let wakeBlock: string | undefined;
  try {
    const lastPassAt = target.row.lastConductorPassAt ?? null;
    const openCards = cardSnapshot.filter(
      (e) => e.project === project && e.todoId != null && missionTodoIds.has(e.todoId),
    );
    let resolvedCards: typeof cardSnapshot = [];
    if (lastPassAt != null) {
      try {
        const since = (deps.listEscalationsResolvedSince ?? listEscalationsResolvedSince)(project, lastPassAt);
        resolvedCards = since.filter((e) => e.todoId != null && missionTodoIds.has(e.todoId));
      } catch {
        resolvedCards = [];
      }
    }
    // HIGH-STAKES VERIFY routing. For each criterion the derivation says needs a `verify`, classify
    // its stakes deterministically (criterion-verify-facts collects the live signals; classify is a
    // pure first-match). Only the enumerated triggers (reopened-by-land / contested-card / serve-burn)
    // flip panel===true; a fresh/unserved criterion stays panel===false and the renderer drops it.
    // This is the ROUTING half of the panel: the enforcement half (set_mission_criterion fail-closes
    // a high-stakes met without ≥2 panelVerdicts) already landed — without this signal the conductor
    // runs one checker and only learns it was high-stakes at the hard throw on record.
    const stakes = criteriaWithActions
      .filter((c) => c.action === 'verify')
      .map((c) => {
        const cls = classifyVerifyStakes(collectVerifyStakesInput(project, c.id));
        return { criterionId: c.id, panel: cls.panel, trigger: cls.trigger, checkerCount: cls.checkerCount };
      });
    wakeBlock = (deps.buildWakeBlock ?? buildWakeContextBlock)({
      missionId,
      missionTitle: target.summary.node.title ?? missionId,
      now: Date.now(),
      lastPassAt,
      openCards,
      resolvedCards,
      actions: criteriaWithActions.map((c) => ({ id: c.id, action: c.action, text: c.text })),
      rechecks: pendingRechecks.map((r) => ({ criterionId: r.criterionId, reason: r.reason, landedSha: r.landedSha, enqueuedAt: r.enqueuedAt })),
      stakes,
    });
  } catch {
    wakeBlock = undefined;
  }

  // VERIFY PANEL ARM. Auto-fire the three-lens panel for every high-stakes criterion
  // (land-reopened, contested-carded, serve-burning) BEFORE the conductor node is spent.
  // Each criterion's panel run is deterministic and recorded immediately. A criterion
  // whose panel run completes with unchanged-sha (already verified at this sha) is
  // skipped and falls through; the pass proceeds as normal (no node spent on already-verified
  // work). Fail-open: a panel run fault degrades to a no-op pass, never a broken conductor.
  let verifyPanel: VerifyPanelArmResult = { paneled: [], held: [], skipped: [] };
  try {
    verifyPanel = await (deps.verifyPanelArm ?? runVerifyPanelArm)(project, missionId, session, {});
  } catch {
    verifyPanel = { paneled: [], held: [], skipped: [] };
  }
  if (verifyPanel.paneled.length > 0 || verifyPanel.held.length > 0) {
    return done({
      ran: true,
      reason: 'verify-paneled',
      missionId,
      escalationsRaised,
      serveCapDeferred,
      closeOutsMinted,
      infraResets: arm.reset.length,
      infraCards: arm.cardsRaised,
      verifyPaneled: verifyPanel.paneled.length,
      verifyHeld: verifyPanel.held.length,
    });
  }

  const res = await (deps.invoke ?? invokeNode)({
    prompt: buildConductorPrompt(project, missionId, target.summary.node.title ?? missionId, session, wakeBlock),
    model,
    effort,
    // Explicit ceiling. Omitting this silently inherited node-invoker's generic
    // DEFAULT_TIMEOUT_MS (600_000), which measurement showed was BELOW the conductor's own
    // productive duration tail — 8.6% of passes were killed at the wall having produced
    // nothing. See CONDUCTOR_NODE_TIMEOUT_MS for the distribution and why a bigger ceiling
    // is a floor-raise, not the fix (bugs ce7f74bf / 565f7bef own the bounded-retry half).
    timeoutMs: CONDUCTOR_NODE_TIMEOUT_MS,
    allowedTools: CONDUCTOR_ALLOWED_TOOLS,
    mcpConfig: mcpConfigFor(config.PORT),
    strictMcpConfig: true,
    cwd: project,
    project,
    permissionMode: 'bypassPermissions',
    transcriptLabel: 'conductor',
    // Spend accounting: correlate this (expensive) conductor node's burn to its mission + session
    // (source defaults to transcriptLabel 'conductor'; default-on capture at the invoke boundary).
    ledgerTodoId: missionId,
    ledgerSession: session,
  });

  // PRODUCTIVE-PASS GUARD. A pass is a SUCCESS only if it actually moved the mission: the node
  // returned ok AND either there were no 'discover' gaps to serve this pass (a verify/land/building
  // pass legitimately files no epic), OR at least one criterion that WAS 'discover' now has a live
  // serving epic. A conductor node can return ok yet file NO epic (an LLM no-op, or a swallowed
  // plan_mission_criterion error). Stamping the plain success fp in that case debounces a still-unmet
  // mission FOREVER — the wedge that stranded 9688e874 at 4/7 until a human hand-served a gap. Treat
  // an empty serve like a node failure: stamp the bounded fail-counter so the mission RETRIES and
  // self-heals across ticks (up to CONDUCTOR_SERVE_RETRY_CAP, then the serve-cap escalation fires).
  const discoverIdsBefore = actions.filter((a) => a.action === 'discover').map((a) => a.id);
  const updatedCriteriaWithActions = listCriteriaWithActions(project, missionId);
  const servedAGap =
    discoverIdsBefore.length === 0 ||
    updatedCriteriaWithActions.some(
      (c) => discoverIdsBefore.includes(c.id) && c.servingEpicState !== 'none',
    );
  const productive = res.ok && servedAGap;
  // A transient fault — rate cap / connectivity-unreachable / auth+stdin faultKind (all reported
  // as rateLimited), spawn or auth-halt startFailure, or a node timedOut (start-window or
  // wall-clock kill) — was never a real attempt at the serve-state, so it must not consume the
  // bounded serve-retry counter.
  const transient = isTransientNodeFault(res);
  if (productive) {
    // Stamp the fingerprint using the UPDATED state after the node ran (but the PRE-pass card ids —
    // that is the state the pass reacted to), so the next pass recognizes this state as
    // already-attempted and debounces without re-invoking.
    const updatedStatus = getMission(project, missionId)?.status ?? status;
    const updatedActions = updatedCriteriaWithActions.map((a) => ({ action: a.action, id: a.id, rejectedParked: a.rejectedParkedCount }));
    const updatedServeFp = buildServeSignature({ status: updatedStatus, actions: updatedActions, hardCardIds });
    const updatedFp = buildPassSignature(updatedServeFp, landCardIds);
    // Self-issued key: a FRESH card snapshot + FRESH mission todo-id set (a served epic adds ids),
    // so the pass's own escalation/land-card side effects don't look like a wake-up next tick. Fail
    // open on a stamping hiccup: the pass must never throw here — degrade to today's behaviour.
    let postPassSelfKey: string | null = null;
    try {
      const postCardSnapshot = (deps.listOpenEscalations ?? listOpenEscalations)();
      const postIds = collectMissionCardIds(postCardSnapshot, project, collectMissionTodoIds(project, missionId));
      const postServeFp = buildServeSignature({ status: updatedStatus, actions: updatedActions, hardCardIds: postIds.hardCardIds });
      postPassSelfKey = buildPassSignature(postServeFp, postIds.landCardIds);
    } catch {
      postPassSelfKey = null;
    }
    stampConductorRun(project, missionId, updatedFp, { selfKey: postPassSelfKey });
  } else if (res.timedOut === true) {
    // Bounded separately from the fail counter — see CONDUCTOR_TIMEOUT_RECUR_CAP. Must be
    // checked BEFORE the generic `transient` arm below (timedOut is itself transient) or a
    // timeout would silently fall into the no-op arm and never be bounded.
    stampConductorTimeout(project, missionId, serveFp);
  } else if (transient) {
    // rateLimited / startFailure — unchanged: no stamp, no counter consumed (ec9a00eb).
    // Do NOT stampConductorRun — leave target.row.lastConductorKey unchanged so the next
    // tick re-runs a pass on the SAME serve-state (no fail: increment, no debounce).
  } else {
    stampConductorRun(project, missionId, `${failPrefix}${priorFails + 1}`);
  }
  return done({ ran: true, reason: productive ? 'conducted' : 'node-failed', missionId, modelUsed: model, escalationsRaised, serveCapDeferred, closeOutsMinted, infraResets: arm.reset.length, infraCards: arm.cardsRaised });
}
