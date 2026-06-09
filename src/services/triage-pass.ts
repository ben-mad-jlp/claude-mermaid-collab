/**
 * Grok triage pass for the Orchestrator daemon (Orch P2, level `propose`).
 *
 * Design: design-orch-p2-propose. Runs at level >= propose, AFTER the deterministic
 * reconcile pass has auto-closed the cheap buckets. For each UNDECIDED open
 * escalation it asks Grok to classify (single-shot, grok-triage.ts) and writes the
 * verdict INLINE on the escalation as a `suggestedAction` — NOT a separate queue.
 * Nothing acts autonomously at `propose`: the human confirms/dismisses on the card,
 * and a confirm re-validates through the server proof gate.
 *
 * Bounded + fail-open:
 *  - Skips human-floor kinds (approval/decision/assumption-invalidated/operator-gated)
 *    and the fail-open sentinel — never spends Grok on what only a human decides.
 *  - Skips escalations whose existing suggestion is still FRESH (todo revision
 *    unchanged) — no re-spend on a re-tick (Grok's cost #3 / staleness #4).
 *  - Caps Grok classifications per project per tick (TRIAGE_CAP); the rest wait for
 *    the next tick. Logs the cap (no silent truncation).
 *  - A classify error for one escalation never aborts the pass for the others, and
 *    a triage failure never blocks build/reconcile (the daemon try/catches the pass).
 */

import {
  listOpenEscalations,
  setEscalationSuggestion,
  recordSupervisorAudit,
  type Escalation,
} from './supervisor-store.ts';
import { classifyEscalation, type TriageDeps } from './grok-triage.ts';
import { getTodo } from './todo-store.ts';

/** Max Grok classifications per project per tick. Keeps a backlog from fanning out
 *  cost; the remainder are picked up on subsequent ticks. */
export const TRIAGE_CAP = 3;

/** Escalation kinds only a human decides — never sent to Grok (fail-open to human). */
const HUMAN_FLOOR_KINDS = new Set(['approval', 'decision', 'assumption-invalidated', 'operator-gated']);

/** The fail-open summary escalation's sentinel session (skip — it's a human signal). */
const FAILOPEN_SESSION = '__steward_failopen__';

/**
 * True when an escalation already carries a suggestion that is still FRESH — i.e.
 * the linked todo's revision (updatedAt) is unchanged since the suggestion was
 * generated. A fresh suggestion is not re-classified (no re-spend); a stale one
 * (todo moved on) is re-classified so the human never confirms an outdated act.
 */
export function isSuggestionFresh(
  esc: Escalation,
  getTodoFn: (project: string, id: string) => { updatedAt: string } | null,
): boolean {
  const s = esc.suggestedAction;
  if (!s) return false;
  // No linked todo → nothing to go stale against; treat as fresh (don't re-spend).
  if (!esc.todoId) return true;
  const todo = getTodoFn(esc.project, esc.todoId);
  if (!todo) return true; // todo gone — re-classifying won't help; leave the suggestion
  return (s.bundleInputs?.todoUpdatedAt ?? null) === todo.updatedAt;
}

/** Whether an escalation is eligible for Grok triage this tick. */
export function isTriageEligible(
  esc: Escalation,
  getTodoFn: (project: string, id: string) => { updatedAt: string } | null,
): boolean {
  if (esc.status !== 'open') return false;
  if (esc.session === FAILOPEN_SESSION) return false;
  if (HUMAN_FLOOR_KINDS.has(esc.kind)) return false;
  if (esc.operatorGated) return false;
  if (isSuggestionFresh(esc, getTodoFn)) return false;
  return true;
}

export interface TriagePassDeps extends TriageDeps {
  /** Open escalations (defaults to the store). */
  listOpen?: () => Escalation[];
  /** Write the suggestion inline (defaults to the store). */
  setSuggestion?: typeof setEscalationSuggestion;
  /** Todo revision lookup for freshness (defaults to todo-store). */
  getTodoRevision?: (project: string, id: string) => { updatedAt: string } | null;
}

/**
 * Run one Grok triage pass for a project. Classifies up to TRIAGE_CAP undecided open
 * escalations and writes inline suggestions. Pure-ish: all IO behind deps.
 */
export async function runTriagePass(project: string, deps: TriagePassDeps = {}): Promise<void> {
  const listOpen = deps.listOpen ?? listOpenEscalations;
  const setSuggestion = deps.setSuggestion ?? setEscalationSuggestion;
  const getTodoRevision =
    deps.getTodoRevision ?? ((p: string, id: string) => {
      const t = getTodo(p, id);
      return t ? { updatedAt: t.updatedAt } : null;
    });

  const open = listOpen().filter((e) => e.project === project);
  const eligible = open.filter((e) => isTriageEligible(e, getTodoRevision));

  if (eligible.length === 0) return;

  const batch = eligible.slice(0, TRIAGE_CAP);
  if (eligible.length > TRIAGE_CAP) {
    console.info(
      `[triage-pass] ${project}: ${eligible.length} eligible escalations, classifying ${TRIAGE_CAP} this tick (cap)`,
    );
  }

  for (const esc of batch) {
    try {
      const suggestion = await classifyEscalation(project, esc, deps);
      if (!suggestion) continue; // fail-open: no suggestion, human sees plain escalation
      setSuggestion(esc.id, suggestion);
      recordSupervisorAudit({
        kind: 'classify',
        project,
        session: esc.session,
        detail: JSON.stringify({
          source: 'triage-pass',
          escalationId: esc.id,
          bucket: suggestion.bucket,
          verb: suggestion.verb,
          confidence: suggestion.confidence,
        }),
      });
    } catch (err) {
      // Per-escalation fail-open: log, continue with the rest.
      console.warn(
        `[triage-pass] classify failed for ${esc.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
