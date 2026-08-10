/**
 * collab-db-import.ts — move a project's work-graph into its consolidated database.
 *
 * Copies `.collab/todos.db` (todos) and `.collab/mission.db` (mission control state, criteria,
 * verdict history) into `.collab/collab.db`, which the schema in collab-db-schema.ts has already
 * created. Runs against a QUIESCED daemon: rows written to the sources after the copy begins are
 * not seen, so this is not safe to run under live traffic.
 *
 * TWO THINGS IT REFUSES TO DO SILENTLY
 *
 * 1. It never drops a row to satisfy a constraint. The live data contains 47 todos whose
 *    `parentId` names a work item that no longer exists — deliberate drops, not corruption. With
 *    foreign keys now enforced, inserting them verbatim would fail. Rather than discarding them
 *    (losing real work items) or importing with the constraint off (recreating the very drift this
 *    consolidation removes), the import SEVERS the dangling edge — `parentId` becomes NULL — and
 *    records what was severed in `migration_orphan`. The row survives, the graph is valid, and the
 *    change is auditable instead of invisible.
 *
 * 2. It never carries a live claim across. A claim is a lease on a running executor, and the
 *    executor does not survive the migration. Copying it verbatim would recreate the orphaned-leaf
 *    bug in the new schema on day one: a leaf marked claimed with nothing behind it. Each inflight
 *    row instead becomes a claim that is ALREADY EXPIRED, so the ordinary sweeper reclaims it
 *    through the normal path rather than needing a special case.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { COLLAB_DB_MIGRATIONS, enforceForeignKeys } from './collab-db-schema';
import { applyMigrations } from './schema-migrate';

export interface ImportReport {
  /** Rows written per destination table. */
  copied: Record<string, number>;
  /** Work items whose dangling parent edge was severed to satisfy the new foreign key. */
  severedParents: Array<{ id: string; missingParentId: string }>;
  /** Claims imported already-expired, for the sweeper to reclaim. */
  expiredClaims: string[];
  /** Referential problems found by the post-copy verification. Empty is the only acceptable value. */
  violations: string[];
}

const MIGRATION_ORPHAN_DDL = `
CREATE TABLE IF NOT EXISTS migration_orphan (
  id          TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL,
  lost_value  TEXT NOT NULL,
  noted_at    INTEGER NOT NULL
)`;

/** The column names a schema declares for `todos` ('main' or an ATTACHed alias). */
function todoColumns(db: Database, schema: string): string[] {
  return (db.query(`PRAGMA ${schema}.table_info(todos)`).all() as Array<{ name: string }>)
    .map((c) => c.name);
}

/**
 * Import into an ALREADY-MIGRATED destination. Idempotent per row via INSERT OR IGNORE on the
 * primary key, so a re-run after an interruption resumes rather than duplicating.
 */
export function importProjectWorkGraph(io: {
  todosPath: string;
  missionPath: string;
  destPath: string;
  /** Live inflight rows for THIS project, read from the global ledger by the caller. */
  inflight?: Array<{ leafId: string; epicId?: string | null; holder?: string | null }>;
  now?: () => number;
}): ImportReport {
  const now = io.now ?? Date.now;
  const stamp = now();
  const report: ImportReport = { copied: {}, severedParents: [], expiredClaims: [], violations: [] };

  const dest = new Database(io.destPath, { create: true });
  try {
    enforceForeignKeys(dest);
    applyMigrations(dest, COLLAB_DB_MIGRATIONS, { storeName: 'collab', now });
    dest.exec(MIGRATION_ORPHAN_DDL);

    if (!existsSync(io.todosPath)) throw new Error(`import: source todos.db missing at ${io.todosPath}`);

    // Only copy columns the destination actually declares. The source carries a few columns the
    // consolidated schema drops (asanaGid, blueprintId — dead, zero rows, no producer in src/);
    // selecting them would fail, and silently selecting a subset without saying so would hide a
    // real column loss. Anything present in the source with DATA but absent from the destination
    // is reported as a violation rather than dropped.
    const destCols = new Set(todoColumns(dest, 'main'));

    // Read the source's columns through the ATTACH rather than a second handle: a WAL database
    // cannot be opened readonly without its -shm sidecar (SQLITE_CANTOPEN), and one handle is
    // one fewer thing to leak.
    dest.exec(`ATTACH DATABASE '${io.todosPath.replace(/'/g, "''")}' AS src_todos`);
    try {
      const cols = todoColumns(dest, 'src_todos');
      const shared = cols.filter((c) => destCols.has(c));
      const droppedCols = cols.filter((c) => !destCols.has(c));
      for (const c of droppedCols) {
        const n = (dest.query(`SELECT COUNT(*) n FROM src_todos.todos WHERE "${c}" IS NOT NULL`)
          .get() as { n: number }).n;
        if (n > 0) report.violations.push(`column ${c} holds ${n} non-null rows but is not in the destination schema`);
      }

      const copyTodos = dest.transaction(() => {
        // Pass 1: every work item, with parentId deliberately NULL. Inserting children before
        // parents would otherwise fail the self-FK purely on ordering.
        const withoutParent = shared.filter((c) => c !== 'parentId').map((c) => `"${c}"`).join(', ');
        dest.exec(`INSERT OR IGNORE INTO todos (${withoutParent}) SELECT ${withoutParent} FROM src_todos.todos`);
        // Pass 2: re-attach each edge whose parent actually exists.
        dest.exec(`
          UPDATE todos SET parentId = (SELECT s.parentId FROM src_todos.todos s WHERE s.id = todos.id)
          WHERE EXISTS (
            SELECT 1 FROM src_todos.todos s
            WHERE s.id = todos.id AND s.parentId IS NOT NULL
              AND EXISTS (SELECT 1 FROM todos p WHERE p.id = s.parentId)
          )`);
      });
      copyTodos();

      // Pass 3: record the edges that could not be re-attached. These are real dropped parents,
      // so the child survives parentless and the loss is written down rather than inferred later.
      const severed = dest.query(`
        SELECT s.id AS id, s.parentId AS missingParentId
        FROM src_todos.todos s
        WHERE s.parentId IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM todos p WHERE p.id = s.parentId)
      `).all() as Array<{ id: string; missingParentId: string }>;
      const noteOrphan = dest.prepare(
        'INSERT INTO migration_orphan (id, table_name, column_name, lost_value, noted_at) VALUES (?,?,?,?,?)',
      );
      const noteAll = dest.transaction(() => {
        for (const s of severed) noteOrphan.run(s.id, 'todos', 'parentId', s.missingParentId, stamp);
      });
      noteAll();
      report.severedParents = severed;
      report.copied.todos = (dest.query('SELECT COUNT(*) n FROM todos').get() as { n: number }).n;

      // Carry the source's `user_version` across. todo-store gates its one-shot backfills on it
      // (deriving `kind` from a title prefix, the bucket dedupe, the triageTag backfill …) and
      // the live todos.db sits at 11. A consolidated database starting at 0 would re-run every
      // one of them against data they have already been applied to — and the bucket dedupe
      // DELETES rows. schema_meta governs the consolidated schema; user_version keeps exactly the
      // value it had so the store's own gates retain their meaning.
      const srcUserVersion = Number(
        (dest.query('PRAGMA src_todos.user_version').get() as { user_version: number }).user_version,
      ) || 0;
      dest.exec(`PRAGMA main.user_version = ${srcUserVersion}`);
      report.copied.userVersion = srcUserVersion;
    } finally {
      dest.exec('DETACH DATABASE src_todos');
    }

    // ---- mission stores -----------------------------------------------------------------
    if (existsSync(io.missionPath)) {
      dest.exec(`ATTACH DATABASE '${io.missionPath.replace(/'/g, "''")}' AS src_mission`);
      try {
        const copyMission = dest.transaction(() => {
          // Mission control state is FK'd to its node. 93 of 108 mission-kind todos have no
          // mission row at all, which is fine (the FK runs the other way); but a mission row
          // whose node is missing cannot be inserted, so those are reported, not force-fitted.
          dest.exec(`
            INSERT OR IGNORE INTO mission
            SELECT * FROM src_mission.mission m WHERE EXISTS (SELECT 1 FROM todos t WHERE t.id = m.todoId)`);
          dest.exec(`
            INSERT OR IGNORE INTO mission_criterion
            SELECT * FROM src_mission.mission_criterion c WHERE EXISTS (SELECT 1 FROM todos t WHERE t.id = c.todoId)`);
          dest.exec('INSERT OR IGNORE INTO mission_recheck SELECT * FROM src_mission.mission_recheck');
          // Verdict history is audit: copied wholesale, including rows whose criterion is gone.
          dest.exec(`
            INSERT OR IGNORE INTO mission_criterion_verdict_history
            SELECT * FROM src_mission.mission_criterion_verdict_history`);
        });
        copyMission();

        for (const [table, key] of [['mission', 'todoId'], ['mission_criterion', 'todoId']] as const) {
          const lost = (dest.query(
            `SELECT COUNT(*) n FROM src_mission.${table} s
             WHERE NOT EXISTS (SELECT 1 FROM todos t WHERE t.id = s.${key})`,
          ).get() as { n: number }).n;
          if (lost > 0) report.violations.push(`${lost} ${table} row(s) reference a node absent from todos`);
        }
        for (const t of ['mission', 'mission_criterion', 'mission_recheck', 'mission_criterion_verdict_history']) {
          report.copied[t] = (dest.query(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
        }
      } finally {
        dest.exec('DETACH DATABASE src_mission');
      }
    }

    // ---- claims: imported ALREADY EXPIRED --------------------------------------------------
    const claim = dest.prepare(
      `INSERT OR IGNORE INTO leaf_claim (leafId, holder, epicId, acquiredAt, expiresAt, heartbeatAt)
       VALUES (?,?,?,?,?,?)`,
    );
    const importClaims = dest.transaction(() => {
      for (const f of io.inflight ?? []) {
        const exists = dest.query('SELECT 1 FROM todos WHERE id=?').get(f.leafId);
        if (!exists) continue; // a claim on a work item this project does not own is not ours
        // expiresAt == now ⇒ already lapsed. The sweeper reclaims it through the ordinary path;
        // no special "migrated" state, and no leaf left claimed by a process that no longer runs.
        claim.run(f.leafId, f.holder ?? 'migrated', f.epicId ?? null, stamp, stamp, stamp);
        report.expiredClaims.push(f.leafId);
      }
    });
    importClaims();
    report.copied.leaf_claim = report.expiredClaims.length;

    // ---- verification ----------------------------------------------------------------------
    const fkErrors = dest.query('PRAGMA foreign_key_check').all() as unknown[];
    if (fkErrors.length > 0) report.violations.push(`${fkErrors.length} foreign-key violation(s) after import`);

    return report;
  } finally {
    dest.close();
  }
}
