/**
 * Confirm/dismiss executor for inline Grok suggestions (Orch P2, level `propose`).
 *
 * Design: design-orch-p2-propose §2d. The human clicks Confirm/Dismiss on an
 * escalation card carrying a `suggestedAction`. This module is the server side:
 *
 *  - confirmSuggestion: re-derive the suggestion's proof through the SERVER PROOF
 *    GATE (validateStewardProof — never trusts Grok's classification as the act
 *    authority). On valid proof → apply the steward verb + resolve the escalation +
 *    audit. On absent/failed proof → NO mutation: re-route the escalation to the
 *    human with the failure reason, clear the suggestion (so the human acts plainly).
 *  - dismissSuggestion: clear the suggestion; the escalation stays open.
 *
 * Staleness guard (Grok consult #4): a suggestion generated on an older world-view
 * is rejected at confirm-time if the linked todo's revision changed since — the
 * human never confirms an outdated act; the suggestion is cleared and the plain
 * escalation re-surfaces.
 *
 * Fail-safe: a confirm NEVER mutates without a server-re-derived proof.
 */

import {
  getEscalation,
  setEscalationSuggestion,
  setEscalationRoute,
  resolveEscalation,
  recordSupervisorAudit,
} from './supervisor-store.ts';
import { getTodo, resetTodo, overrideAcceptTodo } from './todo-store.ts';
import { validateStewardProof, type StewardProof, type StewardVerb } from './steward-proof.ts';
import { getWebSocketHandler } from './ws-handler-manager.js';

export interface ConfirmResult {
  ok: boolean;
  /** 'applied' | 'no-escalation' | 'no-suggestion' | 'no-verb' | 'stale' | proof reason */
  reason: string;
}

/**
 * Confirm a suggestion: re-validate its proof, then apply the verb. The proof gate
 * is the authority — Grok's classification only chose WHICH suggestion to show.
 */
export async function confirmSuggestion(project: string, escalationId: string): Promise<ConfirmResult> {
  const esc = getEscalation(escalationId);
  if (!esc || esc.status !== 'open') return { ok: false, reason: 'no-escalation' };

  const s = esc.suggestedAction;
  if (!s) return { ok: false, reason: 'no-suggestion' };
  if (!s.verb) return { ok: false, reason: 'no-verb' }; // classify-only — nothing to apply
  if (!esc.todoId) return { ok: false, reason: 'no-todo' };

  const todo = getTodo(project, esc.todoId);
  if (!todo) {
    // Todo vanished — the suggestion is meaningless. Clear + re-surface plain.
    setEscalationSuggestion(escalationId, null);
    return { ok: false, reason: 'no-todo' };
  }

  // Staleness guard: the todo moved since the suggestion was generated.
  const seenUpdatedAt = (s.bundleInputs?.todoUpdatedAt as string | null) ?? null;
  if (seenUpdatedAt !== null && seenUpdatedAt !== todo.updatedAt) {
    setEscalationSuggestion(escalationId, null);
    recordSupervisorAudit({
      kind: 'classify',
      project,
      session: esc.session,
      detail: JSON.stringify({ source: 'triage-confirm', escalationId, reason: 'stale-discarded' }),
    });
    return { ok: false, reason: 'stale' };
  }

  const verb = s.verb as StewardVerb;
  const proof = (s.args?.proof as StewardProof | undefined) ?? undefined;

  // THE GATE: re-derive the proof from ground truth. Never trust the suggestion.
  const verdict = validateStewardProof(verb, proof, {
    project,
    dependsOn: todo.dependsOn ?? [],
    getDep: (id) => {
      const d = getTodo(project, id);
      return d ? { id: d.id, status: d.status, acceptanceStatus: d.acceptanceStatus } : null;
    },
  });

  if (!verdict.ok) {
    // No-proof / failed proof → NO mutation. Re-route to the human WITH the reason,
    // clear the suggestion so the human acts on the plain escalation.
    setEscalationRoute(escalationId, 'human', proof ? JSON.stringify(proof) : null);
    setEscalationSuggestion(escalationId, null);
    recordSupervisorAudit({
      kind: 'classify',
      project,
      session: esc.session,
      detail: JSON.stringify({ source: 'triage-confirm', escalationId, verb, reason: `proof-failed:${verdict.reason}` }),
    });
    return { ok: false, reason: verdict.reason };
  }

  // Proof green → apply the verb.
  if (verb === 'reset_todo') {
    const status = (s.args?.status as 'ready' | undefined) ?? 'ready';
    await resetTodo(project, esc.todoId, status);
  } else {
    await overrideAcceptTodo(project, esc.todoId, 'orchestrator');
  }

  resolveEscalation(escalationId, 'resolved', 'ai'); // steward auto-resolve (fd934fb7)
  setEscalationSuggestion(escalationId, null);
  recordSupervisorAudit({
    kind: verb === 'reset_todo' ? 'reconcile' : 'override',
    project,
    session: esc.session,
    detail: JSON.stringify({
      source: 'triage-confirm',
      escalationId,
      todoId: esc.todoId,
      verb,
      bucket: s.bucket,
      confidence: s.confidence,
      bundleInputs: s.bundleInputs,
    }),
  });
  // Drive narration: broadcast the autonomous decision live so the EventStream shows
  // WHAT drive resolved and WHY (observational only — audit above stays authoritative).
  getWebSocketHandler()?.broadcast({
    type: 'drive.auto_resolved',
    project,
    todoId: esc.todoId,
    escalationId,
    verb,
    bucket: s.bucket,
    confidence: s.confidence,
    reason: s.rationale || undefined,
  });
  return { ok: true, reason: 'applied' };
}

/** Dismiss a suggestion: clear it; the escalation stays open for the human. */
export function dismissSuggestion(project: string, escalationId: string): ConfirmResult {
  const esc = getEscalation(escalationId);
  if (!esc) return { ok: false, reason: 'no-escalation' };
  if (!esc.suggestedAction) return { ok: false, reason: 'no-suggestion' };
  setEscalationSuggestion(escalationId, null);
  recordSupervisorAudit({
    kind: 'classify',
    project,
    session: esc.session,
    detail: JSON.stringify({ source: 'triage-dismiss', escalationId }),
  });
  return { ok: true, reason: 'dismissed' };
}
