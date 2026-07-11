# Blueprint: PCS Phase 2b — Coordinator daemon orchestration core (DI)

## Source Artifacts
- design-pcs-gaps-and-buildplan (Phase 2), design-pcs-open-problems (#1/#2), design-planner-coordinator-supervisor (decision 5: Coordinator = non-LLM daemon).
- Builds on Phase 1 (`claimTodo`, `releaseExpiredClaims`, `listReadyTodos`) + Phase 2a (`completeTodo`, `planCoordinatorTick`).

## Scope guard
Phase 2b = the daemon's **orchestration logic, fully testable via dependency injection**. The live, hard-to-test I/O (real tmux worker spawning, the tick scheduler, worker-completion detection, the mechanical acceptance gate running tsc/tests) is isolated behind injected deps and **deferred to Phase 2c**. NO Agent SDK, NO Supervisor, NO UI. Additive new module only.

What 2b does NOT include (Phase 2c, integration): a real `launchWorker` using `launchAndBind` + a chosen agent profile; the interval/event-wake scheduler that calls `runTick`; how a worker reports completion (it calls completeTodo via MCP) ; running the mechanical acceptance gate (tsc+tests) to decide accepted/rejected. 2b just defines the seam + the loop logic.

---

## 1. Structure Summary

### Files
- [ ] `src/services/coordinator-daemon.ts` — NEW: `CoordinatorDeps` interface, `runTick`, `handleWorkerComplete`, consts. (CREATE)
- [ ] `src/services/__tests__/coordinator-daemon.test.ts` — NEW tests with mock deps. (CREATE)

### Type Definitions / API
```ts
export const COORDINATOR_ID = 'coordinator';
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

export interface CoordinatorDeps {
  listReadyTodos: (project: string) => Todo[];
  claimTodo: (project: string, id: string, claimedBy: string, leaseMs: number) => Promise<Todo | null>;
  releaseExpiredClaims: (project: string, now?: string) => Promise<string[]>;
  completeTodo: (project: string, id: string, acceptance?: 'pending'|'accepted'|'rejected') => Promise<{ completed: Todo; promoted: string[] }>;
  launchWorker: (project: string, todo: Todo) => Promise<boolean>; // real impl (2c) spawns via launchAndBind
}
export interface TickResult { released: string[]; claimed: string[]; spawned: string[]; }

export function runTick(deps, project, now?, leaseMs?): Promise<TickResult>;
export function handleWorkerComplete(deps, project, todoId, acceptance): Promise<{ promoted: string[] }>;
```

### Component Interactions
The real runtime (2c) constructs `CoordinatorDeps` from the actual todo-store functions + a `launchWorker` that calls `launchAndBind`, and invokes `runTick` on a tick / event-wake. Here we build + test the pure orchestration so the integration adapter is trivial. `planCoordinatorTick` (2a) remains the read-only dry-run planner (for UI/System Map); the daemon uses the mutating store fns directly + the lease-release primitive.

---

## 2. Function Blueprints

### `runTick(deps, project, now = nowISO, leaseMs = DEFAULT_LEASE_MS): Promise<TickResult>`
**Pseudocode:**
1. `released = await deps.releaseExpiredClaims(project, now)` (atomic lease reclaim → ready).
2. `ready = deps.listReadyTodos(project)`.
3. for each ready todo `t`: `c = await deps.claimTodo(project, t.id, COORDINATOR_ID, leaseMs)`; if `c` is null → skip (lost race / already claimed); else push to `claimed`, then `ok = await deps.launchWorker(project, c)`; if `ok` push to `spawned`.
4. return `{ released, claimed, spawned }`.
**Error handling:** a `launchWorker` returning false (or a claim that was made but spawn failed) → todo stays `in_progress` with a lease; it will be reclaimed by a future `releaseExpiredClaims` and retried (Phase 1/2a behavior) — do NOT manually revert here (keep the seam simple). If `launchWorker` throws, let it propagate per-todo? — wrap each todo's claim+launch in try/catch so one bad todo doesn't abort the whole tick; on throw, record nothing extra (lease handles recovery).
**Edge cases:** no ready todos → only releases; claim race (two ticks) → claimTodo CAS returns null for the loser; empty project → {released:[],claimed:[],spawned:[]}.
**Test strategy (mock deps):** ready todos get claimed + launchWorker called → spawned; claimTodo returning null → not spawned; launchWorker false → claimed but not spawned; releaseExpiredClaims result surfaced in released; launchWorker throw on one todo → tick still completes for others.

### `handleWorkerComplete(deps, project, todoId, acceptance): Promise<{promoted}>`
**Pseudocode:** `const { promoted } = await deps.completeTodo(project, todoId, acceptance); return { promoted };`
**Note:** thin seam — the CALLER (2c: the worker via MCP, after its mechanical acceptance gate) decides `accepted`/`rejected`. This just routes to completeTodo (which marks done + unblocks dependents).
**Test:** completeTodo called with the given acceptance; promoted forwarded.

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: coordinator-daemon
    files: [src/services/coordinator-daemon.ts]
    tests: [src/services/__tests__/coordinator-daemon.test.ts]
    description: "NEW coordinator-daemon.ts: CoordinatorDeps interface (listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, launchWorker), COORDINATOR_ID + DEFAULT_LEASE_MS consts, runTick (release expired → claim each ready → launchWorker; per-todo try/catch; lease handles spawn-failure recovery), handleWorkerComplete (routes to completeTodo). All I/O injected (DI) — no direct todo-store import beyond the Todo type. bun:test with mock deps: claim+spawn, claim-null skip, launch-false, launch-throw isolation, release surfaced, handleWorkerComplete forwards acceptance+promoted."
    parallel: true
    depends-on: []
```

### Execution Waves
**Wave 1:** coordinator-daemon

### Summary
- Total tasks: 1
- Total waves: 1
- Max parallelism: 1
