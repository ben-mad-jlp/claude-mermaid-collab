# Research: Todo / User / Concurrency Model (current state)

Scope: map the CURRENT model to ground two new capabilities — (a) "user todos" (assigned to a HUMAN), and (b) multi-user concurrent planning with collision detection. Read-only research; no code changed.

---

## 1. TODO MODEL (work-graph schema)

Canonical schema: `src/services/todo-store.ts` (per-PROJECT `bun:sqlite` DB at `<project>/.collab/todos.db`). UI mirror: `ui/src/types/sessionTodo.ts`.

`interface Todo` — `src/services/todo-store.ts:19-52`:
- `id` (UUID), `title`, `description`, `priority`, `dueDate`, `order`, `createdAt/updatedAt/completedAt`, `asanaGid` — ordinary fields.
- `ownerSession` (`:21`) — the session that OWNS the todo (its tracking/home session).
- `assigneeSession` (`:22`, nullable) — the session the todo is assigned to. Defaults to `ownerSession` on create (`:295`).
- `status: TodoStatus` (`:12`) — ladder: `backlog | planned | todo | ready | in_progress | blocked | done | dropped`.
- `parentId` (`:29`) — epic/parent link (epics nest children; roll-up logic at `:574-589`).
- `dependsOn: string[]` (`:30`) — DAG dependency edges.
- `type` (`:40`, nullable) — agent-profile type (frontend/backend/api/ui/library/…); drives worker launch params. Set at sync time (`task-sync.ts:391-405`).
- `targetProject` (`:45`, nullable) — absolute path of the repo the todo is IMPLEMENTED in when that differs from the (tracking) project it LIVES in. The coordinator spawns the worker with `cwd=targetProject` and runs the gate there. This is the cross-project / cross-repo seam.
- `acceptanceStatus: 'pending'|'accepted'|'rejected'|null` (`:46`) — mechanical-gate verdict on a completed todo.
- `claimedBy / claimToken / claimedAt / claimLeaseMs / retryCount` (`:47-51`) — claim/lease bookkeeping (see §2). Invariant: claim fields non-null IFF `status==='in_progress'` (`:186-191`, `:334-341`).

### Status ladder meaning
Documented at `src/services/todo-store.ts:526-529`:
- `backlog` / `todo` — captured, not planned/approved.
- `planned` — proposed, NOT yet approved. Only the **Planner** promotes `planned → ready/blocked` (approval gate). The Coordinator never self-promotes from `planned`.
- `ready` — approved AND deps done → claimable by the Coordinator.
- `blocked` — approved but deps pending (or a rejected/exhausted todo parked for a human — `:419`, `:544-548`).
- `in_progress` — claimed by a worker (holds a lease).
- `done` — completed (and not rejected).
- `dropped` — abandoned.

`depSatisfied` (`:518-521`): a dep unblocks dependents only when `status==='done' AND acceptanceStatus !== 'rejected'` (PCS design #1, "done-AND-accepted"). Mirrored in `coordinator-core.ts:24-28`.

Note `ui/src/types/sessionTodo.ts:29` calls `type` `kind` and marks several work-graph fields optional for back-compat.

---

## 2. WHO EXECUTES A TODO (Coordinator claim → worker spawn)

The Coordinator is a **non-LLM, per-project daemon** (`src/services/coordinator-daemon.ts:3-6`). It is the ONLY executor path today, and every executor is an **agent**, never a human.

Tick loop — `coordinator-daemon.ts runTick` (`:60-102`):
1. `releaseExpiredClaims` + reap dead claims/pool slots.
2. `listReadyTodos(project)` → for each: `claimTodo(project, id, COORDINATOR_ID, leaseMs)` then `launchWorker(project, claimed)`.

`COORDINATOR_ID = 'coordinator'` (`:8`). **`claimedBy` is set to this constant** in `claimTodo` (`todo-store.ts:366-377`): `UPDATE … SET status='in_progress', claimedBy=?, claimToken=?, … WHERE id=? AND status='ready' AND claimToken IS NULL`. The `WHERE claimToken IS NULL` clause is the atomic single-claim guard (compare-and-set).

Live wiring `launchWorker` — `src/services/coordinator-live.ts:232+`: routes the claimed todo to a persistent role-typed **pool session** (a spawned tmux Claude worker), keyed on `todo.type` → pool type (`:241`). At pool capacity it `releaseClaim`s back to `ready` with no retry penalty (`:253-260`). Cross-project todos spawn the worker with `cwd=targetProject` (`:270-283`).

### Is there ANY path where a todo is meant for a HUMAN?
**No — not as a first-class "assign this todo to a person to do" concept.** Closest existing surfaces (all are "ask a human to DECIDE", not "a human owns/executes a work item"):
- **Retry-exhausted / rejected → `blocked` for a human.** `MAX_CLAIM_RETRIES` (`todo-store.ts:382`); exhausted claims park `blocked` and the coordinator **escalates** them (`coordinator-daemon.ts:79-81`, `escalateExhausted`). A rejected gate verdict also parks `blocked` + escalates (`:139-141`, `completeTodo` `:544-548`). These say "a human needs to look at this," but the todo itself is not re-typed as a human work item — it just sits `blocked` until a human clears it.
- **Escalations + `await_human_decision`** (`src/mcp/setup.ts:2024-2027, :2024 await_human_decision`; relay `src/services/decision-relay.ts`, polled via `src/routes/supervisor-routes.ts:226-253`). This is a DECISION channel (A/B option, note), not a todo assigned to a person. An escalation can carry `todoId` to auto-resolve when that todo completes (`supervisor-store.ts:49-51`).
- `assigneeSession` is always a **session name**, never a person. There is no "assign to user X" field or status.

**Gap:** to model a human-owned todo (annotate/review), you would need either a new `status` (e.g. `awaiting_human` / `user_todo`) or a new assignee namespace (assignee = a person, not a session) that the Coordinator's `listReadyTodos`/claim loop explicitly **skips** (it currently claims every `ready` todo whose deps are done — `coordinator-core.ts:19-29`). Today nothing tells the daemon "don't spawn an agent for this one; a person does it."

---

## 3. IDENTITY / USERS

**There is no user / person / account model anywhere.** No auth, no login, no accounts table. Searches for `user|account|identity|person|login` in `src/services` and `src/routes` return only: agent-profile types, chrome `--user-data-dir`, the `supervisor_identity` singleton (a SERVER identity, not a person), and an alias dictionary entry.

What exists that LOOKS like identity but isn't a person:
- **`approvedBy` (string)** on a decision record — `decision-record-store.ts:33, :155-159`. Set by `approveDecisionRecord(project, id, approvedBy)`. The value is whatever the caller passes to the `approve_decision_record` MCP tool (`src/mcp/setup.ts:2037, :4500-4502`) — a **free-text string**, required but unvalidated, with NO session→person mapping and no enum. It is an audit label, not a real account.
- **`authorSession` (string|null)** on a decision record — `decision-record-store.ts:32, :119`. A SESSION name, passed through from `create_decision_record` (`setup.ts:2035, :4486-4488`). Session, not person.
- **`decidedBy`** on an escalation decision — **hard-coded to the literal `'human'`** at the decide route (`src/routes/supervisor-routes.ts:245`: `recordEscalationDecision({ …, decidedBy: 'human' })`). So even the one place that records "a human answered" stores a constant string, not an identity.
- **`supervisor_identity`** (`supervisor-store.ts:117, :543-579`) and **`serverId`** columns throughout supervisor-store — these identify the SERVER / supervisor process (for multi-host peer routing), not a user. `PeerInfo { serverId, baseUrl, token }` (`:603-606`) is host federation.
- Sessions: `src/services/session-registry.ts` tracks Claude SESSIONS (ownerSession/assigneeSession everywhere) — the unit of identity in the whole system is the **session**, never a person.

**Gap:** there is no notion of "who is this human." Multi-user planning has no identity to attribute edits to, no per-user view, and the only human-attribution fields (`approvedBy`, `decidedBy='human'`) are unstructured strings.

---

## 4. CONCURRENCY / COLLISION

Two distinct mechanisms exist; neither is a true multi-writer collision detector for live concurrent editing.

### (a) Single-server, in-process write serialization
`todo-store.ts withLock` (`:205-212`) — a per-project promise chain serializing all writes (create/update/claim/complete) **within one server process**. `claimTodo`'s `WHERE … claimToken IS NULL` (`:374`) is an atomic CAS that prevents double-claim of a todo. `assertProjectLocal` (`:360-364`) enforces a **single-writer invariant** (PCS open-problem #7): claim/complete writes must run on the project's HOME server; cross-machine writes are rejected. The comment explicitly calls federation/failover "still vaporware" (`:358`). So today: ONE server owns a project's work-graph; there is **no epoch / version / optimistic-concurrency fence** on a todo row — concurrent edits from two clients hitting the same server are just last-write-wins through the serialized lock; `updatedAt` exists but is not used as a compare-and-swap guard.

There is no `epoch` or `fence` token anywhere in the codebase (grep found none in the todo/work-graph path).

### (b) Plan-graph reconciliation harness (the "reconcile" flow)
This is the explicit answer to "two planning threads edit the work-graph in parallel" (PCS open-problem #4). It is a MERGE harness, not a lock — it runs AFTER two divergent edits exist, to merge them.

- `src/services/planner-reconcile.ts` — pure/unit-testable orchestrator. `runReconcile(deps, {base, deltaA, deltaB, constraints})` (`:126-136`):
  - `areOrthogonal(deltaA, deltaB)` (`:57-65`) — true when the two deltas touch **disjoint node-id sets** AND neither references a node the other changed. Orthogonal → deterministic `unionById` merge, no LLM (`:127-131`).
  - Non-orthogonal (a real **collision**) → delegate to an injected `llmMerge` (in production a spawned tmux Claude session — `planner-reconcile-live.ts:8`), then deterministic post-checks: `findCycle`, `danglingRefs`, and constraint-preservation (`validateMerged` `:99-113` — a merge must not drop a todo an active constraint depends on).
- Live trigger path: `planner-reconcile-live.ts` registers a pending reconcile; the spawned `reconcile` skill session calls the `submit_reconcile_result(reconcileId, mergedGraph, newConstraints)` MCP tool (`setup.ts:2034, :4479`) to resolve it. There is also `supervisor_reconcile` (`setup.ts:2022, :3622`) but that is a DIFFERENT, unrelated thing — it reconciles SUPERVISED-SESSION status (open-todo counts / nudge-idle), not the plan graph.

**So collision "detection" today = `areOrthogonal` at merge time** (node-id overlap / cross-reference), and "resolution" = orthogonal-union or an LLM merge with deterministic validation. It is batch/after-the-fact, single-server, and has no concept of which USER made which delta (deltas are bare `PlanNode[]`, no author).

**Gap for concurrent multi-user planning:** no per-row version/epoch, no live presence/locking, no author on a delta, and the whole work-graph is pinned to one home server. Real multi-user concurrent planning would need (i) an author/identity on edits (§3 gap), (ii) an optimistic-concurrency fence (epoch/`updatedAt` CAS) or live lock on rows/epics, and (iii) wiring the existing reconcile harness to be fed by two ACTUAL user sessions' deltas (today the harness exists but is described as a spike/"is the llmMerge output usable" open question — `planner-reconcile.ts:11-15`).

---

## 5. PROGRAM / PROJECT MODEL

- **Project registration:** `src/services/project-registry.ts`. A project is just `{ path (abs, primary key), name (basename), lastAccess }` (`:6-10`), persisted to `~/.mermaid-collab/projects.json` (`:16-17`). `register(path)` validates absolute + exists on disk (`:66-74`). No owner, no team, no users. Each project owns its own `.collab/todos.db`, `.collab/decision-records.db`, etc.
- **What makes collab "multi-program" today:**
  1. **Agent-profile `type`** on a todo (`todo-store.ts:40`) — routes a todo to a role-typed worker pool (frontend/backend/api/ui/library/general). Inferred from task files via project manifest rules then global rules (`task-sync.ts:401-403`, `inferTypeFromManifest`/`inferProfileType`). This is the "different kinds of work" axis.
  2. **`targetProject`** on a todo (`todo-store.ts:41-45`) — the cross-REPO axis. A todo is TRACKED in project A but IMPLEMENTED in repo B. The Coordinator spawns the worker with `cwd=targetProject`, resolves the worker profile from the TARGET repo's manifest, and runs the acceptance gate against the target repo's change-set — while all claim/lease/store bookkeeping stays on the tracking project (`coordinator-live.ts:264-283`). The worker is told via an injected context note to use `project=<tracking>` for collab calls but edit code in its `cwd=<target>` (`:277-283`).
- **How CAD/bsync plugs in:** via `targetProject`. A planning/tracking session in the mermaid-collab project creates todos with `targetProject` = the CAD/bsync repo path; the Coordinator drives an agent worker whose cwd is that repo. There is no special "program registry" — cross-program work is entirely the `type` (which pool) + `targetProject` (which repo) pair on each todo, plus per-target manifest-driven profile/gate resolution. Recent commit `d7fc29e feat(todo-store): add targetProject field (cross-repo implementation target)` confirms this is the active seam.

---

## SUMMARY: gaps for the two new capabilities

**(a) User/human todos** — Today EVERY executable todo is claimed by the single `coordinator` daemon and run by an AGENT pool worker; `claimedBy` is always the constant `'coordinator'`. The only "human" touchpoints are DECISION escalations (`await_human_decision`, `decidedBy='human'` hard-coded) and todos parked `blocked` after retry-exhaustion/rejection for a human to clear — neither is "a todo a person is assigned to DO." There is no status or assignee namespace that means "human-owned," and nothing makes the Coordinator's claim loop skip such a todo (it claims every deps-satisfied `ready` todo). New work needed: a human-assignee concept + a Coordinator skip rule.

**(b) Identity** — There is NO user/person/account model at all. The unit of identity everywhere is the SESSION (`ownerSession`/`assigneeSession`) or the SERVER (`serverId`/`supervisor_identity`). Human attribution exists only as unstructured strings: `approvedBy` (free text from the approve tool), `authorSession` (a session), and a literal `'human'` for escalation decisions. No session→person mapping.

**(c) Concurrent-edit collision** — No true live-concurrency control. Within one server, writes are serialized by an in-process per-project promise lock and todo-claims use a `claimToken IS NULL` CAS; the work-graph is pinned to one HOME server (`assertProjectLocal`, federation "vaporware"). There is NO epoch/version/fence on todo rows (last-write-wins via the lock). The dedicated answer to parallel plan edits is the `planner-reconcile` MERGE harness: `areOrthogonal` (node-id overlap) is the only collision detector, resolved by orthogonal-union or a spawned LLM merge + deterministic validation (cycles/dangling/constraint-preservation). It is after-the-fact, single-server, and carries NO author on a delta — so it cannot today attribute or arbitrate between two specific users.
