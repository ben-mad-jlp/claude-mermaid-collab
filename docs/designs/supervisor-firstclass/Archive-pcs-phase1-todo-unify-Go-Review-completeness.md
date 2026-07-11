# Completeness Review — PCS Phase 1

## Verdict: Functionally complete. 1 scope-guard deviation (minor, additive).

---

## Checklist

### 1. todo-store.ts
- [x] `TodoStatus` extended: `planned`, `ready`, `dropped` present alongside existing values.
- [x] All 8 new DDL columns present: `sessionName`, `blueprintId`, `acceptanceStatus`, `claimedBy`, `claimToken`, `claimedAt`, `claimLeaseMs`, `retryCount`.
- [x] `addColumnIfMissing` called for each of the 8 new columns (ALTER-on-open migration).
- [x] `Todo`, `TodoRow`, `CreateTodoInput`, `UpdateTodoPatch` all include new fields.
- [x] `rowToTodo` maps all new fields with null-coalescing.
- [x] `createTodo` inserts all 8 new columns (claim fields default null/0).
- [x] `updateTodo` patches `sessionName`, `blueprintId`, `acceptanceStatus`.
- [x] `claimTodo(project, id, claimedBy, leaseMs)` — atomic CAS via `UPDATE … WHERE status IN ('ready','todo') AND claimToken IS NULL`, returns Todo or null. Real body, correct.
- [x] `releaseExpiredClaims(project, now?)` — finds expired in_progress claims, resets to ready + increments retryCount. Real body, correct.
- [x] `listReadyTodos(project)` — ready todos whose every known dep is done; unknown deps ignored. Real body, correct.
- [x] `computeWaves(todos)` — Kahn layering, cycle/self-dep breaks to final wave. Real body, correct.
- [x] `importTodo` — INSERT OR IGNORE with caller-supplied id. Present.

### 2. session-todos.ts + setup.ts
- [x] `addSessionTodoSchema` includes `dependsOn`, `parentId`, `sessionName`; status enum has all 8 values.
- [x] `updateSessionTodoSchema` includes `dependsOn`, `parentId`, `sessionName`; status enum has all 8 values.
- [x] `listSessionTodosSchema` status enum has all 8 values.
- [x] `addSessionTodo` forwards extras via `...extrasRest` (includes dependsOn/parentId/sessionName).
- [x] `updateSessionTodo` explicitly threads `dependsOn`, `parentId`, `sessionName` into the `updateTodo` patch.
- [x] `setup.ts` dispatch for `add_session_todo` and `update_session_todo` destructures and passes the three new fields (lines 3364–3405).

### 3. roadmap-migration.ts
- [x] `migrateRoadmapToTodos(project)` present with real body.
- [x] Absent `roadmap.db` guard: `existsSync(roadmapPath)` returns `{migrated:0, skipped:true}` without creating the file.
- [x] Idempotency: sentinel todo `__roadmap_migration_v1__` checked via `getTodo` before running; written after completion.
- [x] Status map: `planned/ready/in_progress/blocked/done/dropped` all mapped 1:1; unknown → `'planned'`.
- [x] `importTodo` called with same id as roadmap item (deps resolve correctly).
- [x] `ord → order`, `parentId`, `dependsOn`, `sessionName`, `blueprintId`, `ownerSession='__roadmap__'` all threaded.
- [x] parentId backfill: `listItemTodos` join rows update linked todos' `parentId` if unset.
- [x] Does NOT delete `roadmap.db` or re-point any roadmap consumer.

### 4. server.ts wire-in
- [x] `migrateRoadmapToTodos(MERMAID_PROJECT)` called on boot at lines 92–99, wrapped in try/catch (non-fatal).

### 5. Tests
- [x] `todo-store.test.ts`: 28 tests covering claim CAS (ready→claimed, re-claim→null, planned→null, blocked→null, todo→claimed), releaseExpiredClaims (expired→ready+retryCount++, unexpired→untouched), listReadyTodos (no-deps, done-deps, pending-dep excluded, unknown-dep included), computeWaves (empty, linear, diamond, orphan, unknown-dep, cycle, self-dep), new-field round-trip.
- [x] `roadmap-migration.test.ts`: 5 tests covering field mapping+status map, idempotency (second run skipped), join→parentId backfill, absent-db (skipped+no-file-created), dependsOn refs preserved.
- [x] Wave summaries claim 33 pass (28 + 5). Test coverage matches all blueprint-specified cases.

### 6. Stub scan
- No `TODO`, `FIXME`, `Not implemented`, or empty function bodies found in any Phase 1 file.

---

## Scope Guard Verification

| Guard target | Status |
|---|---|
| `roadmap-store.ts` — not deleted, not re-pointed | INTACT. Import references unchanged. BUT: see deviation below. |
| `/api/supervisor/roadmap` route | INTACT. No re-pointing in supervisor-routes.ts diff. |
| `RoadmapPanel.tsx` | INTACT. No changes. |
| `supervisorStore` localStorage cache | INTACT. `roadmapByProject` hydration unchanged. |

### Scope deviation (minor)
**What**: `computeWaves(items: RoadmapItem[])` was added to `src/services/roadmap-store.ts` (28 lines), along with an untracked test file `roadmap-store.computeWaves.test.ts`. Neither was in the Phase 1 task list.

**Severity**: Low — purely additive, no deletion, no re-pointing of consumers, no behavioral change to existing roadmap functionality. The function is unused by any consumer yet.

**Classification**: Out-of-scope addition, not an over-reach in the harmful sense, but a scope-guard deviation. The blueprint scope guard says Phase 1 "must NOT … touch" roadmap-store; this change touched it additively.

**Recommendation**: Either retroactively add to Phase 1 scope (noting it's a harmless porting of the same algorithm), or defer the roadmap-store variant to Phase 5 when roadmap-store is being deprecated. Does not block Phase 1 sign-off.

---

## Known Deferrals (NOT gaps)
- **Acceptance-gate logic** (Phase 2): `acceptanceStatus` column exists; the gate enforcement logic is deferred.
- **Coordinator using `claimTodo`** (Phase 2): the primitive is ready; the daemon is deferred.
- **Per-project migration on `register_project`** (filed todo): currently migrates only `MERMAID_PROJECT` on boot; per-project lazy trigger is a filed follow-up.

---

## Summary
Phase 1 is **functionally complete**. All 3 tasks (todo-store, session-todos-mcp, roadmap-migration) are fully implemented with real bodies, no stubs, and test coverage matching the blueprint spec. The only issue is a minor scope-guard deviation: `computeWaves` was added to `roadmap-store.ts` (not in the Phase 1 task list), which is additive and harmless but technically out of scope.
