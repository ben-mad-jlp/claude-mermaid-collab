import { frictionTrends, type FrictionTrends } from './friction-trends.ts';
import { type FrictionLayer, isReasonActioned, markReasonActioned } from './friction-store.ts';
import { listTodos, createTodo, type Todo } from './todo-store.ts';
import { getConfig } from './config-service.ts';
import { isEpic, stripLabel } from './todo-kind.ts';
import { ensureBucket } from './bucket-registry.ts';

/**
 * DF3 friction triage — periodic, deterministic (no-LLM) pass that reads the
 * friction-trends recurrence rollup and files ONE 'planned' todo per recurring
 * retryReason that hasn't been actioned yet.
 *
 * Anti-spam: threshold + actioned marker (permanent per MVP) + per-tick cap.
 * All layers (domain, orchestration, operational) file under the singleton `bugfix`
 * bucket per project, discriminated by triageTag. Title labels ([bug] / [gap]) are
 * structural but do not route the parent.
 *
 * Caveats:
 * - invariant-check will flag bucket epics (Bugfix inbox) as stranded-epic
 *   because they have no [LAND] leaf — this is pre-existing bucket behavior (same as Inbox).
 * - Actioned marker is permanent (MVP). Re-arming when count grows after the prior todo is
 *   resolved is a future enhancement, not built here.
 */

const DEFAULT_THRESHOLD = 3;
const DEFAULT_FILE_CAP = 5;

// ---------------------------------------------------------------------------
// Throttle (audit item 7b / E7): keep the friction-triage pass OFF the every-tick
// (~30s + every 250ms-debounced kick) cadence.
//
// The pass previously ran UNTHROTTLED for every watched project on every tick AND
// every kicked tick: each run pays a frictionTrends rollup scan plus (when anything
// is filed) an ensureBucket todos lookup. Filing a 'planned' todo is planner-paced
// work — a human promotes it to ready — so sub-minute freshness buys nothing.
// Same proven gate shape as mission-loop's MISSION_LOOP_INTERVAL_MS /
// shouldRunMissionLoopPass (mission-loop.ts) with the same injectable clock + reset
// test hooks. Matches its 150s neighbors (reconcile, mission-loop).
// ---------------------------------------------------------------------------

/** Minimum spacing between friction-triage passes for a single project. */
export const FRICTION_TRIAGE_INTERVAL_MS = 150_000; // 2.5 min

const lastFrictionTriageMs = new Map<string, number>();

/**
 * Throttle gate for runFrictionTriagePass. Returns true (and records `now` as the last
 * run) when the pass is due for `project`; false while a previous run is within
 * FRICTION_TRIAGE_INTERVAL_MS. First call for a project always runs. `now` is injectable
 * for deterministic tests.
 */
export function shouldRunFrictionTriagePass(project: string, now: number = Date.now()): boolean {
  const last = lastFrictionTriageMs.get(project);
  if (last !== undefined && now - last < FRICTION_TRIAGE_INTERVAL_MS) return false;
  lastFrictionTriageMs.set(project, now);
  return true;
}

/** Test seam: clear the per-project throttle clock (all projects, or one). */
export function _resetFrictionTriageThrottle(project?: string): void {
  if (project === undefined) lastFrictionTriageMs.clear();
  else lastFrictionTriageMs.delete(project);
}

interface LayerRoute { category: 'bug' | 'gap'; }
const LAYER_ROUTE: Record<FrictionLayer, LayerRoute> = {
  domain:        { category: 'bug' },
  orchestration: { category: 'gap' },
  operational:   { category: 'gap' },
};

export interface FrictionTriageDeps {
  trends?: (project: string) => FrictionTrends;
  listTodos?: (project: string) => Todo[];
  createTodo?: (project: string, input: Parameters<typeof createTodo>[1]) => Promise<Todo>;
  ensureBucket?: (project: string, type: 'inbox' | 'bugfix') => Promise<string>;
  isActioned?: (project: string, layer: FrictionLayer, reason: string) => boolean;
  markActioned?: (project: string, layer: FrictionLayer, reason: string, todoId: string) => Promise<void>;
  threshold?: number;
  cap?: number;
}

/** Result of one triage pass — `filed` lets the orchestrator tick invalidate its shared
 *  todos snapshot ONLY when this pass actually created rows (audit item 7a). */
export interface FrictionTriageResult { filed: number }

export async function runFrictionTriagePass(project: string, deps: FrictionTriageDeps = {}): Promise<FrictionTriageResult> {
  const trendsFn      = deps.trends      ?? ((p: string) => frictionTrends(p));
  const listTodosFn   = deps.listTodos   ?? ((p: string) => listTodos(p));
  const createTodoFn  = deps.createTodo  ?? createTodo;
  const ensureBucketFn= deps.ensureBucket ?? ensureBucket;
  const isActioned    = deps.isActioned  ?? isReasonActioned;
  const markActioned  = deps.markActioned ?? markReasonActioned;
  const threshold     = deps.threshold   ?? (Number(getConfig('FRICTION_TRIAGE_THRESHOLD', '') || 0) || DEFAULT_THRESHOLD);
  const cap           = deps.cap         ?? DEFAULT_FILE_CAP;

  const candidates = trendsFn(project).recurring
    .filter((r) => r.count >= threshold)
    .filter((r) => {
      if (r.defectClass === 'success-signal') {
        console.info(`[friction-triage] ${project}: skipping success-signal reason "${r.retryReason}" (layer: ${r.layer})`);
        return false;
      }
      return true;
    })
    .filter((r) => !isActioned(project, r.layer, r.retryReason))
    .sort((a, b) => b.count - a.count);

  if (candidates.length === 0) return { filed: 0 };

  const batch = candidates.slice(0, cap);
  if (candidates.length > cap) {
    console.info(`[friction-triage] ${project}: ${candidates.length} unactioned recurring reasons, filing ${cap} this tick (cap)`);
  }

  let filedCount = 0;
  for (const r of batch) {
    try {
      const route = LAYER_ROUTE[r.layer];
      const epicId = await ensureBucketFn(project, 'bugfix');
      // Priority: 1 (high) when count ≥ double threshold, 2 (medium) otherwise.
      const priority: 1 | 2 = r.count >= threshold * 2 ? 1 : 2;
      const triageTag = r.layer;
      const filed = await createTodoFn(project, {
        ownerSession: '__steward_friction_triage__',
        parentId: epicId,
        title: `[${route.category}] Recurring friction: ${r.retryReason} (${r.layer}, ×${r.count})`,
        description:
          `Auto-filed by DF3 friction triage.\n\n` +
          `Layer: ${r.layer}\nReason: ${r.retryReason}\nOccurrences: ${r.count} (≥ threshold ${threshold})\n\n` +
          `Evidence: this reason recurred ${r.count} time(s) in the friction store. ` +
          `Run \`friction_trends\` / \`list_friction\` for the underlying notes.\n\n` +
          `Filed 'planned' — a human approves it to 'ready' (planner-promotes-ready).`,
        status: 'planned',
        priority,
        triageTag,
      });
      await markActioned(project, r.layer, r.retryReason, filed.id);
      filedCount++;
    } catch (err) {
      // Per-reason fail-open: one bad file never aborts the rest of the batch.
      console.warn(`[friction-triage] ${project}: failed to file for "${r.retryReason}":`, err instanceof Error ? err.message : err);
    }
  }
  return { filed: filedCount };
}
