# Debug: ui/reviewer leaf reverts to `blocked` after commit (todo a6fcbd79)

## Symptom
At level=drive, every `type:ui` and `type:reviewer` leaf built + committed its work to the epic branch, went idle, then REVERTED to `status='blocked'` while all its `dependsOn` were `done` (invariant `blocked-on-nothing`), with `acceptanceStatus=null`, `retryCount=0`. Only a manual `update_session_todo status=ready` re-promote un-stuck it. `type:backend` leaves in the same run finalized normally (done+accepted).

## Root cause
`detectStalls` in `src/services/coordinator-live.ts` (loop at ~line 1205, park block ~1316-1340) iterates `in_progress` todos and, when a worker is "idle at its prompt past `STALL_MS` with no progress and no escalation filed", files an escalation and PARKS the todo `blocked` (`releaseClaim` + `updateTodo status:'blocked'` + `markIdle`).

A worker that has **finished** — built its change-set and got it committed onto the epic branch — and is now sitting idle at its prompt while its `complete_todo` handshake is still in flight (or about to fire) is **byte-identical** to a genuinely stalled worker: alive, no spinner, durable pulse gone quiet. The stall reaper fired on that finished-but-idle state and parked the `in_progress` leaf `blocked`. Because completion never ran, `acceptanceStatus` stayed `null` and `retryCount` stayed `0` — exactly the observed end-state (the stall park leaves acceptance untouched; reclaim, which bumps retryCount, never ran). This matches the field state precisely: it is NOT a stranded-accept reversal (those re-open to `ready` and keep retry), it is the stall path firing pre-completion.

Evidence (file:line, `src/services/coordinator-live.ts`):
- `detectStalls` iterates only `in_progress`: line ~1205 `for (const t of listTodos(project, { status: 'in_progress' }))`.
- Durable idle clock = the lane's last status pulse: `lanePulseAt` line 285-289; `STALL_MS` (default 3 min) line 308.
- Stall park: `await releaseClaim(...); await updateTodo(..., { status: 'blocked' }); markIdle(session)` line ~1336-1338.
- The store stall-park keeps `acceptanceStatus` as-is and does not bump `retryCount` (`completeTodo`/reclaim are the only paths that touch those) — `src/services/todo-store.ts` 782-855, reclaim 511-590.

## Why backend was unaffected
Nothing structural — a **race**. `type:backend` workers' `complete_todo` handshake reliably lands before `STALL_MS` elapses, so the todo is already `done` (out of the `in_progress` set) before the stall reaper looks. `type:ui` (slower `bun`/`tsc` frontend gate) and `type:reviewer` (read-only review + report path) go quiet at the prompt longer, so the stall timer overtakes their completion. Same code path; different timing.

## The fix (minimal, scoped)
Add a FALSE-STALL guard in `detectStalls`: before classifying/escalating/parking a worker as stalled, check whether its work is already committed on the epic branch — i.e. the worker is finished and completion is in flight. If so, `continue` (skip) and let the completion / roll-up path finalize it `done+accepted`.

- New exported helper `workCommittedOnEpic(project, todo)` (`coordinator-live.ts`, after `resolveEpicId`): returns `true` only when worker isolation is on, the project is a git repo, and `WorktreeManager.todoOnEpicBranch(epicId, todo.id)` is true. Any probe failure / isolation-off returns `false` (fail-safe — the existing wedge-recovery behaviour is preserved for workers whose status we can't confirm). Mirrors the existing `todoOnEpicBranch` guard already used by `sweepStrandedAccepted` (line ~488).
- Guard call inserted right after the `now - pulseAt < STALL_MS` early-continue: `if (await workCommittedOnEpic(project, t)) continue;`.

This guarantees a finished worker that has committed is never parked `blocked` as a false stall, while a genuinely idle worker with no commit still gets the full stall-recovery treatment.

## Test added
`src/services/__tests__/coordinator-false-stall.test.ts` (bun:test + real-git temp repo, mirroring `coordinator-bp0-sweep.test.ts`; deterministic, no tmux/Claude):
1. A `type:ui` leaf whose Collab-Todo trailer IS on the epic branch → `workCommittedOnEpic` returns `true` (stall park suppressed → leaf can finalize done+accepted).
2. A `type:reviewer` leaf with no commit on the epic branch → returns `false` (normal stall handling retained / fail-safe).

## Results
- `bun test src/services/__tests__/coordinator-false-stall.test.ts` → 2 pass / 0 fail.
- `bun test` (isolated) coordinator-live (27 pass / 2 fail — the 2 failures `resolveWorkerProfile` + `launchWorker` PRE-EXIST on the clean tree, unrelated), coordinator-bp0-sweep (1 pass), coordinator-daemon (22 pass) — no regressions from this change.
- `npx tsc --noEmit` → clean.
- Note: `src/services` tests are `bun:test` files; vitest cannot import `bun:test`, so `npx vitest run src/services` reports those files as load-failures (pre-existing, not caused by this change). The suite is run under `bun test`.

Changes left in the working tree (not committed): `src/services/coordinator-live.ts`, `src/services/__tests__/coordinator-false-stall.test.ts`.
