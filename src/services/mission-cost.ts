/**
 * mission-cost.ts — the convergence-loop economics gauge.
 *
 * The loops principle (and the Phase-2b design) makes this MANDATORY: a loop is only
 * worth running while its **cost-per-accepted-change** stays sane — below roughly a 50%
 * accept rate it costs more than it saves. This aggregates the per-node worker-ledger
 * cost (costUsd / nodesSpent, already tagged with epicId) across a mission's iteration
 * epics and pairs it with the accept/reject outcome of each leaf, so the steward (and, in
 * `auto`, the loop itself) can SEE whether a mission is converging economically — not just
 * whether its criteria are ticking.
 *
 * Read-only: it derives everything from the existing ledger + work-graph, records nothing.
 */
import { listTodos } from './todo-store.ts';
import { getMission } from './mission-store.ts';
import { isEpic } from './todo-kind.ts';
import { listLeafRuns, type LeafRunSummary } from './ledger-stats.ts';

export interface MissionCost {
  todoId: string;
  /** Σ USD across the mission's leaf nodes (0 when the model price is unknown, e.g. Max plan). */
  costUsd: number;
  /** Σ nodes spent — the plan-independent cost proxy (always available, unlike costUsd). */
  nodesSpent: number;
  /** Leaf-run outcome tally across the mission's epics. */
  leaves: { total: number; accepted: number; rejected: number; blocked: number; inflight: number };
  /** accepted / (accepted+rejected+blocked) — the article's core signal. null if none terminal. */
  acceptRate: number | null;
  /** costUsd per accepted change (null if nothing accepted, or cost unknown → see nodesPerAcceptedChange). */
  costPerAcceptedChange: number | null;
  /** nodesSpent per accepted change — the robust cost-per-accepted-change when USD is unknown. */
  nodesPerAcceptedChange: number | null;
  /** True when acceptRate is known and below the ~50% "loop costs more than it saves" line. */
  belowBreakEven: boolean | null;
}

/** The break-even accept rate below which the loop is (per the article) net-negative. */
export const ACCEPT_RATE_BREAK_EVEN = 0.5;

/**
 * PURE economics rollup over a set of leaf runs. Separated from the DB reads so the
 * money math is trivially unit-tested. `total` counts every run; `inflight` is the
 * non-terminal remainder (pending/paused/unknown) excluded from the accept rate.
 */
export function computeMissionEconomics(runs: LeafRunSummary[]): Omit<MissionCost, 'todoId'> {
  let costUsd = 0;
  let nodesSpent = 0;
  let accepted = 0;
  let rejected = 0;
  let blocked = 0;
  let inflight = 0; // pending/paused/null — ran but not yet terminal
  for (const run of runs) {
    costUsd += run.costUsd;
    nodesSpent += run.nodesSpent;
    switch (run.finalOutcome) {
      case 'accepted': accepted += 1; break;
      case 'rejected': rejected += 1; break;
      case 'blocked': blocked += 1; break;
      default: inflight += 1; break; // 'pending' | 'paused' | null
    }
  }
  const total = runs.length;
  const terminal = accepted + rejected + blocked;
  const acceptRate = terminal > 0 ? accepted / terminal : null;
  return {
    costUsd,
    nodesSpent,
    leaves: { total, accepted, rejected, blocked, inflight },
    acceptRate,
    costPerAcceptedChange: accepted > 0 && costUsd > 0 ? costUsd / accepted : null,
    nodesPerAcceptedChange: accepted > 0 ? nodesSpent / accepted : null,
    belowBreakEven: acceptRate === null ? null : acceptRate < ACCEPT_RATE_BREAK_EVEN,
  };
}

/**
 * Economics rollup for a mission: cost (USD + nodes) and accept-rate across every leaf
 * under the mission's iteration epics. Auto-split file-children are captured too — the
 * ledger tags every leaf run with its enclosing epicId, so querying by epic includes them.
 */
export function getMissionCost(project: string, todoId: string): MissionCost {
  const m = getMission(project, todoId);
  if (!m) throw new Error(`mission not found: ${todoId}`);

  const epics = listTodos(project, { includeCompleted: true }).filter(
    (t) => t.parentId === todoId && t.status !== 'dropped' && isEpic(t),
  );
  const runs = epics.flatMap((epic) => listLeafRuns({ project, epicId: epic.id }));
  return { todoId, ...computeMissionEconomics(runs) };
}
