/**
 * escalationLifecycle — the single, PURE classifier for an escalation's triage
 * lifecycle state (epic d5b1ff4e / todo fd934fb7).
 *
 * USER PAIN this fixes: at level=propose/drive an escalation appears, then Grok's
 * consult appears, then it just DISAPPEARS — with no signal whether the AI HANDLED
 * it (auto-resolved) or TRIED and gave up (escalated to the human). This module
 * maps the facts the server already carries on an Escalation (status, routedTo,
 * stewardAttempts, suggestedAction, triageInFlight, resolvedBy) to one explicit
 * lifecycle state, so BOTH surfaces (left column + Bridge) render the same badge
 * for the same escalation (coherence design §1: same input + same pure fn ⇒ same
 * output).
 *
 * INVARIANT: pure. No store/React imports. Input is one Escalation; output is one
 * state. This is what makes left-column ⇄ Bridge agreement provable.
 */

import type { Escalation } from '@/stores/supervisorStore';

/**
 * The triage lifecycle of an escalation. Exactly one applies at any instant.
 *
 *  - `open`               — raised, not yet triaged (no AI signal, no human routing).
 *  - `ai-handling`        — a Grok triage consult is IN FLIGHT (show a spinner; keep
 *                           the escalation visible).
 *  - `ai-suggested`       — Grok classified it (propose level): a suggestedAction is
 *                           attached, awaiting the human's confirm/dismiss. Still open.
 *  - `escalated-to-human` — Grok TRIED and routed it to the human (it could not
 *                           auto-resolve). Still open, clearly "needs you".
 *  - `ai-resolved`        — the steward auto-resolved it (drive). Terminal; show the
 *                           outcome + rationale briefly instead of vanishing.
 *  - `human-resolved`     — a person resolved/decided it. Terminal.
 */
export type EscalationLifecycle =
  | 'open'
  | 'ai-handling'
  | 'ai-suggested'
  | 'escalated-to-human'
  | 'ai-resolved'
  | 'human-resolved';

/** True when the escalation is still open (in the active inbox). */
function isOpen(e: Escalation): boolean {
  return e.status === 'open';
}

/**
 * Classify an escalation into its single lifecycle state. Order matters: a more
 * specific signal wins (in-flight > suggested/escalated > untriaged; explicit
 * resolvedBy > heuristic for the terminal split).
 */
export function classifyEscalationLifecycle(e: Escalation): EscalationLifecycle {
  if (isOpen(e)) {
    // In-flight Grok consult — the visible "AI is handling this" window.
    if (e.triageInFlight) return 'ai-handling';
    // Grok tried and routed it on to the human (routedTo flip, or it burned a
    // steward attempt without auto-resolving). This is the "AI couldn't resolve —
    // needs you" terminal-for-AI but still-open-for-human state.
    if (e.routedTo === 'steward' || (e.stewardAttempts ?? 0) > 0) return 'escalated-to-human';
    // Grok classified it (propose): a suggestion awaits the human's confirm.
    if (e.suggestedAction) return 'ai-suggested';
    // Raised, untouched by triage.
    return 'open';
  }

  // Terminal (no longer open). Prefer the server's explicit resolver; fall back to
  // a heuristic for payloads written before resolvedBy existed: an escalation that
  // carried a Grok suggestion AND burned a steward attempt was almost certainly the
  // steward's auto-resolve.
  if (e.resolvedBy === 'ai') return 'ai-resolved';
  if (e.resolvedBy === 'human') return 'human-resolved';
  if (e.suggestedAction && (e.stewardAttempts ?? 0) > 0) return 'ai-resolved';
  return 'human-resolved';
}

/** True for the in-flight Grok-triage state (show a spinner). */
export function isTriaging(e: Escalation): boolean {
  return classifyEscalationLifecycle(e) === 'ai-handling';
}

/** True when the AI tried and handed the escalation to the human (needs-you flag). */
export function isEscalatedToHuman(e: Escalation): boolean {
  return classifyEscalationLifecycle(e) === 'escalated-to-human';
}

/** True when the steward auto-resolved the escalation (terminal AI outcome). */
export function isAiResolved(e: Escalation): boolean {
  return classifyEscalationLifecycle(e) === 'ai-resolved';
}

/** Default window for which an AI-resolved escalation lingers (shows its outcome)
 *  before it ages out of the inbox. */
export const AI_RESOLVED_LINGER_MS = 90_000;

/**
 * From the resolved slice, the AI-resolved escalations whose resolution is recent
 * enough to still show in the inbox (so an auto-resolved escalation displays its
 * outcome + rationale briefly instead of silently vanishing — fd934fb7). Pure: the
 * caller passes `now` and the optional window. Scoped/sorted newest-first.
 */
export function selectRecentlyAiResolved(
  resolved: Escalation[],
  now: number,
  windowMs: number = AI_RESOLVED_LINGER_MS,
): Escalation[] {
  return resolved
    .filter((e) => isAiResolved(e) && typeof e.resolvedAt === 'number' && now - (e.resolvedAt as number) <= windowMs)
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
}

/** Human-facing label + a stable token for styling/testids, per lifecycle state. */
export interface LifecyclePresentation {
  /** Stable token for data-testid / class selection. */
  token: EscalationLifecycle;
  /** Short label for a badge. */
  label: string;
  /** Whether to show an in-progress spinner. */
  spinner: boolean;
}

export function lifecyclePresentation(e: Escalation): LifecyclePresentation {
  const token = classifyEscalationLifecycle(e);
  switch (token) {
    case 'ai-handling':
      return { token, label: 'AI is triaging…', spinner: true };
    case 'ai-suggested':
      return { token, label: 'AI suggested', spinner: false };
    case 'escalated-to-human':
      return { token, label: 'Needs you — AI couldn’t resolve', spinner: false };
    case 'ai-resolved':
      return { token, label: 'AI resolved', spinner: false };
    case 'human-resolved':
      return { token, label: 'Resolved', spinner: false };
    case 'open':
    default:
      return { token: 'open', label: 'Open', spinner: false };
  }
}
