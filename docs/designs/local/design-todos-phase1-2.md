# Design: Todos Phase 1 (Managing Session) + Phase 2 (Asana Sync)

Builds on [[design-todos-upgrade]] (Phase 0 shipped: per-project bun:sqlite store with `ownerSession`/`assigneeSession`/status enum, on branch `feat/todos-upgrade-phase0`). Researched via codebase agent + Grok — both strongly aligned.

---

# Phase 1 — Managing Session (cross-session assignment)

## Decided: a thin todos-assignment layer — do NOT reuse the agent/task-graph machinery
The tool already has **three** distinct systems (agent found): (A) **task graph** — per-session JSON parsed from blueprint YAML, a DAG for executing one blueprint (`src/mcp/workflow/task-sync.ts`, regenerated wholesale on `sync_task_graph`); (B) **AgentDispatcher** — spawns real Claude child processes in git worktrees, driven by the UI over `agent:${sessionId}` channels (`src/agent/dispatcher.ts`, `session-registry.ts`); (C) **vibe-go** — in-process Claude `Agent` subagents reading the task graph (not registered sessions).

**Both agent and Grok: keep Phase 1 separate.** Reasons:
- The todo store **already models** cross-session assignment (`ownerSession`/`assigneeSession`, `listTodos` owner-or-assignee filter, `assignTodo` — `todo-store.ts:22,191,258`). The structurally hard part is done.
- Task graph is the wrong granularity/scope (per-session, blueprint-derived, clobbered on re-sync; no assignee/priority/dueDate). Forcing assignment through it fights its lifecycle.
- Phase 1 is overwhelmingly a **notification + live-visibility** problem, not a new data model.
- **Integration seam (keep, don't merge):** `Todo.link {blueprintId, taskId}` + `complete_linked_todos` already bridges a todo to a task-graph task. That's where the layers meet.

## Decided: no "managing session" role — any session assigns to any sibling
(Grok.) A session is a "manager" simply by owning todos it assigned out. `ownerSession` immutable (audit); `assigneeSession` mutable. Avoids ceremony, matches local-first reality, supports overlapping managers.

{{diagram:todos-managing-session-flow}}

## THE highest-value change — the live cross-session update gap
Grounded finding (agent): the per-project store + queries already let a manager see all owned todos and a worker query `assigneeSession=self`. **But live updates don't propagate cross-session:**
- The broadcast is `{ type: 'session_todos_updated', project, session }` carrying only the **acting/owner** session (`src/mcp/setup.ts:3731`).
- `ui/src/App.tsx:882-884` refetches **only if `session === currentSession.name`**. So when a manager assigns a todo to worker X, X's open UI receives the broadcast but **ignores it** (the `session` is the manager's) → X's list goes stale until manual refresh.

**Fix (the core of Phase 1):**
1. Enrich the broadcast payload with `ownerSession` + `assigneeSession` (everywhere `session_todos_updated` is emitted — `setup.ts` + `api.ts` todo routes).
2. Broaden the App.tsx guard: refetch when `project` matches AND (`session === me` OR `assigneeSession === me` OR `ownerSession === me`).
3. WS broadcast remains global (no per-session routing exists — `handler.ts:185` broadcasts to all, clients self-filter; that's fine).

## Notifications (in-app, v1)
- **Browser tab:** on an incoming `session_todos_updated` where `assigneeSession === me` and the todo is newly assigned, surface a toast/badge (reuse `broadcastNotification`/`notification` event, `handler.ts:310`, filtered client-side). On reconnect, the worker queries `assigneeSession=self, status!=done` and surfaces anything new (covers offline assignment).
- **Worker's Claude:** there is **no push-into-Claude primitive** for arbitrary sessions (only `agent_send` to dispatcher-spawned children — `dispatcher.ts:150`). v1: the worker's Claude discovers assignments on its next `list_session_todos` call. (A future "notify session's Claude" primitive is out of scope.)

## Session enumeration (assignee picker)
`list_sessions` exists (`setup.ts:968` → `/api/sessions` → `sessionRegistry.list()`, global `~/.mermaid-collab/sessions.json`). A session filters by `project === self.project`. Phase-1 nicety: add a `project` filter param to `list_sessions`. The assignee picker = sibling sessions in the project.

## Views (Grok)
- **Manager dashboard:** group by `assigneeSession` → status; bulk assign/status; quick filters.
- **Worker "Assigned to me":** flat + grouped-by-status, prominent due/priority/deps, one-click transitions (the Phase-0 filter already seeds this).
- **Cross-session board:** status columns, cards tagged by assignee. (Kanban — heavier; can follow.)

## Phase 1 scope ladder
1. **Live-update fix** (payload + App.tsx guard) — unblocks everything; smallest change.
2. Assignee picker (list_sessions project filter) + assign action in the todo UI.
3. "Assigned to me" toast/badge on new assignment.
4. Manager dashboard view (group-by-assignee).
5. (Later) cross-session Kanban board; a notify-session's-Claude primitive.

---

# Phase 2 — Asana Sync (optional cloud mirror; local wins)

Mechanics were drafted in [[design-todos-upgrade]] (PAT auth, Events-API polling not webhooks, outbox, local-wins LWW, session→Asana section + custom fields). This phase fixes placement + the engine.

## Decided: a server-side background loop, mirroring `BindingSweeper`
(Both.) Local-first ≠ "sync only when a client is online" — the Events-API poll must run continuously. The codebase's canonical pattern is `BindingSweeper` (`src/services/binding-sweeper.ts`): a class with `sweepOnce()`/`start()` (`setInterval(...).unref()`) `/stop()`, instantiated + started in `src/server.ts:95-96`, stopped in the shutdown handlers (`server.ts:400,409`). `startPRStatusPoller` is a second precedent.

**Plan:** `src/services/asana-sync.ts` exporting `AsanaSyncEngine { syncOnce(); start(); stop() }`; instantiate + start in `server.ts` (only when a token is configured), stop in shutdown. Interval ~30–60s for active projects (idle longer). Clients can request a force-sync.

## Token + sync state (where it lives)
- **No secret store exists today**; the only precedent is `process.env.XAI_API_KEY` read inline (`setup.ts:3578`). `.collab/` root files are **git-committed** (e.g. `todos.db`), so secrets must NOT go there.
- **Token:** `process.env.ASANA_TOKEN` (matches the XAI precedent), or a **gitignored** `.collab/asana.local.json` / `.env.local` (already gitignored). Never a committed `.collab/` file.
- **Sync state:** `Todo.asanaGid` already exists (`todo-store.ts:36`) as the per-row link; `updatedAt` is the change cursor. Project-level state (workspace/project GID map, last sync cursor, section→session map) → a sibling **`<project>/.collab/asana-sync.json`** or a small table in `todos.db`.

## Sync engine design
- **Outbox** (per-project table `(seq, todoId, op, payload, createdAt, attempts)`): every local todo write enqueues; the engine drains **in seq order**, marks done only on Asana success, retries with exponential backoff + dead-letter after N attempts.
- **Push:** create/update Asana tasks (`POST/PUT /tasks`); section move = assignment; custom fields carry owner/assignee/status (Asana tasks are binary-complete + sessions aren't users); store the returned `gid` on the todo.
- **Pull:** Events-API `GET /events?sync=token`; apply remote changes **local-wins LWW** by `updatedAt` (surface remote-only changes as "Asana override available", don't auto-apply).
- **>4h token-expiry reconciliation:** on expired token, full pass — pull all tasks in mapped sections, match on `asanaGid`, local-wins on controlled fields, create missing local todos from Asana + push missing local todos, then acquire a fresh sync token.
- **Mapping:** Asana project = the effort; **session → section** (auto-provision one section per session, name = session); status enum + owner/assignee → single-select **custom fields**.

## Setup UX (minimal)
Project Settings → Asana → "Connect" → paste PAT → pick Workspace → pick Asana Project → auto-provision a section per session + map status to a custom enum field. Store mapping (+ token ref) in project config. One-click "Disconnect".

## Do NOT build in v1 (Grok)
Comment/attachment/subtask sync; editing todos *from* Asana (mirror-only); any conflict UI beyond a log; delete propagation; custom-field mapping UI; webhooks (polling suffices); bidirectional status beyond our enum.

## Risks
- Rate limits (150/min free) across many sessions/projects → batch + honor `429 Retry-After`.
- Custom fields are paid-tier; degrade gracefully (status via section-only if no custom fields).
- Outbox durability on crash — persist before ack; idempotent replay keyed by `asanaGid`.
- Token in env vs file — document; never commit.

---

## Build order (across both phases)
1. **P1.1 live-update fix** (broadcast payload + App.tsx guard) — tiny, high value.
2. **P1.2** assignee picker (list_sessions project filter) + assign UI + "assigned to me" toast.
3. **P1.3** manager dashboard (group-by-assignee).
4. **P2.1** `AsanaSyncEngine` skeleton (BindingSweeper-style) + token config + outbox table.
5. **P2.2** push (local→Asana, sections + custom fields) — one-way first.
6. **P2.3** pull (Events API) + LWW + full-reconciliation fallback.
7. **P2.4** setup UX.
Each is independently shippable; P1.1 first.
