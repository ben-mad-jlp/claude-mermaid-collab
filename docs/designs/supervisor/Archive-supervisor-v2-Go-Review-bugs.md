# Bug Review (v2)

Scope: supervisor-v2 files only. Unrelated working-tree changes ignored.

## Important

### 1. Expired locks leak into list paths (UI shows stale lock forever)
- File: `src/services/supervisor-store.ts:184-187` (`listLocks`), consumed by `src/routes/supervisor-routes.ts:147,161,172` and `ui/.../SupervisorPanel.tsx:267-270` (`lockSet`).
- What's wrong: `isLocked()` correctly treats a lock as inactive once `expiresAt <= now`, but `listLocks()` returns ALL rows with no expiry filter. The GET `/api/supervisor/locks` endpoint and the UI `lockSet` therefore include expired locks. A session that was attended-locked will keep showing the 🔒 indicator in the SupervisorPanel indefinitely (until the lock is manually released or overwritten), even though it is logically unlocked per `isLocked`. Inconsistent source of truth between the two read paths.
- Fix: filter expired rows in `listLocks`:
  `return d.query('SELECT * FROM attended_lock WHERE expiresAt > ?').all(Date.now()) as AttendedLock[];`
  (Optionally also lazily DELETE expired rows.) This makes the list path agree with `isLocked`.

## Minor

### 2. Escalation dedup ignores `project`
- File: `src/services/supervisor-store.ts:205-208` (and index at line 76).
- The open-escalation dedup matches on `session + questionText + status='open'` only, not `project`. Two different projects with the same session name and identical question text would collapse into one escalation. Low likelihood given session names are typically unique, but the `project` column exists and should be part of the dedup key for correctness. Add `AND project = ?` to the SELECT and to `idx_esc_open`.

### 3. `read_last_assistant_turn` / transcript reader: torn last line is silently tolerated (acceptable)
- File: `src/services/transcript-reader.ts`.
- Tail-read math is correct: `readLen = min(size,256K)`, `start = size-readLen`; partial-leading-line dropped only when `start>0`; mid/last torn JSON lines simply fail `JSON.parse` and are skipped; `fh.close()` in `finally`; assistant + `end_turn` + `!isSidechain` filter correct; all error paths return `{found:false}`. No bug — noted only as reviewed.

## Verified correct (no bug)
- roadmap-store: SQL inserts/updates column-aligned; `dependsOn` JSON round-trips with try/catch default `[]`; `ord` = `MAX(ord)+10` (10 when empty); `updateItem` merge uses `!== undefined` per-field (preserves nulls); `deleteItem` cascades to `roadmap_item_todo`; `withLock` chains promises and swallows errors on the stored chain; `dbCache` per-project.
- supervisor-store: single cached `openDb`; `INSERT OR IGNORE` for watched/supervised; `INSERT OR REPLACE` for locks; `isLocked` expiry check correct.
- supervisor-routes: validation on each endpoint; `await` on all async roadmap calls; `/escalations/resolve` matched before `/escalations` (POST vs GET — order harmless but fine); `setLock` ttl-optional branch correct.
- setup.ts tools: `roadmap_spawn_session` ordering (addSessionTodo -> linkTodo per todo, then setItemSession, then addSupervised, then broadcast) correct; `addSessionTodo` 5th-arg `{assigneeSession}` matches signature; `supervisor_reconcile` computes `openTodos` only when supervised, uses `isLocked`, surfaces status/updatedAt; `listTodos(project,{session,includeCompleted:false})` matches signature; arg validation present; sync store calls not awaited (correctly — they are sync).
- supervisorStore (ui): `res?.ok` guards on every action; localStorage written only after server confirm; `roadmapByProject` merged immutably; `removeProject` also prunes roadmap cache; `resolveEscalation` in-place map update.
- SupervisorPanel: `liveStatus` key `${activeId}:${project}:${session}` consistent with poll map keys; `loadRoadmap` effect keyed on primitive `watchedKey` (no infinite loop); poll effect uses `cancelled` flag + `clearInterval`; null guards on `activeId`.
- SubscriptionsPanel: `useSupervisedSessions` has `cancelled` flag + `clearInterval` cleanup; `handleToggleSupervise` awaits invoke then `refresh()`; key `${project}:${session}` consistent.
- SKILL.md: documented tools match the 12 implemented tool names and arg shapes.
