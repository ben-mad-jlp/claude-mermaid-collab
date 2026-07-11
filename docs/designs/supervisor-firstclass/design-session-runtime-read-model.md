# Unified session-runtime read model (review C3)

"Who is alive and what are they doing" is scattered across 3 SQLite stores **plus in-memory Maps**, and every consumer re-stitches it. Introduce ONE read model so liveness logic stops being cross-store glue.

## The fragmentation (measured)

| Data | Where | Durable? |
|---|---|---|
| `status` (active/waiting/permission), `contextPercent`, `contextUpdatedAt`, `checkpointReadyAt` | `session-status.db` (per-project) | ✅ |
| claim = **what a worker is doing**: `claimedBy`, `claimToken`, `claimedAt`, `claimLeaseMs`, `retryCount` | `todos.db` (per-project) | ✅ |
| supervisor **identity** + heartbeat (`updatedAt`, `serverId`) | `supervisor.db` (global) | ✅ |
| slot/tmux busy state; `idleTracker` (sig / since / escalated) | **in-memory Maps** in `worker-pool.ts` / `coordinator-live.ts` | ❌ lost on restart |

Consumers that re-join these by hand: `ui/lib/liveness.deriveLiveness` (status + claim), `useFleetGraph` (subs + todos), `WorkerRoster`, the supervisor reconcile pass, and the self-watchdog (status + identity). Each re-implements the join → drift risk + the self-watchdog awkwardness we hit.

## Two problems, not one

1. **No single read model** — the join is duplicated across consumers.
2. **Part of the truth is in-memory** — slot/idle state evaporates on a server restart (which happened this session, twice). A read model that joins durable stores still can't report idle/slot state after a restart.

## Design

### Part 1 — one read model (the core of C3)
A single module `session-runtime.ts` exposing:
```ts
interface SessionRuntime {
  project; session;
  role: 'worker' | 'supervisor' | 'planner' | 'vibe' | 'unknown';   // from identity + naming
  isSupervisor: boolean;                                            // identity match (helps the self/epoch logic)
  status; contextPercent; contextUpdatedAt; checkpointReadyAt;      // session-status
  claimedTodoId; claimedAt; retryCount;                             // todos (what it's doing)
  slotTmux; idleSince; escalated;                                   // runtime (see Part 2)
  liveness: 'active' | 'waiting' | 'permission' | 'stale' | 'dead'; // DERIVED, once, here
}
getSessionRuntime(project, session): SessionRuntime
listSessionRuntimes(project): SessionRuntime[]
```
The stores stay **systems-of-record** (no storage merge — `todos.db` legitimately owns claims). This is a **read/join layer + a single `deriveLiveness`**. Every consumer (self-watchdog, reconcile, the FleetGraph API feed, WorkerRoster, ui `deriveLiveness`) reads from it instead of re-joining. The ui `lib/liveness` becomes a thin client of the same shape the server computes.

Bonus: `role`/`isSupervisor` here gives the self-watchdog (`183d784`) and the epoch fence (`2dd13c65`) a clean source instead of ad-hoc identity lookups.

### Part 2 — persist the in-memory runtime bits (so the model is restart-stable)
Move slot/tmux busy + idle (sig/since/escalated) out of in-memory Maps into a durable `session_runtime` table in `session-status.db` (it already owns per-session runtime). Then `listSessionRuntimes` is correct after a restart, and the coordinator re-derives rather than starting blind. Aligns with deterministic-daemon-first (durable runtime state, re-derivable). *Can ship as a second increment.*

## Why read-model, not storage-merge

Merging the stores into one table is over-reach: claims belong to the work-graph, context/status to session-status, identity to supervisor. They have distinct owners and lifecycles. The fragmentation pain is in the **read path**, so fix the read path.

## Releasable todo — staged

**Increment 1 (this todo):** build `session-runtime.ts` (join the 3 stores + one `deriveLiveness`), and migrate ≥2 consumers (the supervisor reconcile/self-watchdog path + the FleetGraph API feed) to it. No storage change.
- Acceptance: `getSessionRuntime`/`listSessionRuntimes` return the unified shape joining session-status + todos + supervisor identity; `deriveLiveness` exists once in this module with unit tests over fixture rows; the migrated consumers produce the same output as before (no behavior change).

**Increment 2 (follow-up):** persist slot/idle runtime to a `session_runtime` table so the model survives restarts; coordinator/worker-pool write to it; in-memory Maps become a cache, not the source.
