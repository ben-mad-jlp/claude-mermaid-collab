/**
 * conductor-card-triage-arm — the conductor's deterministic PARK arm for repeatedly-failing
 * carded leaves.
 *
 * A leaf that has been attempted CARD_TRIAGE_PARK_ATTEMPTS times and still carries an open
 * blocker escalation is a stuck loop: re-dispatching it again spends another node for no
 * expected gain. This arm parks it (`resetTodo` → 'blocked') deterministically, BEFORE any
 * conductor node is invoked — zero node spend. It replaces the same threshold the conductor's
 * own prompt used to ask the LLM to enforce (conductor-pass.ts `buildConductorPrompt`,
 * retired bullet); the check now lives in code, not prose.
 *
 * `resetTodo` (todo-store.ts) unconditionally auto-resolves every open escalation on the
 * target todo as a side effect, regardless of the status it is reset to. Parking to 'blocked'
 * would silently close the very card this arm exists to leave open for the human — so this
 * arm immediately re-opens the card via `reopenEscalation` after the reset.
 *
 * Fail OPEN, per item and outermost: a throw anywhere in one escalation's handling lands it
 * in `skipped`; a fault reading the store (or any unexpected throw) at the top level yields
 * `{ parked: [], skipped: [] }`, matching conductor-verify-panel-arm.ts's discipline.
 */
import { listTodos, resetTodo, type Todo } from './todo-store.js';
import { listOpenEscalations, reopenEscalation, type Escalation } from './supervisor-store.js';
import { getLeafRun } from './ledger-stats.js';
import { CARD_TRIAGE_PARK_ATTEMPTS } from './harness-caps.js';

export interface CardTriageArmDeps {
  listOpenEscalations?: typeof listOpenEscalations;
  getLeafRun?: typeof getLeafRun;
  resetTodo?: typeof resetTodo;
  reopenEscalation?: typeof reopenEscalation;
}

export interface CardTriageArmResult {
  /** todoIds parked to 'blocked' this pass, with their open card restored. */
  parked: string[];
  /** todoIds considered but not parked (below threshold, or a per-item fault). */
  skipped: string[];
}

/**
 * Confirm `todoId` is a live descendant of `missionId` by walking `parentId` up via
 * `listTodos(project, { includeCompleted: true })`. Bounded by a visited-set so a cyclic
 * parent edge cannot spin the walk forever (mirrors the cycle guard at conductor-pass.ts:88).
 */
function isMissionMember(project: string, todoId: string, missionId: string): boolean {
  const all = listTodos(project, { includeCompleted: true });
  const byId = new Map<string, Todo>();
  for (const t of all) byId.set(t.id, t);
  const visited = new Set<string>();
  let cur: string | null = todoId;
  while (cur != null) {
    if (cur === missionId) return true;
    if (visited.has(cur)) return false;
    visited.add(cur);
    const todo = byId.get(cur);
    if (!todo) return false;
    cur = todo.parentId ?? null;
  }
  return false;
}

/**
 * Run the card-triage arm for one mission: park every leaf whose blocker escalation is open
 * and whose attempts have reached CARD_TRIAGE_PARK_ATTEMPTS, restoring the card afterward.
 *
 * @param project — The project tracking root.
 * @param missionId — The mission whose open cards to triage.
 * @param session — The session context (accepted for shape parity; unused by this arm).
 * @param deps — Injectable IO. All default to live implementations.
 * @returns { parked, skipped } — todo ids bucketed by outcome.
 */
export async function runCardTriageArm(
  project: string,
  missionId: string,
  session: string,
  deps: CardTriageArmDeps = {},
): Promise<CardTriageArmResult> {
  const parked: string[] = [];
  const skipped: string[] = [];
  try {
    const listOpen = deps.listOpenEscalations ?? listOpenEscalations;
    const cards: Escalation[] = listOpen();
    const candidates = cards.filter(
      (e) => e.project === project && e.status === 'open' && e.todoId != null && e.todoId !== missionId,
    );

    const byTodoId = new Map<string, Escalation>();
    for (const card of candidates) {
      const todoId = card.todoId as string;
      if (!byTodoId.has(todoId)) byTodoId.set(todoId, card);
    }

    for (const [todoId, card] of byTodoId) {
      if (!isMissionMember(project, todoId, missionId)) continue;
      try {
        const getRun = deps.getLeafRun ?? getLeafRun;
        const run = getRun(todoId);
        if (run == null || run.attempts < CARD_TRIAGE_PARK_ATTEMPTS) {
          skipped.push(todoId);
          continue;
        }
        const reset = deps.resetTodo ?? resetTodo;
        await reset(project, todoId, 'blocked');
        const reopen = deps.reopenEscalation ?? reopenEscalation;
        reopen(card.id);
        parked.push(todoId);
      } catch {
        skipped.push(todoId);
      }
    }
    return { parked, skipped };
  } catch {
    return { parked: [], skipped: [] };
  }
}
