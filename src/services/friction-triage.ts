import { frictionTrends, type FrictionTrends } from './friction-trends.ts';
import { type FrictionLayer, isReasonActioned, markReasonActioned } from './friction-store.ts';
import { listTodos, createTodo, type Todo } from './todo-store.ts';
import { getConfig } from './config-service.ts';
import { isEpic } from './todo-kind.ts';

/**
 * DF3 friction triage — periodic, deterministic (no-LLM) pass that reads the
 * friction-trends recurrence rollup and files ONE 'planned' todo per recurring
 * retryReason that hasn't been actioned yet.
 *
 * Anti-spam: threshold + actioned marker (permanent per MVP) + per-tick cap.
 * Bucket routing: domain → the '[EPIC] Bugfix inbox' todo; orchestration/operational →
 * '[EPIC] Collab gaps'. Those two strings are bucket IDENTITIES (looked up by exact title),
 * not role markers — the role check goes through isEpic()/`kind` (decision e852fb0c).
 *
 * Caveats:
 * - invariant-check will flag bucket epics (Bugfix inbox, Collab gaps) as stranded-epic
 *   because they have no [LAND] leaf — this is pre-existing bucket behavior (same as Inbox).
 * - Actioned marker is permanent (MVP). Re-arming when count grows after the prior todo is
 *   resolved is a future enhancement, not built here.
 */

const DEFAULT_THRESHOLD = 3;
const DEFAULT_FILE_CAP = 5;

const BUGFIX_INBOX_TITLE = '[EPIC] Bugfix inbox';
const COLLAB_GAPS_TITLE  = '[EPIC] Collab gaps';

interface LayerRoute { epicTitle: string; category: 'bug' | 'gap'; }
const LAYER_ROUTE: Record<FrictionLayer, LayerRoute> = {
  domain:        { epicTitle: BUGFIX_INBOX_TITLE, category: 'bug' },
  orchestration: { epicTitle: COLLAB_GAPS_TITLE,  category: 'gap' },
  operational:   { epicTitle: COLLAB_GAPS_TITLE,  category: 'gap' },
};

export interface FrictionTriageDeps {
  trends?: (project: string) => FrictionTrends;
  listTodos?: (project: string) => Todo[];
  createTodo?: (project: string, input: Parameters<typeof createTodo>[1]) => Promise<Todo>;
  isActioned?: (project: string, layer: FrictionLayer, reason: string) => boolean;
  markActioned?: (project: string, layer: FrictionLayer, reason: string, todoId: string) => Promise<void>;
  threshold?: number;
  cap?: number;
}

async function findOrCreateEpic(
  project: string,
  title: string,
  listTodosFn: (p: string) => Todo[],
  createTodoFn: (p: string, i: Parameters<typeof createTodo>[1]) => Promise<Todo>,
): Promise<Todo> {
  const existing = listTodosFn(project).find(
    (t) => isEpic(t) && (t.title ?? '').trim() === title,
  );
  if (existing) return existing;
  return createTodoFn(project, {
    ownerSession: '__steward_friction_triage__',
    title,
    status: 'planned',
  });
}

export async function runFrictionTriagePass(project: string, deps: FrictionTriageDeps = {}): Promise<void> {
  const trendsFn    = deps.trends      ?? ((p: string) => frictionTrends(p));
  const listTodosFn = deps.listTodos   ?? ((p: string) => listTodos(p));
  const createTodoFn= deps.createTodo  ?? createTodo;
  const isActioned  = deps.isActioned  ?? isReasonActioned;
  const markActioned= deps.markActioned ?? markReasonActioned;
  const threshold   = deps.threshold   ?? (Number(getConfig('FRICTION_TRIAGE_THRESHOLD', '') || 0) || DEFAULT_THRESHOLD);
  const cap         = deps.cap         ?? DEFAULT_FILE_CAP;

  const candidates = trendsFn(project).recurring
    .filter((r) => r.count >= threshold)
    .filter((r) => !isActioned(project, r.layer, r.retryReason))
    .sort((a, b) => b.count - a.count);

  if (candidates.length === 0) return;

  const batch = candidates.slice(0, cap);
  if (candidates.length > cap) {
    console.info(`[friction-triage] ${project}: ${candidates.length} unactioned recurring reasons, filing ${cap} this tick (cap)`);
  }

  for (const r of batch) {
    try {
      const route = LAYER_ROUTE[r.layer];
      const epic  = await findOrCreateEpic(project, route.epicTitle, listTodosFn, createTodoFn);
      // Priority: 1 (high) when count ≥ double threshold, 2 (medium) otherwise.
      const priority: 1 | 2 = r.count >= threshold * 2 ? 1 : 2;
      const filed = await createTodoFn(project, {
        ownerSession: '__steward_friction_triage__',
        parentId: epic.id,
        title: `[${route.category}] Recurring friction: ${r.retryReason} (${r.layer}, ×${r.count})`,
        description:
          `Auto-filed by DF3 friction triage.\n\n` +
          `Layer: ${r.layer}\nReason: ${r.retryReason}\nOccurrences: ${r.count} (≥ threshold ${threshold})\n\n` +
          `Evidence: this reason recurred ${r.count} time(s) in the friction store. ` +
          `Run \`friction_trends\` / \`list_friction\` for the underlying notes.\n\n` +
          `Filed 'planned' — a human approves it to 'ready' (planner-promotes-ready).`,
        status: 'planned',
        priority,
      });
      await markActioned(project, r.layer, r.retryReason, filed.id);
    } catch (err) {
      // Per-reason fail-open: one bad file never aborts the rest of the batch.
      console.warn(`[friction-triage] ${project}: failed to file for "${r.retryReason}":`, err instanceof Error ? err.message : err);
    }
  }
}
