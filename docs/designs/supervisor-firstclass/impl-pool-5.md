# impl-pool-5 — Live smoke for the typed-session pool

New file: `scripts/smoke-pool-live.ts` (mirrors `scripts/smoke-coordinator-live.ts`). No `src/` edits.

## Pattern (same as coordinator smoke)
Throwaway temp project, isolated `MERMAID_SUPERVISOR_DIR`, REAL tmux `claude` spawns via `deps.launchWorker`, but completion is **simulated** via `handleWorkerComplete(deps, project, todoId, 'accepted')` — never waits for a worker to finish (they run supervised/interactive and would stall). Assertions key off the deterministic surfaces: the in-memory pool registry (`listPool()`), descriptive session naming, and the supervisor Watching list. `check()/tmuxExists()/tmuxKill()` helpers; `resetPool()` for deterministic slot indices; try/finally cleanup of all `<type>-1` tmux sessions + a defensive prefix sweep + temp dir.

## What it covers
1. **Typed naming + spawn** — ready `backend` todo → `launchWorker` → `listPool()['backend-1'].status==='busy'`, `currentTodoId===todo`, `todo.sessionName==='backend-1'`. (tmux `mc-<slug>-backend1` existence asserted as a 🟢 informational note, tolerant of flaky claude bind.)
2. **Keep-warm reuse** — `handleWorkerComplete` → `backend-1` goes `idle` (no currentTodoId), todo `done`, and the **tmux session STILL EXISTS** (not killed) — hard assertion when it was live pre-complete. A 2nd `backend` todo → routes to the SAME `backend-1` (exactly one backend slot, busy again on the 2nd todo, sessionName `backend-1`).
3. **Two types → two named sessions** — add a `frontend` todo → registry has both `frontend-1` and `backend-1`, both busy, both present in `listSupervised()` filtered to the temp project (Watching list).
4. **Capacity defer** — with `backend-1` busy (slot budget 1), a 3rd concurrent `backend` todo → `launchWorker` returns **false**, todo keeps NO sessionName, still exactly one backend slot. (No real second spawn.)
5. **Watchdog recycle** — NOT driven live (can't force a real `/clear` deterministically); noted as covered by the context-watchdog unit tests rather than blocking the smoke.

## Run output
`npx tsc --noEmit` clean. `bun run scripts/smoke-pool-live.ts` → **✅ ALL PASS — 25 passed, 0 failed** (exit 0). Real `backend-1` + `frontend-1` tmux sessions were created and killed in cleanup; temp project removed. tmux-existence notes were all 🟢 on this run (claude bound fine), but they're informational by design.

## Caveats / notes
- **Direct-call path skips claimTodo.** Calling `deps.launchWorker` directly (rather than a full coordinator tick) does NOT flip todo `status` to `in_progress` — that's `claimTodo`'s job, the tick step BEFORE `launchWorker`. So launched todos stay `ready`; the binding `launchWorker` owns is `sessionName` + the pool slot, which is what's asserted. (Reported as a 🟢 note, not a failure — initial draft wrongly asserted `status!=='ready'`, corrected.)
- tmux-existence checks are intentionally tolerant: tmux creates the session before `claude` attaches, so naming + registry + Watching are the source of truth if a real spawn is flaky.
- No POOL-4 wiring bugs found.

## Files
- `scripts/smoke-pool-live.ts` (added)
