# Blueprint: PCS Phase 2a — Coordinator deterministic core

## Source Artifacts
- design-pcs-gaps-and-buildplan (Phase 2), design-pcs-open-problems (#1 acceptance, #2 claim/lease, #3 unblock), design-planner-coordinator-supervisor (decisions 1,2,3,5).
- Grounded in `src/services/todo-store.ts` (Phase 1: TodoStatus, claimTodo, releaseExpiredClaims, listReadyTodos, computeWaves already exist).

## Scope guard
Phase 2a = the **pure, testable state-machine + planning core** the Coordinator daemon will later drive. NO live worker spawning, NO Agent SDK, NO Supervisor, NO UI, NO cross-machine/single-writer, NO roadmap-store changes. Those are Phase 2b / Phase 0. Additive.

### Status semantics (encode in code comments — the model this phase formalizes)
- `planned` — proposed by the planner, **NOT yet approved** (human hasn't approved the plan).
- `ready` — approved AND all deps done → **claimable** by the coordinator.
- `blocked` — approved BUT deps still pending → becomes `ready` when its last dep completes.
- `in_progress` — claimed (claimToken set).
- `done` — complete.
- `dropped` — abandoned.
Only the **planner** moves `planned → ready/blocked` (approval). The **coordinator core** only moves `blocked → ready` (dep-completion) and `ready → in_progress` (claim) and `→ done` (completion). It never approves (`planned` is untouched here).

---

## 1. Structure Summary

### Files
- [ ] `src/services/todo-store.ts` — add `completeTodo(project, id, acceptanceStatus?)` (done + unblock dependents blocked→ready). (MODIFY)
- [ ] `src/services/__tests__/todo-store.test.ts` — tests for completeTodo. (MODIFY)
- [ ] `src/services/coordinator-core.ts` — NEW pure module: `planCoordinatorTick(todos, now)`. (CREATE)
- [ ] `src/services/__tests__/coordinator-core.test.ts` — NEW tests. (CREATE)

### Type Definitions
```ts
// todo-store.ts
export interface CompleteTodoResult { completed: Todo; promoted: string[]; }

// coordinator-core.ts
export interface CoordinatorTickPlan { toClaim: string[]; toRelease: string[]; }
export function planCoordinatorTick(todos: Todo[], now: string): CoordinatorTickPlan;
```

### Component Interactions
`completeTodo` is what a (future) worker-completion handler calls; its `promoted` result is the set of dependents that just became claimable. `planCoordinatorTick` is the pure decision the future daemon runs each tick: given the project's todos + now, it returns which `ready` todos to claim and which expired `in_progress` claims to release — the daemon then calls the existing `claimTodo` / `releaseExpiredClaims`. No side effects here.

---

## 2. Function Blueprints

### `completeTodo(project, id, acceptanceStatus?): Promise<CompleteTodoResult>`
**Pseudocode:** withLock(project) → load existing (throw if missing) → set status='done', completedAt=now, acceptanceStatus = given ?? existing → write. Then **unblock pass**: load all todos; build id→status map (with this one now 'done'); for every todo with status==='blocked' whose every dep id present-in-map has status==='done', update it to status='ready' (collect its id into `promoted`). Return { completed: getTodo(id), promoted }.
**Error handling:** missing id → throw (consistent with updateTodo). Deps referencing missing ids are ignored (treated satisfied).
**Edge cases:** a `blocked` todo with a still-pending dep → NOT promoted; a `planned` todo whose deps are done → NOT promoted (only planner approves); completing an already-done todo → idempotent (stays done, re-runs unblock harmlessly). acceptanceStatus omitted → leave existing.
**Test strategy:** done+completedAt set; acceptance set when given; blocked-with-all-deps-done → promoted to ready; blocked-with-one-pending-dep → stays blocked; planned-with-deps-done → stays planned; promoted ids returned.

### `planCoordinatorTick(todos: Todo[], now: string): CoordinatorTickPlan` (coordinator-core.ts — PURE)
**Pseudocode:** 
- `toClaim` = ids of todos where status==='ready' AND every dep id present in the set has status==='done' (same readiness rule as listReadyTodos, but pure over the passed array).
- `toRelease` = ids of todos where status==='in_progress' AND claimLeaseMs != null AND `new Date(claimedAt).getTime() + claimLeaseMs < new Date(now).getTime()`.
- return { toClaim, toRelease }.
**Error handling:** pure; tolerate null claimedAt/claimLeaseMs (skip from toRelease); empty input → {toClaim:[],toRelease:[]}.
**Edge cases:** ready with pending dep → not in toClaim; in_progress with null lease → never released; unknown dep ignored.
**Test strategy:** ready-no-deps + ready-deps-done → toClaim; ready-pending-dep → excluded; expired in_progress → toRelease; unexpired / null-lease in_progress → excluded; empty → empty.
**Note:** kept pure (no DB) so the daemon (2b) owns side effects via existing claimTodo/releaseExpiredClaims; this is unit-testable in isolation and reused by the System Map / dry-run later.

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: complete-todo
    files: [src/services/todo-store.ts]
    tests: [src/services/__tests__/todo-store.test.ts]
    description: "Add completeTodo(project,id,acceptanceStatus?) — set done+completedAt+acceptanceStatus, then unblock pass promoting blocked todos whose deps are all done to ready; returns {completed, promoted}. Document the status semantics (planned/ready/blocked/in_progress/done/dropped) in comments. Tests: done+acceptance, blocked→ready promotion, blocked-with-pending-dep stays, planned stays."
    parallel: true
    depends-on: []
  - id: coordinator-core
    files: [src/services/coordinator-core.ts]
    tests: [src/services/__tests__/coordinator-core.test.ts]
    description: "NEW pure module: planCoordinatorTick(todos, now) → {toClaim (ready+deps-done ids), toRelease (expired in_progress ids)}. No DB/side effects. Import Todo type from todo-store. Tests: claim selection, release selection, null-lease skip, unknown-dep, empty."
    parallel: true
    depends-on: []
```

### Execution Waves
**Wave 1 (parallel):** complete-todo, coordinator-core
*(Independent files; coordinator-core only imports the `Todo` type, which already exists from Phase 1.)*

### Summary
- Total tasks: 2
- Total waves: 1
- Max parallelism: 2
