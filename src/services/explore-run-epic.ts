/**
 * explore-run-epic.ts — find-or-create the singleton root epic for explore runs.
 *
 * The 'Explore runs' epic is a real (non-bucket), approved root epic that homes every
 * filed explore leaf. Unlike bucket epics (Inbox, Bugfix inbox), it is approved at
 * creation so its filed children derive as 'claimable' and are immediately dispatchable.
 *
 * Lazy todo-store import breaks the claimability → … → todo-store cycle.
 */
import { isEpic, stripLabel } from './todo-kind.ts';
import { trackingProjectRoot } from './project-registry.ts';

/** The canonical title for the rolling explore-runs epic. */
export const EXPLORE_RUN_EPIC_TITLE = 'Explore runs';

/** SQLite unique-constraint sniff (bun:sqlite surfaces the message inline). */
function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint|SQLITE_CONSTRAINT/i.test(msg);
}

/**
 * Find or create a singleton non-bucket root epic titled 'Explore runs'.
 *
 * Selection rule (order matters):
 * 1. Find a LIVE (non-terminal) epic with the matching title under this project's root.
 *    Return its id.
 * 2. No live match found ⇒ create a fresh one with status='ready' (which translates to
 *    status='planned' + approvedAt=<now>, making it immediately approved).
 * 3. On create collision (concurrent racer), re-run step 1 and return the survivor.
 *
 * The epic is created with missionId:null (root epic) and no bucketType, so it is
 * NOT a bucket epic: isBucketEpic(epic) === false.
 */
export async function ensureExploreRunEpic(project: string): Promise<string> {
  const store = await import('./todo-store.ts');
  const root = trackingProjectRoot(project);

  // 1. Find a LIVE non-bucket root epic titled 'Explore runs'.
  const findLive = (): { id: string } | null => {
    const todos = store.listTodos(project, { includeCompleted: true });
    const match = todos.find(
      (t) =>
        isEpic(t) &&
        trackingProjectRoot(t.targetProject ?? project) === root &&
        stripLabel(t.title).toLowerCase() === EXPLORE_RUN_EPIC_TITLE.toLowerCase() &&
        t.status !== 'done' &&
        t.status !== 'dropped',
    );
    return match ? { id: match.id } : null;
  };

  const liveMatch = findLive();
  if (liveMatch) return liveMatch.id;

  // 2. Create a fresh singleton with status='ready' (→ status='planned' + approvedAt).
  try {
    const created = await store.createTodo(project, {
      ownerSession: 'system',
      kind: 'epic',
      title: EXPLORE_RUN_EPIC_TITLE,
      status: 'ready',
      missionId: null, // root epic (no mission parent)
    });
    return created.id;
  } catch (e) {
    // 3. On collision (DuplicateBucketError is possible if the title somehow
    //    matches a bucket predicate, though it shouldn't; isUniqueViolation is
    //    the main race case), re-find and return the survivor.
    if (isUniqueViolation(e)) {
      const again = findLive();
      if (again) return again.id;
    }
    throw e;
  }
}

// --- EXPLORER SWITCH: dispatch-time hold (filing/promotion is never gated) ------------

/** The minimum shape the explore-hold predicates need from a todo row. Structural so this
 *  module stays free of the todo-store import cycle. */
export interface ExploreGateTodo {
  id: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  parentId?: string | null;
}

/** Ids of every LIVE 'Explore runs' epic in a snapshot. Mirrors ensureExploreRunEpic's own
 *  liveness rule (matching title, non-terminal) so the hold covers exactly the epic that
 *  promote-on-file homes explores into — and nothing else. */
export function exploreRunEpicIds(allTodos: ExploreGateTodo[]): Set<string> {
  const ids = new Set<string>();
  for (const t of allTodos) {
    // Column-only, compared directly rather than through kindOf(): this runs over a WHOLE
    // snapshot and kindOf throws on any row with a missing kind — a claim-time filter must
    // never be the thing that explodes.
    if (t.kind !== 'epic') continue;
    if (stripLabel(t.title ?? '').toLowerCase() !== EXPLORE_RUN_EPIC_TITLE.toLowerCase()) continue;
    if (t.status === 'done' || t.status === 'dropped') continue;
    ids.add(t.id);
  }
  return ids;
}

/** Is this leaf homed under a live 'Explore runs' epic? ONLY these are held by the
 *  Explorer switch — every other leaf kind is untouched. */
export function isExploreRunLeaf(todo: ExploreGateTodo, exploreEpicIds: Set<string>): boolean {
  return todo.parentId != null && exploreEpicIds.has(todo.parentId);
}

/** The suppression reason a held explore leaf reports. Named (never silent) so
 *  daemon_status / the claim-suppression report says exactly why nothing is claiming —
 *  a lever whose effect you cannot see on the board is how wedges happen. */
export const EXPLORER_OFF_SUPPRESSION_REASON =
  "explorer-off: held under the 'Explore runs' epic — the Explorer switch is off (filed + promoted, not dispatched; flip it on to drain the queue)";

/** Claim-time FILTER: with the Explorer switch off, drop leaves homed under a live
 *  'Explore runs' epic. Pure — no status write, nothing is lost; the leaves stay ready
 *  and claim on a later tick once the switch is back on. */
export function filterExplorerHeld<T extends ExploreGateTodo>(
  todos: T[],
  allTodos: ExploreGateTodo[],
  explorerEnabled: boolean,
): T[] {
  if (explorerEnabled) return todos;
  const epicIds = exploreRunEpicIds(allTodos);
  if (epicIds.size === 0) return todos;
  return todos.filter((t) => !isExploreRunLeaf(t, epicIds));
}
