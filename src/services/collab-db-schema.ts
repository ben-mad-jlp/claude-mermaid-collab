/**
 * collab-db-schema.ts — the consolidated per-project database.
 *
 * WHAT THIS FIXES. A project's work-graph is spread over three databases: identity and state in
 * `.collab/todos.db`, acceptance criteria in `.collab/mission.db`, and execution state in the
 * GLOBAL `~/.mermaid-collab/worker-ledger.db`. Cross-database means SQLite can enforce nothing
 * between them and no transaction can span them, so consistency exists only where application
 * code remembers to maintain it. Measured on a live machine (2026-08-10): `todos.status`
 * reported 2 leaves running while `leaf_inflight` held 0 rows — those leaves were orphaned and
 * recoverable only by hand — plus 3 `leaf_blueprint` rows pointing at deleted todos. That drift
 * is the schema's resting state, not an incident.
 *
 * SCOPE OF THIS FILE. It creates ONE database holding the entities that must agree with each
 * other, with real foreign keys between them. It deliberately does NOT restructure `todos` into
 * typed `work_item`/`mission`/`epic`/`leaf` tables: that is a modelling improvement over a
 * 3,300-line store and ~500 dependent test files, and it is far safer to perform INSIDE a single
 * database once the entities already live together. Cross-database is the correctness defect;
 * table shape is the follow-up.
 *
 * WHAT STAYS OUT, AND WHY (see docs/STORAGE-REDESIGN.md §T4b). The event log — `worker_ledger`,
 * gate history, `conductor_pass`, the test-run rollup — stays global and FK-FREE by design. A row
 * saying "this gate failed for epic X" remains true after epic X is dropped; 63 `epic_base_gate`,
 * 66 `epic_land_gate` and 163 `leaf_resume_decision` rows already reference deliberately-deleted
 * referents. Enforcing integrity there would mean refusing to record history or deleting it later.
 * `tier_override` stays global because its `scope='level'` rows are cross-project by meaning.
 */
import type { Database } from 'bun:sqlite';
import type { Migration } from './schema-migrate';

/**
 * v1 — the consolidated schema.
 *
 * Foreign keys are declared here but only ENFORCE when a connection sets `PRAGMA foreign_keys=ON`
 * (SQLite defaults it off, per-connection). The store's open path is responsible for that; the
 * declaration is inert without it, which is exactly the sort of dormant-guard trap worth naming.
 */
const V1_CREATE: Migration = {
  version: 1,
  name: 'consolidated-work-graph',
  up: (db: Database) => {
    // ---- work items -------------------------------------------------------------------
    // Mirrors today's `todos` shape so the data move is a copy rather than a reinterpretation.
    // Two constraints are TIGHTENED because the inventory proved they already hold: `id` becomes
    // NOT NULL (the current TEXT PK permits NULL, unenforced), and `kind` is constrained to the
    // five values in use (leaf 2303, epic 603, mission 108, land 72, gate 19).
    db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY NOT NULL,
        ownerSession TEXT NOT NULL,
        assigneeSession TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority INTEGER,
        dueDate TEXT,
        parentId TEXT REFERENCES todos(id) ON DELETE CASCADE,
        dependsOn TEXT NOT NULL DEFAULT '[]',
        ord REAL NOT NULL,
        link TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT,
        sessionName TEXT,
        type TEXT,
        acceptanceStatus TEXT,
        claimedBy TEXT,
        claimToken TEXT,
        claimedAt TEXT,
        claimLeaseMs INTEGER,
        retryCount INTEGER NOT NULL DEFAULT 0,
        targetProject TEXT,
        assigneeKind TEXT NOT NULL DEFAULT 'agent',
        completedBy TEXT,
        executedBySession TEXT,
        approvedAt TEXT,
        approvedBy TEXT,
        heldAt TEXT,
        heldReason TEXT,
        claim TEXT,
        kind TEXT CHECK (kind IN ('mission','epic','leaf','land','gate')),
        inheritedBlueprintFrom TEXT,
        inheritedFiles TEXT,
        servesCriterionId TEXT,
        servesCriterionIds TEXT,
        isBucket INTEGER NOT NULL DEFAULT 0,
        bucketType TEXT,
        triageTag TEXT,
        promotedTo TEXT,
        tier TEXT,
        landedAt TEXT,
        hollowLandedAt TEXT,
        reserveCount INTEGER NOT NULL DEFAULT 0,
        supersedes TEXT,
        reservedByActor TEXT,
        reservedReason TEXT,
        archivedAt INTEGER,
        baseMovedRefunds INTEGER NOT NULL DEFAULT 0,
        baseRepair INTEGER NOT NULL DEFAULT 0,
        declaredFiles TEXT,
        nickname TEXT,
        consumedAt TEXT,
        exploreSpec TEXT,
        objectRef TEXT,
        decisionRef TEXT,
        claimProbe TEXT,
        -- DEAD but RETAINED. Both hold 0 non-null rows on the live database, yet the store's
        -- INSERT/UPDATE statements and the Todo type still name them. Dropping a column here
        -- while the code still writes it is a reinterpretation of the data, not a copy of it —
        -- so they stay until a separate change removes them from the type, the store and the
        -- fixtures together. Retiring them belongs in a migration, not in the move.
        asanaGid TEXT,
        blueprintId TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_todos_owner ON todos(ownerSession);
      CREATE INDEX IF NOT EXISTS idx_todos_assignee ON todos(assigneeSession);
      CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
      CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parentId);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_bucket_singleton
        ON todos(targetProject, bucketType) WHERE bucketType IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_todos_hot ON todos(status) WHERE archivedAt IS NULL;
    `);

    // ---- mission control state + acceptance criteria -----------------------------------
    // Previously a separate FILE, so `mission.todoId → todos.id` could not be enforced and a
    // mission row could outlive its node. Same database now, so it is a real foreign key.
    db.exec(`
      CREATE TABLE IF NOT EXISTS mission (
        todoId TEXT PRIMARY KEY NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        lastNudgeAt INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        abandonedAt INTEGER,
        budgetUsd REAL,
        lastNudgeKey TEXT,
        handoffDocId TEXT,
        awaitingApprovalSince INTEGER,
        lastConductorKey TEXT,
        archivedAt INTEGER,
        queuePos INTEGER,
        lastConductorPassAt INTEGER,
        lastConductorSelfKey TEXT,
        closedAt INTEGER,
        lastConductorTimeoutKey TEXT,
        forgeState TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mission_hot ON mission(active) WHERE archivedAt IS NULL;

      CREATE TABLE IF NOT EXISTS mission_criterion (
        id TEXT PRIMARY KEY NOT NULL,
        todoId TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        met INTEGER NOT NULL DEFAULT 0,
        "order" INTEGER NOT NULL DEFAULT 0,
        updatedAt INTEGER NOT NULL,
        evidence TEXT,
        verifiedBy TEXT,
        verifiedAt INTEGER,
        verifiedAtSha TEXT,
        evidencePaths TEXT,
        reopenCount INTEGER NOT NULL DEFAULT 0,
        lastReopenSha TEXT,
        type TEXT NOT NULL DEFAULT 'capability',
        dependsOn TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        droppedReason TEXT,
        droppedAt INTEGER,
        droppedBy TEXT,
        verifyAttemptCount INTEGER NOT NULL DEFAULT 0,
        serveAttemptCount INTEGER NOT NULL DEFAULT 0,
        nickname TEXT,
        measurementPendingUntil INTEGER,
        reArmCount INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_mission_criterion_todo ON mission_criterion(todoId);

      CREATE TABLE IF NOT EXISTS mission_recheck (
        criterionId TEXT PRIMARY KEY NOT NULL,
        todoId TEXT NOT NULL,
        reason TEXT NOT NULL,
        landedSha TEXT,
        enqueuedAt INTEGER NOT NULL
      );
    `);

    // Verdict history is an AUDIT table: it records what a criterion was judged to be at a point
    // in time. 6 of 10 existing rows already reference criteria that were later dropped, so it
    // carries no foreign key for the same reason the event log does not — the judgement remains a
    // true fact about the past after its subject is gone.
    db.exec(`
      CREATE TABLE IF NOT EXISTS mission_criterion_verdict_history (
        id TEXT PRIMARY KEY NOT NULL,
        criterionId TEXT NOT NULL,
        todoId TEXT NOT NULL,
        met INTEGER NOT NULL,
        evidence TEXT,
        verifiedBy TEXT,
        verifiedAt INTEGER,
        verifiedAtSha TEXT,
        evidencePaths TEXT,
        clearedAt INTEGER NOT NULL,
        clearReason TEXT,
        reopenSha TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mcvh_criterion ON mission_criterion_verdict_history(criterionId);
    `);

    // ---- claims are LEASES, and leases expire ------------------------------------------
    // Replaces the global `leaf_inflight` table. Two changes, both correctness:
    //
    //  1. It lives with the leaf, so "a claimed leaf exists" is enforced by the engine rather
    //     than remembered by application code. The measured drift (todos said 2 running,
    //     leaf_inflight said 0) is unrepresentable here.
    //  2. A claim EXPIRES. The daemon is killed with SIGKILL by its liveness watchdog — 477
    //     times between 2026-07-23 and 2026-08-10 — and SIGKILL cannot roll back a transaction
    //     or run a cleanup path. "In progress" therefore cannot be a status someone is trusted
    //     to clear; it must be a fact with a deadline that a sweeper can reclaim. Every orphaned
    //     leaf reset by hand was this bug.
    db.exec(`
      CREATE TABLE IF NOT EXISTS leaf_claim (
        leafId TEXT PRIMARY KEY NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        holder TEXT NOT NULL,
        epicId TEXT,
        acquiredAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        heartbeatAt INTEGER NOT NULL,
        epoch TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_leaf_claim_expiry ON leaf_claim(expiresAt);
    `);
  },
};

/**
 * v2 — restore `asanaGid` / `blueprintId` on databases that were created by the FIRST cut of v1.
 *
 * PAID FOR IN AN INCIDENT (2026-08-10). v1 originally dropped both columns as dead. The store's
 * INSERT/UPDATE still name them, so that broke every write, and the fix was to put them back —
 * which I did by editing v1 in place, reasoning that v1 had never been applied anywhere real.
 * It had: leftover per-test project databases inside epic worktrees were already stamped
 * version 1. A database at v1 never re-runs v1, so those never received the columns, and every
 * epic base gate went red with `table todos has no column named asanaGid`.
 *
 * Editing an applied migration cannot work, whatever the migration says it does. A schema version
 * is a claim about what a database ALREADY CONTAINS; changing the code behind a version number
 * makes that claim false for every database that recorded it. The only repair is a new version.
 *
 * Additive and conditional, so it is a no-op on a database created by the current v1.
 */
const V2_RESTORE_LEGACY_COLUMNS: Migration = {
  version: 2,
  name: 'restore-asanagid-blueprintid',
  up: (db: Database) => {
    const have = new Set(
      (db.query('PRAGMA table_info(todos)').all() as Array<{ name: string }>).map((c) => c.name),
    );
    for (const col of ['asanaGid', 'blueprintId']) {
      if (!have.has(col)) db.exec(`ALTER TABLE todos ADD COLUMN ${col} TEXT`);
    }
  },
};

/**
 * v3 — the node-telemetry columns `leaf_claim` needs to actually REPLACE `leaf_inflight`.
 *
 * The global table carried `nodeKind` / `model` / `attempt` alongside the liveness bit, and three
 * read surfaces render them (the daemon-status in-flight list, the fleet worker card's "which node
 * is it on", and the api.ts in-flight route). Leaving them behind would have retired the table by
 * deleting information, which is not a migration — so the claim carries them too.
 *
 * A new version rather than an edit to v1, for the reason v2 exists: a database already stamped
 * with a version never re-runs it, so editing an applied migration silently skips the change
 * everywhere it has already been applied.
 */
const V3_CLAIM_NODE_COLUMNS: Migration = {
  version: 3,
  name: 'leaf-claim-node-columns',
  up: (db: Database) => {
    const have = new Set(
      (db.query('PRAGMA table_info(leaf_claim)').all() as Array<{ name: string }>).map((c) => c.name),
    );
    if (!have.has('nodeKind')) db.exec('ALTER TABLE leaf_claim ADD COLUMN nodeKind TEXT');
    if (!have.has('model')) db.exec('ALTER TABLE leaf_claim ADD COLUMN model TEXT');
    if (!have.has('attempt')) db.exec('ALTER TABLE leaf_claim ADD COLUMN attempt INTEGER');
  },
};

/** The ordered migration list for a project's consolidated database. Append only; never renumber. */
export const COLLAB_DB_MIGRATIONS: Migration[] = [
  V1_CREATE,
  V2_RESTORE_LEGACY_COLUMNS,
  V3_CLAIM_NODE_COLUMNS,
];

/**
 * Foreign keys are per-CONNECTION in SQLite and default to OFF, so every declaration above is
 * inert until this runs. Call it immediately after opening, before any statement — a schema whose
 * constraints never enforce is worse than none, because it reads as protected.
 */
export function enforceForeignKeys(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON');
}
