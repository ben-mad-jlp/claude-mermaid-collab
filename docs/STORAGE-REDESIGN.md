# Storage redesign — one correct store per project

Status: DESIGN, not yet implemented.
Date: 2026-08-10.

This is the durable storage design for the collab work-graph. It replaces a layout that grew
piecemeal into 32 SQLite files across two scopes. Everything in the "Evidence" section was
measured on this machine on 2026-08-10, not estimated.

## Evidence the current layout is wrong

1. **Ghost stores.** 18 of 32 `.db` files are zero bytes. Five logical stores exist as files in
   BOTH `<repo>/.collab/` and `~/.mermaid-collab/`; the empty twin opens successfully and returns
   no rows, so a caller reading the wrong one silently concludes "no data" instead of failing.
   `worker-ledger.db` is 0 bytes project-local and 882MB global; `todos.db` is the reverse.

2. **One entity spans three databases.** A leaf's identity lives in `todos.db`, its execution
   state in the global `worker-ledger.db`, its acceptance criteria in `mission.db`. Cross-database
   means no foreign key can be declared and no transaction can span them.

3. **The drift is not hypothetical.** Measured live:
   - `todos.status='in_progress'` = 2 while `leaf_inflight` = 0 (those leaves are orphaned and
     only a manual `reset_todo` recovers them)
   - 3 `leaf_blueprint` rows reference deleted todos

4. **Project identity is an absolute path string** repeated as a join key in every global table. A
   worktree path and its repo root normalise differently in places, silently creating a parallel
   universe of rows.

5. **No schema ownership.** A 212MB index (`idx_bgtr_project_test`) that no query uses — nothing
   filters by its second column. Indexes larger than their tables (`base_gate_test_run`: 314MB
   table, 212MB + 126MB indexes). Two empty tables for one concept (`test_pin`, `leaf_test_pin`,
   both keyed `leafId`). A missing `(project, observedAt)` index made a 3,396-row read cost 117ms
   by walking 1.6M index entries; adding it took the same query from 5445ms to 0.9ms.

6. **Unbounded telemetry.** `base_gate_test_run` grows 739k rows/day because each gate run writes
   back every previously-observed test. 1.6M rows for ~2,400 distinct tests.

## Target

### T1. One database per project

`<repo>/.collab/collab.db` holds the ENTIRE work-graph and its execution state, so foreign keys
and transactions apply to the things that must agree. The global store keeps only what is
genuinely cross-project: the project registry, supervisor identity, watched projects/sessions,
and user config.

Rejected alternative (Grok's counter-proposal): keep high-churn execution tables global, keyed by
project UUID, with only a thin claim row per project. Rejected because it preserves exactly the
property that causes the drift — the claim and the work item it refers to would still be in
different databases, so the invariant "a claimed leaf has a live lease" still could not be
enforced by the engine. Checkpoint-hotspot concerns are a tuning problem, not a correctness one.

### T2. Stable project identity

A project gets a UUID at registration, stored in its own database and in the global registry. The
absolute path is recorded ONCE in the registry and is never a join key. Path canonicalisation
happens at registration, so a worktree can never mint a second project.

This lands FIRST, before any consolidation — migrating on the current path key would faithfully
reproduce the duplicate-project bug in the new schema.

### T3. Explicit typed work items

```
work_item(id, project_id, kind, parent_id → work_item.id, title, status, created_at, updated_at)
mission(work_item_id → work_item.id, …)     -- kind='mission'
epic(work_item_id → work_item.id, …)        -- kind='epic'
leaf(work_item_id → work_item.id, …)        -- kind='leaf'
```

The shared tree (identity, parent, status) stays one table so tree queries stay simple; kind-
specific columns move to detail tables so they can carry real NOT NULL constraints. `PRAGMA
foreign_keys=ON`, with `ON DELETE CASCADE` from `work_item` to detail tables and children — which
also replaces the hand-written drop-cascade that has orphaned children before.

### T4. Claims are leases, and leases expire

```
leaf_claim(leaf_id → leaf.work_item_id PK, holder, acquired_at, expires_at, heartbeat_at)
```

A claim is only valid while `expires_at` is in the future. The holder renews it; a sweeper
releases expired ones. This is a correctness requirement, not a convenience: the daemon is killed
with SIGKILL, which cannot roll back a transaction or run a cleanup path, so "in progress" must be
a fact with an expiry rather than a status someone remembered to clear. Every orphaned leaf we
have hand-reset was this bug.

### T5. Telemetry is aggregated, not journalled

`base_gate_test_run` becomes a rollup keyed `(project_id, lane, test, day)` carrying `runs` and
`fails`, which is all any consumer actually reads. That is ~2,400 rows/day instead of 739k, and it
removes the write-back amplification at the source. Raw per-run rows, if ever needed for
debugging, go to a separate short-retention table that nothing on the hot path reads.

### T6. Access is off the liveness thread

`bun:sqlite` is synchronous, so any query blocks the event loop that also answers the health
probe — which is why a slow query reads as a dead process and earns a SIGKILL (477 of them between
2026-07-23 and 2026-08-10). DB access moves behind an async boundary. Liveness is reported from a
heartbeat the main loop stamps, so "busy" and "dead" stop being the same signal.

A query-duration tripwire in CI fails the build when a hot query exceeds its budget against a
realistically-sized fixture — generalising the existing sync-spawn tripwire from "no sync spawns"
to "no unbounded blocking work".

## Sequencing

Each phase is independently shippable and verifiable.

There is deliberately NO "stabilise the current tables first" phase. The obvious candidates — the
missing `(project, observedAt)` index, the 259× N+1 in `closeQuarantineOnGreen`, dropping the dead
212MB index — all target `base_gate_test_run`, a table T5 deletes. Fixing them would be throwaway
work, and the usual justification ("we cannot migrate on a daemon that keeps dying") does not hold:
the migration runs against a STOPPED daemon, so the kill loop obstructs the daemon operating, not
the migration. The kill loop is cured by T5 and T6 rather than worked around before them.

- **P1 — identity.** Project UUID + canonical registry. Store resolver throws on a non-canonical
  path instead of opening an empty file. Delete the 18 ghost files. FIRST, because migrating on
  the current absolute-path key would faithfully reproduce the duplicate-project bug in the new
  schema.
- **P2 — consolidation.** New `collab.db` schema with FKs, typed work items, expiring leases, and
  the telemetry rollup. Versioned migration, one project at a time, against a quiesced daemon,
  with a verification pass (row counts + referential checks) and a retained backup. Reversible
  until the old files are deleted. The rollup is built here rather than in a later phase — there
  is no reason to migrate 1.6M rows of a table being replaced by ~2,400 rows/day.
- **P3 — async DB boundary, heartbeat liveness, query-duration tripwire.**

## Migration must be a capability, not an event

Databases do NOT travel with the repo (`.gitignore:33` ignores `/.collab/*.db`, and the global
store lives in `~/.mermaid-collab/`). So every machine holds its own databases, and a machine that
pulls this change gets NEW CODE against ITS OWN OLD DATA. The migration therefore has to be a
permanent, automatic capability that runs wherever the code lands — not something performed once
on the machine where it was written.

(Note: `.collab/kodex/kodex.db` IS tracked, because `/.collab/*.db` matches only the top level.
Either widen the ignore or move it; a tracked database will conflict on merge and cannot be
migrated per-machine.)

Requirements:

1. **Every database carries its schema version.** A `schema_meta(version, applied_at)` table
   written in the same transaction as the migration that set it. `PRAGMA user_version` alone is
   too coarse: it cannot record when or by which build.

2. **Forward migration runs on open, per store, in one transaction.** Idempotent, ordered, and
   resumable — a migration interrupted by a SIGKILL (which this daemon receives regularly) must
   leave the database either fully at version N or fully at N-1, never between.

3. **A database newer than the code is REFUSED, loudly.** If `schema_meta.version` exceeds the
   version the running build understands, opening throws. Without this, a machine still on the old
   build silently writes old-shaped rows into a new-shaped database — the corruption is invisible
   until something reads it. This is the multi-machine failure mode that matters most: two machines
   on different builds sharing one checkout's databases via a synced home directory, or a user
   rolling back a bad release.

4. **A backup is taken before any migration that rewrites data**, retained until the next clean
   start, with the restore path named in the log line.

5. **Ghost files are quarantined, not deleted.** The sweeper moves unowned `.db` files to
   `.collab/.trash/<timestamp>/` rather than unlinking them, so a misclassification is
   recoverable. Deletion is a separate, explicit operation.

6. **Migration is verifiable offline.** A `migrate --dry-run --verify` mode reports what would
   change and runs the verification pass below against a copy, so a machine's migration can be
   rehearsed before it is trusted with live data.

## Verification

A migration is accepted only if, for the migrated project: every pre-migration work item exists
post-migration with the same id and status; no FK violation (`PRAGMA foreign_key_check` empty);
every orphan present before is either migrated with an explicit tombstone or reported, never
silently dropped; and the full backend gate is green at the same baseline.
