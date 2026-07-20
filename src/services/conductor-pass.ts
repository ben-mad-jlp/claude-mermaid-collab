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
import { getConductorEnabled, getConductorTargetMission, setConductorTargetMission, listOpenEscalations, setConductorLastPass, createEscalation, type Escalation } from './supervisor-store.js';
import {
  listMissions,
  getMission,
  listCriteriaWithActions,
  stampConductorRun,
  selectConductorMission,
  CRITERION_SERVE_CAP,
} from './mission-store.js';
import { resolveNodeModel, resolveNodeProvider, resolveOrchestrationEffort } from './node-provider.js';
import { invokeNode, mcpConfigFor, type NodeSpec, type NodeResult } from '../agent/node-invoker.js';
import { config } from '../config.js';
import type { EffortLevel } from '../agent/contracts.js';
import { ORCHESTRATION_NODE_PROFILE } from './node-kinds.js';

/** The conductor node DIRECTS the work-graph — it never hand-edits source. Read/Grep/Glob/Bash to
 *  ground; the mermaid MCP tools to serve criteria (create_epic/add_leaves), record VERIFY verdicts
 *  (set_mission_criterion), check readiness and LAND (epic_land_readiness/land_epic). */
export const CONDUCTOR_ALLOWED_TOOLS = ORCHESTRATION_NODE_PROFILE.conductor.allowedTools;

export interface ConductorActionRow {
  action: 'met' | 'building' | 'verify' | 'discover' | 'escalate';
  id: string;
}

/** The kind stamped on a serve-cap escalation. One OPEN card per (mission, criterion) at a
 *  time — the debounce below skips creating a second while one is still open. */
export const CRITERION_SERVE_CAP_KIND = 'criterion-serve-cap';

/** How many times a FAILED conductor serve (node/planner failure) retries the SAME mission state
 *  across ticks before the pass stops respinning an expensive node on it. Bounds the retry so a
 *  transient failure self-heals but a persistently-unservable state does not thrash forever. */
export const CONDUCTOR_SERVE_RETRY_CAP = 3;

/** Debounce marker embedded in the escalation questionText so listOpenEscalations can be
 *  matched back to an exact (mission, criterion) even though the card carries only todoId
 *  (=missionId) and free text. Stable + greppable. */
export function serveCapMarker(criterionId: string): string {
  return `[serve-cap:${criterionId}]`;
}

/** Debounce fingerprint: the derived mission status + the per-criterion actions. Unchanged ⇒ the
 *  conductor already saw this exact state and spent a node on it — do not spend another. */
export function conductorFingerprint(status: string, actions: ConductorActionRow[]): string {
  const parts = actions.map((a) => `${a.id}:${a.action}`).sort();
  return `${status}|${parts.join(',')}`;
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
    '4. Criteria with action `building` are in flight — leave them; the daemon is on it.',
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
}

export interface ConductorPassResult {
  ran: boolean;
  reason: 'conductor-disabled' | 'no-actionable-mission' | 'target-not-actionable' | 'target-cleared' | 'building-wait' | 'criteria-escalated' | 'debounced' | 'conducted' | 'node-failed';
  /** How many serve-cap escalations this pass raised (0 unless a criterion hit the cap). */
  escalationsRaised?: number;
  missionId?: string;
  modelUsed?: string;
}

/** One conductor pass for a project. No-op (spends nothing) unless the toggle is on AND there is an
 *  approved+active mission with a NEW actionable state (a discover/verify gap the conductor hasn't
 *  already served at this exact fingerprint). */
export async function runConductorPass(project: string, deps: ConductorPassDeps = {}): Promise<ConductorPassResult> {
  const result = await runConductorPassInner(project, deps);
  setConductorLastPass(project, {
    missionId: result.missionId ?? null,
    reason: result.reason,
    tickAt: Date.now(),
  });
  return result;
}

async function runConductorPassInner(project: string, deps: ConductorPassDeps = {}): Promise<ConductorPassResult> {
  if (!getConductorEnabled(project)) return { ran: false, reason: 'conductor-disabled' };

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

  const criteriaWithActions = listCriteriaWithActions(project, missionId);
  const actions = criteriaWithActions.map((a) => ({ action: a.action, id: a.id }));
  // SERVE-CAP: a criterion that has burned CRITERION_SERVE_CAP serving epics and is still
  // unmet derives 'escalate' (not 'discover') — re-filing is thrash. Raise ONE human
  // escalation per such criterion, debounced against any already-open one. This runs BEFORE
  // the hasGap/no-op decision so a mission whose only gaps are capped never spends a node.
  const escalated = criteriaWithActions.filter((a) => a.action === 'escalate');
  let escalationsRaised = 0;
  if (escalated.length > 0) {
    const createEsc = deps.createEscalation ?? createEscalation;
    const listOpen = deps.listOpenEscalations ?? listOpenEscalations;
    // Fail-open: an escalation-store hiccup must NEVER break the pass.
    let open: Escalation[] = [];
    try { open = listOpen(); } catch { open = []; }
    for (const c of escalated) {
      try {
        const marker = serveCapMarker(c.id);
        const already = open.some((e) =>
          e.status === 'open' && e.kind === CRITERION_SERVE_CAP_KIND &&
          e.project === project && e.todoId === missionId && e.questionText.includes(marker));
        if (already) continue;
        createEsc({
          project,
          session,
          kind: CRITERION_SERVE_CAP_KIND,
          todoId: missionId,
          operatorGated: true,
          questionText:
            `Mission "${target.summary.node.title ?? missionId}" — criterion "${c.text}" ${marker}: ` +
            `${c.servedEpicCount} serving epics filed but the criterion is still unmet — it likely needs ` +
            `HUMAN action (a live measurement / deploy / rescope); the conductor will not re-file. ` +
            `Resolve or rescope this criterion.`,
        });
        escalationsRaised++;
      } catch {
        // fail-open per criterion — one bad card must not sink the rest of the pass.
      }
    }
  }

  const hasGap = actions.some((a) => a.action === 'discover' || a.action === 'verify');
  // A build-green epic surfaces an 'epic-ready-to-land' card while its criterion still reads
  // 'building' (unlanded) — the conductor must run to LAND it, not wait. (land_epic's ownership gate
  // ensures the node only lands THIS mission's epics.)
  const landCards = (() => { try { return (deps.listOpenEscalations ?? listOpenEscalations)().filter((e) => e.project === project && e.kind === 'epic-ready-to-land').length; } catch { return 0; } })();
  // No servable gap and no land card to drive: nothing for the node to do. A capped
  // ('escalate') criterion is NOT a servable gap — we already raised its human escalation
  // above and must NOT spend a node re-filing for it (the thrash this cap kills). Report
  // 'criteria-escalated' when the only remaining work is escalated, else fall through to the
  // building-wait (daemon working) no-op.
  if (!hasGap && landCards === 0) {
    if (escalated.length > 0) return { ran: false, reason: 'criteria-escalated', missionId, escalationsRaised };
    if (status === 'building') return { ran: false, reason: 'building-wait', missionId };
  }

  const fp = conductorFingerprint(status, actions) + `|land:${landCards}`;
  const lastKey = target.row.lastConductorKey;
  // A prior SUCCESSFUL pass on this exact state ⇒ debounce (unchanged behaviour).
  if (lastKey === fp) return { ran: false, reason: 'debounced', missionId };
  // A prior FAILED pass encodes `${fp}|fail:N`. Bug fix: a node FAILURE used to stamp the plain
  // fp and permanently wedge the mission (serve fails ⇒ 0 epics ⇒ state never moves ⇒ identical fp
  // ⇒ debounced forever). Now a failure retries up to CONDUCTOR_SERVE_RETRY_CAP times across ticks,
  // then stops respinning an expensive node on an unservable state (bounded, not a permanent wedge).
  const failPrefix = `${fp}|fail:`;
  const priorFails = lastKey && lastKey.startsWith(failPrefix) ? Number(lastKey.slice(failPrefix.length)) || 0 : 0;
  if (priorFails >= CONDUCTOR_SERVE_RETRY_CAP) return { ran: false, reason: 'debounced', missionId };

  const provider = resolveNodeProvider(project, 'conductor', CONDUCTOR_ALLOWED_TOOLS);
  const model = resolveNodeModel(project, 'conductor', provider, ORCHESTRATION_NODE_PROFILE.conductor.model);
  const effort: EffortLevel = resolveOrchestrationEffort(project, 'conductor');

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
  });

  // On SUCCESS, debounce this exact state (don't respin next tick). On FAILURE, stamp a bounded
  // fail-counter instead of the plain fp so the mission RETRIES (up to the cap above) rather than
  // wedging permanently on a transient node/planner failure.
  if (res.ok) {
    stampConductorRun(project, missionId, fp);
  } else {
    stampConductorRun(project, missionId, `${failPrefix}${priorFails + 1}`);
  }
  return { ran: true, reason: res.ok ? 'conducted' : 'node-failed', missionId, modelUsed: model, escalationsRaised };
}
