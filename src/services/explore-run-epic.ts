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
