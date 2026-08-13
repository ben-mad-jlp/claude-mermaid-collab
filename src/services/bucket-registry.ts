/**
 * bucket-registry.ts — the ONE code-owned definition of "is this a bucket epic?"
 * plus the ONLY runtime writer of a non-null `bucketType`.
 *
 * Buckets (Inbox, Bugfix inbox, and the legacy "Collab gaps") are durable intake
 * containers: they never land, have no branch, no mission, and their children are
 * planning-only until re-homed under a real epic. Historically FOUR modules each
 * carried their own bucket-title list + predicate (todo-store, land-authority,
 * mission-parenting, claimability). R1 consolidates the READ seam here so there is
 * exactly ONE predicate, and introduces a STRUCTURAL singleton: the `bucketType`
 * column, written ONLY by `ensureBucket`, uniqued per (targetProject, bucketType).
 *
 * Import-cycle note: claimability -> bucket-registry -> todo-store -> claimability.
 * `isBucketEpic` (a pure read) statically imports only todo-kind, so claimability
 * can consume it with no runtime cycle. `ensureBucket` (a write) LAZILY imports
 * todo-store to keep that edge dynamic.
 */
import { isEpic, stripLabel, type KindBearing } from './todo-kind.ts';
import { trackingProjectRoot } from './project-registry.ts';

/** The five live bucket kinds. `inbox` = the triage Inbox; `bugfix` = the Bugfix
 *  inbox (the legacy "Collab gaps" title folds into `bugfix`); `flaky` = the Flaky
 *  quarantine inbox; `explore` = Explore requests; `feature` = Feature requests.
 *  Defined AND exported HERE — this module is the source of the type, not a re-exporter. */
export type BucketType = 'inbox' | 'bugfix' | 'flaky' | 'explore' | 'feature';

/** Canonical (post-strip) titles for the singleton row `ensureBucket` mints. */
export const BUCKET_TITLE: Readonly<Record<BucketType, string>> = {
  inbox: 'Inbox',
  bugfix: 'Bugfix inbox',
  flaky: 'Flaky quarantine',
  explore: 'Explore requests',
  feature: 'Feature requests',
};

/** The UNION of all four legacy per-module bucket-title lists:
 *   - todo-store.ts        : ['Inbox', 'Bugfix inbox']
 *   - land-authority.ts    : ['Inbox', 'Bugfix inbox', 'Collab gaps']
 *   - mission-parenting.ts : ['Inbox', 'Bugfix inbox']
 *   - claimability.ts      : ['Inbox']
 *  Matched fail-CLOSED as a case-insensitive PREFIX on the stripLabel-normalized
 *  title, so a stripped / legacy / replayed row whose `bucketType` was never set
 *  is STILL recognized as a bucket. */
export const LEGACY_BUCKET_TITLE_PREFIXES: readonly string[] = [
  'Inbox',
  'Bugfix inbox',
  'Collab gaps',
];

/** The EXACT canonical bucket titles (normalized, stripLabel + lowercase). A row
 *  whose title is exactly one of these IS a bucket regardless of the legacy
 *  `isBucket` column — this is what lets a pre-bucketType Inbox fixture (isBucket
 *  defaulted false) still read as a bucket. */
const CANONICAL_BUCKET_TITLES: readonly string[] = [
  'inbox',
  'bugfix inbox',
  'collab gaps',
  'explore requests',
  'feature requests',
];

/** Which BucketType a legacy title maps to (Inbox -> 'inbox'; Bugfix inbox /
 *  Collab gaps -> 'bugfix'; Flaky quarantine -> 'flaky'; Explore requests -> 'explore';
 *  Feature requests -> 'feature'). null = not a bucket title.
 *  Normalizes the [EPIC] label. */
export function bucketTypeOfTitle(title: string | null | undefined): BucketType | null {
  const norm = stripLabel(title ?? '').toLowerCase();
  if (norm.startsWith('inbox')) return 'inbox';
  if (norm.startsWith('bugfix inbox') || norm.startsWith('collab gaps')) return 'bugfix';
  if (norm.startsWith('flaky quarantine')) return 'flaky';
  if (norm.startsWith('explore requests')) return 'explore';
  if (norm.startsWith('feature requests')) return 'feature';
  return null;
}

/** A node that MAY carry the structural bucket marker. */
export interface BucketBearing extends KindBearing {
  bucketType?: BucketType | null;
}

/**
 * The SOLE bucket predicate. A todo is a bucket epic iff (in order):
 *   1. its structural `bucketType` is non-null (the post-migration singleton marker), OR
 *   2. it is an epic whose stripLabel-normalized title is EXACTLY a canonical bucket
 *      name (Inbox / Bugfix inbox / Collab gaps) — always a bucket, isBucket-agnostic, OR
 *   3. it is an epic whose title matches a legacy bucket PREFIX (fail-CLOSED for
 *      stripped/replayed rows), UNLESS `isBucket === false` is set explicitly — an
 *      explicit false is a deliberate "this bucket-looking title is a real deliverable"
 *      opt-out (e.g. "Inbox triage").
 *
 * The `isEpic` guard means role comes from `kind`, never the word alone: a leaf titled
 * "Bugfix inbox" is not a bucket. Only `ensureBucket` writes `bucketType`, and only onto
 * an epic, so branch 1 needs no guard.
 */
export function isBucketEpic(t: BucketBearing | null | undefined): boolean {
  if (!t) return false;
  if ((t.bucketType ?? null) != null) return true; // 1. structural singleton (post-migration)
  if (!isEpic(t)) return false;                     // role from kind, never the word alone
  const norm = stripLabel(t.title ?? '').toLowerCase();
  if (CANONICAL_BUCKET_TITLES.includes(norm)) return true; // 2. exact canonical, isBucket-agnostic
  if (t.isBucket === true) return true;             // 3. legacy `isBucket` column marker (back-compat)
  if (t.isBucket === false) return false;           // 4. explicit deliverable opt-out
  return LEGACY_BUCKET_TITLE_PREFIXES.some((b) => norm.startsWith(b.toLowerCase())); // 5. fail-closed prefix
}

/** SQLite unique-constraint sniff (bun:sqlite surfaces the message inline). */
function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint|SQLITE_CONSTRAINT/i.test(msg);
}

/** ISO timestamp generator. */
const nowIso = () => new Date().toISOString();

/**
 * Revive a bucket row from a terminal state (done/dropped) to planned, clearing all
 * completion and acceptance markers. Idempotent: calling on an already-planned row
 * changes only the `updatedAt` timestamp.
 *
 * If `type` is non-null, also sets `bucketType` (e.g., when stamping a legacy row).
 * If `type` is null, leaves the existing `bucketType` untouched.
 */
export function reviveBucketRow(
  db: ReturnType<typeof import('./todo-store.ts').openDb>,
  id: string,
  type: BucketType | null,
): void {
  const binds: (string | null)[] = [];
  let sql = `UPDATE todos SET
    status='planned', completedAt=NULL, acceptanceStatus=NULL, landedAt=NULL,
    hollowLandedAt=NULL, isBucket=1, heldAt=NULL, heldReason=NULL, updatedAt=?`;

  binds.push(nowIso());

  if (type != null) {
    sql += `, bucketType=?`;
    binds.push(type);
  }

  sql += ` WHERE id=?`;
  binds.push(id);

  db.prepare(sql).run(...binds);
}

/**
 * Find-or-create the singleton bucket epic for (project, type) and return its id.
 * This is the ONLY runtime writer of a non-null `bucketType` (the migration backfill is
 * a one-time bootstrap). Idempotent and safe under concurrent calls:
 *   - a fast find returns an existing live singleton;
 *   - otherwise it creates via createTodo (serialized per-project under withLock; the
 *     internal `_ensureBucketType` is what stamps `bucketType`), and if a concurrent
 *     creator won the race (app-level DuplicateBucket or the partial UNIQUE index firing)
 *     it re-finds and returns the survivor.
 * Lazy todo-store import breaks the claimability -> bucket-registry -> todo-store cycle.
 */
export async function ensureBucket(project: string, type: BucketType): Promise<string> {
  const store = await import('./todo-store.ts');
  const root = trackingProjectRoot(project);

  // Helper: verify the resolved bucket is not terminal.
  const verifyNotTerminal = (bucketId: string): void => {
    const db = store.openDb(project);
    const row = db
      .query(`SELECT id, status FROM todos WHERE id = ?`)
      .get(bucketId) as { id: string; status: string } | null;
    if (row && (row.status === 'done' || row.status === 'dropped')) {
      throw new Error(
        `ensureBucket: internal error — resolved bucket ${bucketId.slice(0, 8)} is terminal ` +
        `(${row.status}). Buckets must never be terminal.`,
      );
    }
  };

  // 1. Existing structural singleton — find it even if terminal, and revive it.
  const typed = (): { id: string; status: string } | null => {
    const db = store.openDb(project);
    return db
      .query(
        `SELECT id, status FROM todos
           WHERE targetProject = ? AND bucketType = ?
           ORDER BY rowid ASC LIMIT 1`,
      )
      .get(root, type) as { id: string; status: string } | null;
  };
  const hit = typed();
  if (hit) {
    // Always revive: idempotent operation that ensures bucket is planned, clears all
    // terminal markers, and updates updatedAt. Idempotent — calling on an already-planned
    // row changes only updatedAt.
    const db = store.openDb(project);
    reviveBucketRow(db, hit.id, null);
    verifyNotTerminal(hit.id);
    return hit.id;
  }

  // 2. Adopt a LEGACY bucket epic of this type (bucketType never stamped) — a GENUINE
  //    bucket (isBucketEpic, not a prefix-title deliverable) of the matching type. Prefer a
  //    live row; revive terminal ones; prefer done > dropped when both terminal.
  const legacy = store
    .listTodos(project, { includeCompleted: true })
    .filter(
      (x) =>
        (x.bucketType ?? null) == null &&
        bucketTypeOfTitle(x.title) === type &&
        isBucketEpic(x),
    );
  // Prefer: live (any non-terminal status) > done > dropped (defensive ranking among terminals).
  const chosen = legacy.find((x) => x.status !== 'done' && x.status !== 'dropped') ??
                 legacy.find((x) => x.status === 'done') ??
                 legacy.find((x) => x.status === 'dropped');
  if (chosen) {
    const db = store.openDb(project);
    reviveBucketRow(db, chosen.id, type);
    verifyNotTerminal(chosen.id);
    return chosen.id;
  }

  // 3. Create a fresh singleton (serialized under withLock; _ensureBucketType stamps bucketType).
  try {
    const created = await store.createTodo(project, {
      ownerSession: 'system',
      kind: 'epic',
      title: BUCKET_TITLE[type],
      status: 'planned',
      missionId: null, // buckets are always roots
      _ensureBucketType: type, // internal: the sole path that stamps a non-null bucketType
    });
    verifyNotTerminal(created.id);
    return created.id;
  } catch (e) {
    if (store.isDuplicateBucketError?.(e) || isUniqueViolation(e)) {
      const again = typed();
      if (again) {
        // Defensive: revive if race-condition created a terminal singleton.
        if (again.status === 'done' || again.status === 'dropped') {
          const db = store.openDb(project);
          reviveBucketRow(db, again.id, null);
        }
        verifyNotTerminal(again.id);
        return again.id;
      }
    }
    throw e;
  }
}
