/**
 * Triage pass for the Orchestrator daemon — runs at level `on` and above.
 *
 * Design: design-orch-p2-propose (legacy doc name). Runs at `on`+, AFTER the
 * deterministic reconcile pass has auto-closed the cheap buckets. For each UNDECIDED
 * open escalation it asks the triage classifier to classify (single-shot,
 * grok-triage.ts; the model is a swappable tier-role) and writes the verdict INLINE
 * on the escalation as a `suggestedAction` — NOT a separate queue. Nothing acts
 * autonomously at `on`: the human confirms/dismisses on the card, and a confirm
 * re-validates through the server proof gate. Only `auto` auto-resolves.
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
  setEscalationTriageInFlight,
  getEscalation,
  recordSupervisorAudit,
  type Escalation,
} from './supervisor-store.ts';
import { classifyEscalation, AUTO_RESOLVE_MIN_CONFIDENCE, type TriageDeps } from './grok-triage.ts';
import { confirmSuggestion } from './triage-execute.ts';
import { landEpic, type LandEpicOutcome } from './coordinator-live.ts';
import { getTodo } from './todo-store.ts';
import { getWebSocketHandler } from './ws-handler-manager.js';

/** Max Grok classifications per project per tick. Keeps a backlog from fanning out
 *  cost; the remainder are picked up on subsequent ticks. */
export const TRIAGE_CAP = 3;

/** Phase 3 (drive): max UNATTENDED auto-resolutions per project per tick. A hard
 *  ceiling on silent autonomy — the rest wait for a human or the next tick. */
export const AUTO_RESOLVE_CAP = 2;

/** Drive: max UNATTENDED epic lands per project per tick. Landing mutates master
 *  (irreversible), so cap it tightly — the rest wait for the next tick. */
export const EPIC_LAND_CAP = 2;

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
  // 'epic-ready-to-land' is handled by the deterministic drive auto-land path
  // (runDriveLandPass) — landing is a proof, not a judgment, so Grok never sees it.
  if (esc.kind === 'epic-ready-to-land') return false;
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
  /** Level `auto`: when true, the pass also AUTO-resolves the high-confidence
   *  actionable suggestions it writes, unattended, behind the proof gate +
   *  AUTO_RESOLVE_CAP. False (level `on`) → write-only, human confirms. */
  autoResolve?: boolean;
  /** A3 (crit_f1404796_8): per-escalation predicate — true iff THIS escalation may auto-resolve
   *  (its todo chain resolves to an active-mission epic). All non-mission escalations stay
   *  SUGGEST. Defaults to () => false (opt-in). OR'd with the legacy blanket `autoResolve`. */
  autoResolveScope?: (esc: Escalation) => boolean;
  /** Confirm executor (defaults to the real proof-gated confirm). Injectable so the
   *  auto-resolve path is unit-testable without shelling out to git/tsc. */
  confirm?: (project: string, escalationId: string) => Promise<{ ok: boolean; reason: string }>;
  /** Drive auto-land executor (defaults to the real proof-gated landEpic). Injectable
   *  for unit tests so the land path doesn't shell out to git. */
  landEpic?: (project: string, escalationId: string) => Promise<LandEpicOutcome>;
}

/**
 * Drive-only deterministic auto-land (decision 647beb2b). At level=drive the orchestrator
 * passes autoResolve=true; for each open 'epic-ready-to-land' card (up to EPIC_LAND_CAP)
 * we call landEpic, which RE-DERIVES the full proof server-side (children done+accepted,
 * tsc clean in the epic worktree, clean dry --no-ff merge) and is self-gating — a conflict
 * leaves master UNTOUCHED and re-surfaces a human-rebase card. NOT Grok-classified:
 * landing is a proof, not a judgment. Below drive this is never called, so the card waits
 * for the human LAND button. Fail-open per card: a throw never aborts the rest.
 */
export async function runDriveLandPass(project: string, deps: TriagePassDeps = {}): Promise<void> {
  const listOpen = deps.listOpen ?? listOpenEscalations;
  const land = deps.landEpic ?? landEpic;
  const cards = listOpen()
    .filter((e) => e.project === project && e.status === 'open' && e.kind === 'epic-ready-to-land')
    .slice(0, EPIC_LAND_CAP);
  for (const esc of cards) {
    try {
      const result = await land(project, esc.id);
      recordSupervisorAudit({
        kind: result.landed ? 'reconcile' : 'classify',
        project,
        session: esc.session,
        detail: JSON.stringify({
          source: 'triage-auto-land', // the "what did drive land" review surface
          escalationId: esc.id,
          todoId: esc.todoId,
          landed: result.landed,
          conflict: result.conflict ?? false,
          masterSha: result.masterSha,
          reason: result.reason,
        }),
      });
      // Drive narration: broadcast the autonomous land decision live so the
      // EventStream shows what drive landed (or why it left a conflict for a human).
      getWebSocketHandler()?.broadcast({
        type: 'drive.auto_landed',
        project,
        escalationId: esc.id,
        epicId: result.epicId,
        epicBranch: result.epicBranch,
        landed: result.landed,
        conflict: result.conflict ?? false,
        masterSha: result.masterSha,
        reason: result.reason,
      });
    } catch (err) {
      console.warn(
        `[triage-pass] auto-land failed for ${esc.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
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
  const autoResolveScope = deps.autoResolveScope ?? (() => false);

  // Drive-only: land ready epics deterministically FIRST (decision 647beb2b), before
  // spending Grok on the remaining blocker/question cards. Self-gated by landEpic; a
  // no-op below drive (autoResolve false) where the human clicks LAND instead.
  if (deps.autoResolve) {
    await runDriveLandPass(project, deps);
  }

  const open = listOpen().filter((e) => e.project === project);
  const eligible = open.filter((e) => isTriageEligible(e, getTodoRevision));

  if (eligible.length === 0) return;

  const batch = eligible.slice(0, TRIAGE_CAP);
  if (eligible.length > TRIAGE_CAP) {
    console.info(
      `[triage-pass] ${project}: ${eligible.length} eligible escalations, classifying ${TRIAGE_CAP} this tick (cap)`,
    );
  }

  const confirm = deps.confirm ?? confirmSuggestion;
  let autoResolved = 0; // per-tick auto-resolution budget (AUTO_RESOLVE_CAP)

  // Broadcast an escalation's current state as an upsert (fd934fb7). Reuses the
  // existing escalation_created event — the UI folds it into openEscalations by id
  // (ingestEscalationCreated) — so no NEW WS event is introduced (constraint
  // b2fe36b1). Best-effort: a missing handler or a since-deleted escalation no-ops.
  const broadcastEsc = (id: string, session: string, kind: string) => {
    try {
      const full = getEscalation(id);
      if (!full) return;
      getWebSocketHandler()?.broadcast({
        type: 'escalation_created',
        project,
        session,
        kind,
        id,
        routedTo: full.routedTo,
        escalation: full,
      });
    } catch { /* best-effort live refresh; never abort the pass */ }
  };

  for (const esc of batch) {
    // Lifecycle: show "Grok is triaging…" for the duration of the consult. Flip the
    // in-flight flag ON + broadcast before the await, and guarantee it clears in a
    // finally so a classify throw can't strand a spinner.
    setEscalationTriageInFlight(esc.id, true);
    broadcastEsc(esc.id, esc.session, esc.kind);
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

      // Phase 3 (drive): auto-resolve a high-confidence actionable suggestion,
      // unattended — but only behind the proof gate (confirm re-derives the proof,
      // so a wrong classification still cannot mutate state) and within the per-tick
      // cap. Anything not auto-resolved stays as an inline suggestion (propose).
      const mayAutoResolve = Boolean(deps.autoResolve) || autoResolveScope(esc);
      if (
        mayAutoResolve &&
        suggestion.verb &&
        suggestion.confidence >= AUTO_RESOLVE_MIN_CONFIDENCE &&
        autoResolved < AUTO_RESOLVE_CAP
      ) {
        autoResolved++;
        const result = await confirm(project, esc.id);
        recordSupervisorAudit({
          kind: result.ok ? (suggestion.verb === 'override_accept_todo' ? 'override' : 'reconcile') : 'classify',
          project,
          session: esc.session,
          detail: JSON.stringify({
            source: 'triage-auto', // the "what did I auto-resolve" review surface
            escalationId: esc.id,
            verb: suggestion.verb,
            bucket: suggestion.bucket,
            confidence: suggestion.confidence,
            applied: result.ok,
            reason: result.reason,
          }),
        });
      }
    } catch (err) {
      // Per-escalation fail-open: log, continue with the rest.
      console.warn(
        `[triage-pass] classify failed for ${esc.id}:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      // Consult done (resolved, suggested, or failed) — clear the spinner and
      // broadcast the escalation's post-triage state (suggestion attached, or
      // resolved/closed). An auto-resolved escalation is no longer open, so the
      // broadcast carries its terminal state for the lingering AI-resolved card.
      setEscalationTriageInFlight(esc.id, false);
      broadcastEsc(esc.id, esc.session, esc.kind);
    }
  }
}
