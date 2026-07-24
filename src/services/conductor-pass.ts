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
import { getConductorEnabled, getConductorTargetMission, setConductorTargetMission, listOpenEscalations, setConductorLastPass, createEscalation } from './supervisor-store.js';
import {
  listMissions,
  getMission,
  listCriteriaWithActions,
  stampConductorRun,
  selectConductorMission,
  CRITERION_SERVE_CAP,
  promoteQueuedMissions,
} from './mission-store.js';
import { CONDUCTOR_SERVE_RETRY_CAP } from './harness-caps.js';
import { raiseOverBudgetRebetCard } from './mission-budget-gate.js';
import { runInfraRejectionArm, type EpicBaseProbe, type InfraArmResult } from './conductor-infra-arm.js';
import { listTodos } from './todo-store.js';
import { syncMissionSubscription } from './mission-subscription.js';
import { getOrchestratorLevel } from './orchestrator-config.js';
import { resolveNodeModel, resolveNodeProvider, resolveOrchestrationEffort } from './node-provider.js';
import { invokeNode, mcpConfigFor, isTransientNodeFault, type NodeSpec, type NodeResult } from '../agent/node-invoker.js';
import { config } from '../config.js';
import type { EffortLevel } from '../agent/contracts.js';
import { ORCHESTRATION_NODE_PROFILE } from './node-kinds.js';

/** The conductor node DIRECTS the work-graph — it never hand-edits source. Read/Grep/Glob/Bash to
 *  ground; the mermaid MCP tools to serve criteria (create_epic/add_leaves), record VERIFY verdicts
 *  (set_mission_criterion), check readiness and LAND (epic_land_readiness/land_epic). */
export const CONDUCTOR_ALLOWED_TOOLS = ORCHESTRATION_NODE_PROFILE.conductor.allowedTools;

import { buildServeSignature, buildPassSignature, collectMissionCardIds, conductorFingerprint } from './conductor-signature.js';
export { conductorFingerprint, type ConductorActionRow } from './conductor-signature.js';

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
 *  `conditionKey` so a resolved card is suppressed and an open one is bumped instead of
 *  re-raised (supervisor-store.ts createEscalation :824-842). */
export function serveCapConditionKey(criterionId: string): string {
  return `serve-cap:${criterionId}`;
}

/** Build the conductor NODE prompt: a self-contained distillation of the /conductor skill for ONE
 *  pass against ONE mission. References nothing in skills/. */
export function buildConductorPrompt(project: string, missionId: string, missionTitle: string, session: string): string {
  return [
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
    '3. For a criterion with action `verify` (its serving epic LANDED, verdict not recorded): run the',
    '   INDEPENDENT verify — check the landed change against ground truth (maker≠checker, fail CLOSED),',
    '   then `mcp__mermaid__set_mission_criterion` with `met`, the `evidence` you cited, and',
    '   `verifiedBy`. Never self-grade work you directed.',
    '4. Criteria with action `building` are in flight — leave them; the daemon is on it. BUT there is no',
    '   longer an AI steward auto-answering escalations — YOU are the authority for stuck work. Call',
    '   `mcp__mermaid__escalation_list` and look for `blocker` / `assumption-invalidated` cards on this',
    '   mission\'s todos. For each such todo, call `mcp__mermaid__leaf_inspect` { todoId } and read',
    '   `attempts` — how many times that leaf has re-run (EVERY attempt re-pays an expensive blueprint;',
    '   a todo failing the same way over and over is burn, not progress). Read `parseError`/`reason` for',
    '   WHY it failed. Then DECIDE — never let a todo silently re-blueprint attempt after attempt:',
    '     • Fixable spec/constraint → tighten it (`plan_mission_criterion` to re-plan, or correct a bad',
    '       ACTIVE CONSTRAINT) so the next build can actually pass.',
    '     • Repeatedly failing (attempts ≥ 3) with an unresolved blocker → STOP the loop: park it with',
    '       `mcp__mermaid__reset_todo` { status: "blocked" } (a HOLD — not claimable, so the daemon stops',
    '       re-dispatching), and leave the blocker escalation OPEN for the human with what you found.',
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
  /** Injectable INFRA stuck-work arm (test spy). Defaults to runInfraRejectionArm. */
  infraArm?: typeof runInfraRejectionArm;
  /** Injected base re-probe, forwarded into the default arm so tests stay hermetic (no git/gate). */
  epicBaseProbe?: EpicBaseProbe;
}

export interface ConductorPassResult {
  ran: boolean;
  reason: 'conductor-disabled' | 'daemon-off' | 'no-actionable-mission' | 'target-not-actionable' | 'target-cleared' | 'building-wait' | 'criteria-escalated' | 'debounced' | 'conducted' | 'node-failed' | 'infra-leaf-reset' | 'over-budget-rebet' | 'pass-ran' | 'pass-error';
  /** How many serve-cap escalations this pass raised (0 unless a criterion hit the cap). */
  escalationsRaised?: number;
  /** INFRA-rejected leaves un-parked this pass (their base re-probed green). */
  infraResets?: number;
  /** INFRA-rejection human cards raised this pass (probe could not prove green). */
  infraCards?: number;
  missionId?: string;
  modelUsed?: string;
}

/** One conductor pass for a project. No-op (spends nothing) unless the toggle is on AND there is an
 *  approved+active mission with a NEW actionable state (a discover/verify gap the conductor hasn't
 *  already served at this exact fingerprint). */
export async function runConductorPass(project: string, deps: ConductorPassDeps = {}): Promise<ConductorPassResult> {
  try {
    const result = await runConductorPassInner(project, deps);
    setConductorLastPass(project, {
      missionId: result.missionId ?? null,
      reason: result.reason,
      tickAt: Date.now(),
    });
    return result;
  } catch (err) {
    // Error stamp: records that the pass failed (rethrow so callers keep seeing the failure).
    setConductorLastPass(project, {
      missionId: null,
      reason: 'pass-error',
      tickAt: Date.now(),
    });
    throw err;
  }
}

async function runConductorPassInner(project: string, deps: ConductorPassDeps = {}): Promise<ConductorPassResult> {
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

  // The approved + active, non-terminal, actionable mission. (One active mission per session; drive
  // the first that qualifies.) getMission gives the authoritative derived status + awaitingApprovalSince.
  const pin = getConductorTargetMission(project);
  let target: { summary: ReturnType<typeof listMissions>[number]; row: NonNullable<ReturnType<typeof getMission>> } | undefined;

  if (pin == null) {
    // No pin: deterministic TOTAL-ORDER selection (B4) — replaces first-wins so which mission drives
    // is stable and never depends on listMissions order. Rivals are parked by non-selection only.
    const selection = selectConductorMission(project);
    if (!selection.target) return { ran: false, reason: 'no-actionable-mission' };
    if (selection.rivals.length > 0) {
      // Fail-open advisory: >1 actionable mission and no pin. We drove the deterministic winner; the
      // human can pin one to override. NEVER touches the rivals' active flag (H4 invariant).
      console.warn(`[conductor] ${project}: ${selection.rivals.length} actionable rival mission(s); drove ${selection.target.node.id} by deterministic order — pin one to override.`);
    }
    target = { summary: selection.target, row: selection.target.mission };
  } else {
    // Pinned: resolve EXACTLY that mission (getMission handles short-id resolution). Never fall
    // back to a different mission — ambiguity is the bug the pin exists to kill.
    const row = getMission(project, pin);
    const summary = row ? listMissions(project).find((m) => m.node.id === row.todoId) : undefined;
    if (!row || !summary || row.status == null || ['converged', 'abandoned'].includes(row.status)) {
      // Pin points at a mission that no longer exists or is terminal — clear it lazily so the next
      // tick falls back to unpinned selection instead of permanently no-op'ing.
      setConductorTargetMission(project, null);
      return { ran: false, reason: 'target-cleared' };
    }
    if (row.awaitingApprovalSince != null || row.status === 'unapproved') {
      // Not yet actionable — hold the pin, do NOT select any other mission.
      return { ran: false, reason: 'target-not-actionable', missionId: row.todoId };
    }
    target = { summary, row };
  }
  const missionId = target.row.todoId;
  const status = target.row.status!;
  const session = target.summary.ownerSession ?? target.summary.assigneeSession ?? 'conductor';

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
    return { ran: false, reason: 'over-budget-rebet', missionId, escalationsRaised: card.isNew ? 1 : 0 };
  }

  const criteriaWithActions = listCriteriaWithActions(project, missionId);
  const actions = criteriaWithActions.map((a) => ({ action: a.action, id: a.id, rejectedParked: a.rejectedParkedCount }));
  // SERVE-CAP: a criterion that has burned CRITERION_SERVE_CAP serving epics and is still
  // unmet derives 'escalate' (not 'discover') — re-filing is thrash. Raise ONE human
  // escalation per such criterion, debounced against any already-open one. This runs BEFORE
  // the hasGap/no-op decision so a mission whose only gaps are capped never spends a node.
  const escalated = criteriaWithActions.filter((a) => a.action === 'escalate');
  let escalationsRaised = 0;
  if (escalated.length > 0) {
    const createEsc = deps.createEscalation ?? createEscalation;
    for (const c of escalated) {
      try {
        const marker = serveCapMarker(c.id);
        const res = createEsc({
          project,
          session,
          kind: CRITERION_SERVE_CAP_KIND,
          todoId: missionId,
          operatorGated: true,
          conditionKey: serveCapConditionKey(c.id),
          conditionTuple: ['serve-cap', c.id],
          questionText:
            `Mission "${target.summary.node.title ?? missionId}" — criterion "${c.text}" ${marker}: ` +
            `${c.servedEpicCount} serving epics filed but the criterion is still unmet — it likely needs ` +
            `HUMAN action (a live measurement / deploy / rescope); the conductor will not re-file. ` +
            `Resolve or rescope this criterion.`,
        });
        if (res && res.isNew) escalationsRaised++;
      } catch {
        // fail-open per criterion — one bad card must not sink the rest of the pass.
      }
    }
  }

  // INFRA STUCK-WORK ARM. A leaf parked on `epic-base-red` (or a gate that could not run, or a
  // mis-homed target) is INFRA-dead, not content-dead: its rejection moves rejectedParkedCount
  // exactly ONCE, after which the fingerprint below is constant and every later pass debounces —
  // even after a commit repairs the base. The arm re-probes that precondition deterministically and
  // either un-parks the leaf or raises exactly one human card; either way the debounce is broken for
  // this tick so the stuck work cannot sit invisible forever. Fail-open: an arm fault degrades to a
  // no-op pass, never a broken conductor.
  let arm: InfraArmResult = { candidates: [], reset: [], cardsRaised: 0, skipped: [] };
  try {
    arm = await (deps.infraArm ?? runInfraRejectionArm)(project, missionId, session, {
      probe: deps.epicBaseProbe,
      createEscalation: deps.createEscalation,
      listOpenEscalations: deps.listOpenEscalations,
    });
  } catch {
    arm = { candidates: [], reset: [], cardsRaised: 0, skipped: [] };
  }
  if (arm.reset.length > 0) {
    // A leaf just went back to READY. Spend NOTHING on a conductor node and do NOT stamp the run:
    // the daemon rebuilds the un-parked leaf on its own tick, and the fingerprint moves for real
    // once that rebuild changes rejectedParkedCount.
    return {
      ran: true,
      reason: 'infra-leaf-reset',
      missionId,
      escalationsRaised,
      infraResets: arm.reset.length,
      infraCards: arm.cardsRaised,
    };
  }

  const hasGap = actions.some((a) => a.action === 'discover' || a.action === 'verify');
  // ONE post-arm escalation snapshot, taken AFTER runInfraRejectionArm so the arm's own
  // leaf-infra-rejected cards are already in it (that is what breaks the debounce for a
  // newly-carded stuck leaf) — feeds BOTH the hard-block and land-ready card id sets.
  const cardSnapshot = (() => { try { return (deps.listOpenEscalations ?? listOpenEscalations)(); } catch { return []; } })();
  const { hardCardIds, landCardIds } = collectMissionCardIds(cardSnapshot, project, collectMissionTodoIds(project, missionId));

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
  if (lastKey === fp || selfKey === fp) return { ran: false, reason: 'debounced', missionId };
  // A prior FAILED pass encodes `${serveFp}|fail:N`. A node FAILURE (or empty serve) used to stamp
  // the plain fp and permanently wedge the mission; it now retries up to CONDUCTOR_SERVE_RETRY_CAP
  // times across ticks, then stops respinning an expensive node on an unservable serve-state
  // (bounded, not a permanent wedge — and NOT re-armed by landCardIds drift). Because hard-card ids
  // now live INSIDE serveFp, a new hard card changes failPrefix itself and the counter restarts from
  // 0 for the new serve-state — the intended re-arm (a new card is new information), still bounded by
  // CONDUCTOR_SERVE_RETRY_CAP per distinct card set.
  const failPrefix = `${serveFp}|fail:`;
  const priorFails = lastKey && lastKey.startsWith(failPrefix) ? Number(lastKey.slice(failPrefix.length)) || 0 : 0;
  if (priorFails >= CONDUCTOR_SERVE_RETRY_CAP) return { ran: false, reason: 'debounced', missionId };

  // No servable gap and no land card to drive: nothing for the node to do. A capped
  // ('escalate') criterion is NOT a servable gap — we already raised its human escalation
  // above and must NOT spend a node re-filing for it (the thrash this cap kills). Report
  // 'criteria-escalated' when the only remaining work is escalated, else fall through to the
  // building-wait (daemon working) no-op.
  if (!hasGap && landCardIds.length === 0) {
    if (escalated.length > 0) return { ran: false, reason: 'criteria-escalated', missionId, escalationsRaised };
    // 'building' normally means "the daemon is on it — leave it". An open mission-scoped hard card
    // (e.g. a just-carded INFRA leaf) is the exception: reaching this line already proves the
    // signature differs from both stored keys, and step 4 of the conductor prompt makes the node the
    // authority for exactly that stuck work. Wakes at most once per distinct card set — the
    // productive pass stamps the self key over it.
    if (status === 'building' && hardCardIds.length === 0) return { ran: false, reason: 'building-wait', missionId };
  }

  const provider = resolveNodeProvider(project, 'conductor', CONDUCTOR_ALLOWED_TOOLS);
  const model = resolveNodeModel(project, 'conductor', provider, ORCHESTRATION_NODE_PROFILE.conductor.model);
  const effort: EffortLevel = resolveOrchestrationEffort(project, 'conductor');

  // Interim heartbeat: refreshes liveness while the node is mid-flight; the terminal stamp
  // in runConductorPass records the pass's actual outcome.
  setConductorLastPass(project, { missionId, reason: 'pass-ran', tickAt: Date.now() });

  const res = await (deps.invoke ?? invokeNode)({
    prompt: buildConductorPrompt(project, missionId, target.summary.node.title ?? missionId, session),
    model,
    effort,
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
  } else if (transient) {
    // Do NOT stampConductorRun — leave target.row.lastConductorKey unchanged so the next
    // tick re-runs a pass on the SAME serve-state (no fail: increment, no debounce).
  } else {
    stampConductorRun(project, missionId, `${failPrefix}${priorFails + 1}`);
  }
  return { ran: true, reason: productive ? 'conducted' : 'node-failed', missionId, modelUsed: model, escalationsRaised, infraResets: arm.reset.length, infraCards: arm.cardsRaised };
}
