/**
 * conductor-land-arm — the conductor's deterministic LANDING arm.
 *
 * A green `epic-ready-to-land` card carries no judgment: the epic is either provably
 * landable (landReadiness green, conductor-actor ownership ok, every served criterion
 * carrying a recorded verdict) or it is not. Asking the conductor NODE to hunt the card
 * down and click it every pass spends an expensive model on arithmetic. This arm makes
 * the same decision in code, BEFORE any conductor node is invoked — zero node spend —
 * and drives the SAME authorized landing path (`landEpic`) the human Land button drives:
 * re-derive at click time, land mutex, `--no-ff` merge, teardown, card resolve.
 *
 * The SINGLE readiness proof is `landReadiness` (land-authority.ts). This arm never
 * inlines a second tsc/merge/gate/presence check — that proof is the one every actor
 * shares, and a fork of it here would be a second source of truth.
 *
 * Fail OPEN, per card and outermost: a throw handling one card lands it in `skipped`;
 * a fault reading the store (or any unexpected throw) at the top level yields
 * `{ landed: [], skipped: [] }`, matching conductor-verify-panel-arm.ts's discipline.
 * A `landEpic` refusal (dirty tree, stale proof, merge conflict) is likewise just a
 * `skipped` — the card it did NOT resolve stays open and the pass falls through to the
 * node exactly as it does today.
 */
import { listTodos, getTodo, type Todo } from './todo-store.js';
import { listOpenEscalations, type Escalation } from './supervisor-store.js';
import { LAND_CARD_KIND } from './conductor-signature.js';
import { checkOwnership, landReadiness } from './land-authority.js';
import { resolveEpicId } from './coordinator-live.js';
import { landEpic } from './coordinator-land.js';
import { listCriteriaWithActions } from './mission-store.js';

export interface LandArmDeps {
  listOpenEscalations?: typeof listOpenEscalations;
  checkOwnership?: typeof checkOwnership;
  landReadiness?: typeof landReadiness;
  listCriteriaWithActions?: typeof listCriteriaWithActions;
  landEpic?: typeof landEpic;
}

export interface LandArmResult {
  /** Escalation ids whose epic was landed this pass. */
  landed: string[];
  /** Escalation ids considered but not landed (not owned, not green, missing verdict,
   *  a landEpic refusal, or a per-card fault). Their cards stay open. */
  skipped: string[];
}

/**
 * Confirm `todoId` is a descendant of `missionId` by walking `parentId` over `all`.
 * Bounded by a visited-set so a cyclic parent edge cannot spin the walk forever
 * (mirrors conductor-card-triage-arm.ts:45-60).
 */
function isMissionMember(all: Todo[], todoId: string, missionId: string): boolean {
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
 * Run the land arm for one mission: land every open `epic-ready-to-land` card of this
 * mission whose epic re-proves green under the shared land-authority proof.
 *
 * @param project — The project tracking root.
 * @param missionId — The mission whose land cards to consider.
 * @param session — The conductor session, used as the land actor identity.
 * @param deps — Injectable IO. All default to live implementations.
 * @returns { landed, skipped } — escalation ids bucketed by outcome.
 */
export async function runConductorLandArm(
  project: string,
  missionId: string,
  session: string,
  deps: LandArmDeps = {},
): Promise<LandArmResult> {
  const landed: string[] = [];
  const skipped: string[] = [];
  try {
    const listOpen = deps.listOpenEscalations ?? listOpenEscalations;
    const cards: Escalation[] = listOpen().filter(
      (e) => e.project === project && e.status === 'open' && e.kind === LAND_CARD_KIND && e.todoId != null,
    );
    if (cards.length === 0) return { landed, skipped };

    const allTodos = listTodos(project, { includeCompleted: true });

    for (const card of cards) {
      const cardTodoId = card.todoId as string;
      if (!isMissionMember(allTodos, cardTodoId, missionId)) continue;
      try {
        const epicTodo = getTodo(project, cardTodoId);
        if (!epicTodo) {
          skipped.push(card.id);
          continue;
        }
        const epicId = resolveEpicId(epicTodo, project);

        // Ownership: the same conductor-actor gate the MCP land_epic handler applies
        // before landing on this actor's behalf (bucket epic / foreign or inactive mission).
        const ownership = (deps.checkOwnership ?? checkOwnership)(
          project,
          epicId,
          { kind: 'conductor', session },
          allTodos,
        );
        if (!ownership.ok) {
          skipped.push(card.id);
          continue;
        }

        // The SINGLE readiness proof — never a second inlined check.
        const readiness = await (deps.landReadiness ?? landReadiness)(project, epicId, { todos: allTodos });
        if (!readiness.green) {
          skipped.push(card.id);
          continue;
        }

        // Every criterion this epic serves must carry a RECORDED verdict; an epic serving
        // a criterion nobody has verified is not autonomously landable.
        const served = getTodo(project, epicId)?.servesCriterionIds ?? [];
        if (served.length > 0) {
          const criteria = (deps.listCriteriaWithActions ?? listCriteriaWithActions)(project, missionId);
          const servedCriteria = criteria.filter((c) => served.includes(c.id));
          if (servedCriteria.some((c) => c.verifiedAt == null)) {
            skipped.push(card.id);
            continue;
          }
        }

        // The existing authorized path: re-derive at click time, land mutex, --no-ff merge,
        // teardown, card resolve. A refusal falls through untouched.
        const outcome = await (deps.landEpic ?? landEpic)(project, card.id);
        if (outcome.landed === true) landed.push(card.id);
        else skipped.push(card.id);
      } catch {
        skipped.push(card.id);
      }
    }
    return { landed, skipped };
  } catch {
    return { landed: [], skipped: [] };
  }
}
