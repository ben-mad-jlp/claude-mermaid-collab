import {
  getEscalation,
  resolveEscalationShortId,
  recordEscalationDecision,
  resolveEscalation,
  type Escalation,
  type EscalationDecision,
} from './supervisor-store.ts';
import { applyRebetDecision, OVER_BUDGET_REBET_KIND } from './mission-budget-gate.ts';
import { REPAIR_MISSION_APPROVAL_KIND } from './repair-mission-pass.ts';
import { getWebSocketHandler } from './ws-handler-manager.ts';

/**
 * Result type for decideEscalation: typed refusal (never throws).
 */
export type DecideEscalationResult =
  | { ok: true; decision: EscalationDecision; escalation: Escalation }
  | { ok: false; reason: 'not-found' | 'missing-option' | 'invalid-option' | 'ambiguous-id'; message: string };

/**
 * Maps a CANONICAL escalation status (a member of ESCALATION_STATUSES,
 * supervisor-store.ts:886, e.g. the output of normalizeEscalationStatus) to the
 * repair-mission-approval decision it implies.
 *
 * 'resolved' → approve (a bare resolve with no optionId is read as acceptance).
 * 'stale' | 'obsolete' | 'superseded' → dismiss (the card is being cleared away).
 * Everything else (including 'acknowledged', 'open', 'decided', 'linear') → null,
 * meaning "no repair-approval effect for this status".
 */
export function repairApprovalDecisionFromStatus(status: string): 'approve' | 'dismiss' | null {
  if (status === 'resolved') return 'approve';
  if (status === 'stale' || status === 'obsolete' || status === 'superseded') return 'dismiss';
  return null;
}

/**
 * Applies a repair-mission-approval card's decision to its subject mission, if
 * applicable. No-ops unless `esc` is a repair-mission-approval card with a todoId
 * and a non-null decision. Fail-open: an apply fault is caught and warned, never
 * thrown, so it can never turn a successful escalation resolution into an error.
 *
 * This is the ONLY place that applies a repair-mission-approval card's effect;
 * the approval/closure logic itself lives solely in applyRepairApprovalDecision
 * (repair-mission-pass.ts), whose 'approve' arm reaches approveMissionAndConstitution
 * (mcp/tools/mission-forge.ts) — the same choke point approve_mission uses.
 */
export async function applyCardKindResolution(
  esc: Escalation,
  decision: 'approve' | 'dismiss' | null,
  fullId: string,
): Promise<void> {
  if (esc.kind !== REPAIR_MISSION_APPROVAL_KIND || !esc.todoId || decision === null) return;
  try {
    const { applyRepairApprovalDecision } = await import('./repair-mission-pass.js');
    await applyRepairApprovalDecision(esc.project, esc.todoId, decision,
      { actor: `human:repair-approval-card:${fullId}` });
  } catch (e) {
    console.warn(
      `[repair-approval] apply failed for mission ${esc.todoId}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Shared escalation decision service.
 *
 * Records a human's answer to a (structured) escalation and resolves it.
 * Fixes the short-id resolution bug: resolves the id to a full id BEFORE
 * any lookup, so decisions are recorded under the full id even when the
 * caller answers with a short id.
 *
 * @param id - escalation id (may be a short id)
 * @param input - { optionId?, note?, decidedBy? }
 * @returns typed result: success with decision + escalation, or typed failure
 */
export async function decideEscalation(
  id: string,
  input: { optionId?: string | null; note?: string | null; decidedBy?: string },
): Promise<DecideEscalationResult> {
  // Resolve short id to full id BEFORE any read/write.
  // Try exact match first (cheap); if not found, try short-id resolution.
  let fullId = id;
  let esc = getEscalation(id);
  if (!esc) {
    let resolved: string | null;
    try {
      resolved = resolveEscalationShortId(id);
    } catch (e) {
      return {
        ok: false,
        reason: 'ambiguous-id',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    if (!resolved) {
      return {
        ok: false,
        reason: 'not-found',
        message: `escalation not found: ${id}`,
      };
    }
    fullId = resolved;
    esc = getEscalation(fullId);
    if (!esc) {
      return {
        ok: false,
        reason: 'not-found',
        message: `escalation not found: ${id}`,
      };
    }
  }

  // Validate optionId when escalation has structured options.
  const { optionId } = input;
  if (esc.options && esc.options.length > 0) {
    if (!optionId) {
      return {
        ok: false,
        reason: 'missing-option',
        message: 'optionId is required for a structured escalation',
      };
    }
    if (!esc.options.some((o) => o.id === optionId)) {
      return {
        ok: false,
        reason: 'invalid-option',
        message: `optionId "${optionId}" is not one of the escalation's options`,
      };
    }
  }

  // Record the decision under the full id.
  const decision = recordEscalationDecision({
    escalationId: fullId,
    optionId: optionId ?? null,
    note: input.note ?? null,
    decidedBy: input.decidedBy ?? 'human',
  });

  // Over-budget re-bet: 'raise' is the one option the machine can APPLY.
  // Fail-open: a budget-apply fault must never lose the human's recorded decision.
  if (esc.kind === OVER_BUDGET_REBET_KIND && esc.todoId) {
    try {
      applyRebetDecision(esc.project, esc.todoId, optionId ?? null, {
        actor: 'human:rebet-card',
        reason: `over-budget re-bet decision on escalation ${fullId}`,
      });
    } catch (e) {
      console.warn(
        `[rebet] budget raise failed for mission ${esc.todoId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Repair-mission approval: approve or dismiss the forged mission.
  // Fail-open: an apply fault must never lose the human's recorded decision.
  await applyCardKindResolution(esc, (optionId ?? null) as 'approve' | 'dismiss' | null, fullId);

  // Resolve the escalation and broadcast.
  resolveEscalation(fullId, 'decided', 'human');
  getWebSocketHandler()?.broadcast({
    type: 'escalation_decided',
    project: esc.project,
    session: esc.session,
    id: fullId,
    optionId: decision.optionId,
  });

  return { ok: true, decision, escalation: esc };
}
