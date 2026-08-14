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
  if (esc.kind === REPAIR_MISSION_APPROVAL_KIND && esc.todoId) {
    try {
      const { applyRepairApprovalDecision } = await import('./repair-mission-pass.js');
      await applyRepairApprovalDecision(esc.project, esc.todoId, optionId ?? null,
        { actor: `human:repair-approval-card:${fullId}` });
    } catch (e) {
      console.warn(
        `[repair-approval] apply failed for mission ${esc.todoId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

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
