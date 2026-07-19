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
import { getConductorEnabled, getConductorTargetMission, setConductorTargetMission, listOpenEscalations } from './supervisor-store.js';
import {
  listMissions,
  getMission,
  listCriteriaWithActions,
  stampConductorRun,
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
  action: 'met' | 'building' | 'verify' | 'discover';
  id: string;
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
}

export interface ConductorPassResult {
  ran: boolean;
  reason: 'conductor-disabled' | 'no-actionable-mission' | 'target-not-actionable' | 'target-cleared' | 'building-wait' | 'debounced' | 'conducted' | 'node-failed';
  missionId?: string;
  modelUsed?: string;
}

/** One conductor pass for a project. No-op (spends nothing) unless the toggle is on AND there is an
 *  approved+active mission with a NEW actionable state (a discover/verify gap the conductor hasn't
 *  already served at this exact fingerprint). */
export async function runConductorPass(project: string, deps: ConductorPassDeps = {}): Promise<ConductorPassResult> {
  if (!getConductorEnabled(project)) return { ran: false, reason: 'conductor-disabled' };

  // The approved + active, non-terminal, actionable mission. (One active mission per session; drive
  // the first that qualifies.) getMission gives the authoritative derived status + awaitingApprovalSince.
  const pin = getConductorTargetMission(project);
  let target: { summary: ReturnType<typeof listMissions>[number]; row: NonNullable<ReturnType<typeof getMission>> } | undefined;

  if (pin == null) {
    // No pin: back-compat first-active+actionable selection (unchanged behavior).
    for (const summary of listMissions(project).filter((m) => m.mission.active)) {
      const row = getMission(project, summary.node.id);
      if (row && row.awaitingApprovalSince == null && row.status != null &&
          !['unapproved', 'abandoned', 'converged'].includes(row.status)) {
        target = { summary, row };
        break;
      }
    }
    if (!target) return { ran: false, reason: 'no-actionable-mission' };
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

  const actions = listCriteriaWithActions(project, missionId).map((a) => ({ action: a.action, id: a.id }));
  const hasGap = actions.some((a) => a.action === 'discover' || a.action === 'verify');
  // A build-green epic surfaces an 'epic-ready-to-land' card while its criterion still reads
  // 'building' (unlanded) — the conductor must run to LAND it, not wait. (land_epic's ownership gate
  // ensures the node only lands THIS mission's epics.)
  const landCards = (() => { try { return listOpenEscalations().filter((e) => e.project === project && e.kind === 'epic-ready-to-land').length; } catch { return 0; } })();
  // 'building' with no gap AND no land card = the daemon is working; nothing to direct — wait.
  if (!hasGap && landCards === 0 && status === 'building') return { ran: false, reason: 'building-wait', missionId };

  const fp = conductorFingerprint(status, actions) + `|land:${landCards}`;
  if (target.row.lastConductorKey === fp) return { ran: false, reason: 'debounced', missionId };

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

  // Stamp the fingerprint whether or not the node succeeded: we spent the pass on THIS state, so we
  // won't respin on the identical state next tick. A node failure retries once state (or the node) moves.
  stampConductorRun(project, missionId, fp);
  return { ran: true, reason: res.ok ? 'conducted' : 'node-failed', missionId, modelUsed: model };
}
