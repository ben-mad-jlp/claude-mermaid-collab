# impl-pool-4 — Coordinator pool routing

(Agent died mid-run after landing the code; summary reconstructed + verified by orchestrator.)

## What changed — src/services/coordinator-live.ts (+130/-10)
- **launchWorker** rewired from spawn-fresh-per-todo → **pool routing**:
  1. Resolve pool type: `todo.type ? todoTypeToPoolType(todo.type) : (files ? poolTypeForFiles(files) : 'general')`.
  2. `findIdleSessionForType(poolType)` → reuse a warm idle session if present.
  3. Else `getOrCreateSlot(poolType)` → if a slot is granted, name = `poolSessionName(poolType, slot)`; if at capacity (undefined) → **defer** (return false, todo stays ready) + audit `reason:'pool-busy-deferred'`.
  4. `ensureSession({project, session: poolName, allowedTools, model, runtimeMode})` (idempotent — reuses live bound session) → `runTodoInSession({session: poolName, invokeSkill:'/mermaid-collab:worker '+id, tmux})` → `markBusy(poolName, id)`.
  5. Preserves POOL-2 auto-subscribe + spawn audit; `updateTodo` sessionName = poolName.
- **completeTodo**: on completion, `markIdle(session)` → **keep-warm** (slot freed for next todo, session NOT killed).
- **reapDeadClaims**: only iterates in_progress todos; `isTmuxAlive` → `continue` (warm idle pool sessions are never reaped); only a hard-dead worker reclaims its todo, then `markIdle(session)` frees the wedged slot.

## Constraints honored
1 session/type · lazy-spawn · keep-warm (watchdog is sole recycler; no idle-kill) · supervised auto-accept (runtimeMode unchanged = profile 'edit' = interactive) · general-1 for default/untyped.

## Verify
`npx tsc --noEmit` clean. `bun test src/services/__tests__/coordinator-live.test.ts` → **17 pass / 0 fail** (covers same-type reuse → one session; two-type → two named sessions; at-capacity → deferred; complete → slot idle not killed; idempotent re-subscribe). Not committed.

## For POOL-5 (live smoke)
Confirm end-to-end on a real tmux: two same-type ready todos → one `<type>-1` session takes both sequentially (no re-spawn); two types → two named sessions both in Watching; warm session survives across todos; watchdog recycle leaves it usable.
