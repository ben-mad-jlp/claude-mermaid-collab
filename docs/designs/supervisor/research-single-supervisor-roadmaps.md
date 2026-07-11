# Single Global Supervisor + Per-Project Roadmaps — Gap Analysis & Feature Survey

Survey for the supervisor design pivot: from per-session membership (v1) to a single global supervisor that references per-project roadmaps, plans collaboratively with the user, and orchestrates supervised sessions in the background.

---

## 1. Session creation mechanics

There are TWO distinct "session" concepts in this codebase, and they are decoupled:

### (a) Collab session record (lightweight, no Claude attached)
- `src/services/session-registry.ts` — JSON registry at `~/.mermaid-collab/sessions.json` (a list of `{project, session, lastAccess}`). `register(project, session)` is idempotent, validates the name (`/^[a-zA-Z0-9-]+$/`), and creates the on-disk session scaffold under `<project>/.collab/sessions/<session>/` (diagrams, documents, designs, snippets, etc.) plus `collab-state.json` (session-registry.ts:232-290).
- Lazy creation: `create_document` and friends in `src/mcp/setup.ts` call `sessionRegistry.register(project, session)` (setup.ts:3413). So **a collab session is created simply by writing an artifact to it** — no Claude process required.
- CONCLUSION: Creating a *collab session record* is trivial and requires NO live Claude CLI. The supervisor can do this today via `register_project`/`create_document`/MCP, or by calling `sessionRegistry.register`.

### (b) A live Claude working in that session — two existing mechanisms:

**Mechanism 1: External tmux + bindings (what supervisor v1 assumes).**
- A `claude` CLI runs in a tmux window; it self-registers via `register_claude_session` and writes binding files `/tmp/.mermaid-collab-binding-<claudeSessionId>.json` and `/tmp/.claude-session-id-*`.
- `src/routes/ide-routes.ts` reads those bindings (`/api/ide/focus-terminal`, ide-routes.ts:24-50) and drives the session via `tmux send-keys` (`/api/ide/tmux-send-keys`, ide-routes.ts:94-121). `/api/ide/create-terminal` (ide-routes.ts:56-92) does `tmux new-session -d -s <name>` but **does NOT launch claude** inside it — it just opens an empty tmux session and broadcasts a WS event. So this path cannot, by itself, "start a Claude working."
- Binding/attaching is therefore driven by the human launching `claude` in a terminal.

**Mechanism 2: In-server agent model (the real "spawn claude" capability).**
- `src/agent/` is a full headless-agent subsystem. `AgentSessionRegistry.getOrCreate(sessionId, cwd)` (session-registry.ts:146) spawns a `claude` CLI child via `ChildManager` (child-manager.ts:130-156) in `--print --input-format stream-json --output-format stream-json` headless mode, with permission-mode/runtime-mode flags, worktrees, permission socket, event log, checkpoints, etc.
- Driven over WebSocket via `AgentDispatcher`: `agent_start` (dispatcher.ts:118 → `getOrCreate`) spawns; `agent_send` (contracts.ts:417) feeds a user message; `agent_cancel/stop/clear/delete`, model/effort/runtime control, `commit_push_pr`, etc. all exist (contracts.ts:415-438).
- The `sessionId` is a client-generated UUID (agentStore.ts:758); the claudeSessionId is derived `uuidv5(sessionId, NAMESPACE_COLLAB_AGENT)` (session-registry.ts:143). No external terminal needed — the server owns the process lifecycle and can respawn.
- Listed/managed via `src/routes/agent-sessions.ts` (REST list/replay/rename) but **creation/sends happen over WS**, not REST.

**What exists vs missing for "supervisor creates a session for a type of work":**
- EXISTS: create the collab record (register); spawn a fully server-managed Claude (agent model); nudge an externally-launched tmux Claude (v1 path).
- MISSING: a single MCP/REST entrypoint a supervisor *skill* can call to "create collab session X AND launch a Claude in it with an initial prompt." Today that requires WS access to the agent dispatcher (the UI's job, not a skill's). There is no MCP tool wrapping `agent_start`/`agent_send`. This is the central build decision (see Architecture).

---

## 2. Todo assignment (cross-session)

- Store: `src/services/todo-store.ts` — **per-PROJECT** SQLite at `<project>/.collab/todos.db`. Each todo has `ownerSession` + `assigneeSession` (nullable), `status` (backlog/todo/in_progress/blocked/done), `priority 0-4`, `order` (ord), `parentId`, `dependsOn[]`, and `link {blueprintId, taskId}` (todo-store.ts:19-58, 93-115).
- `createTodo` accepts `assigneeSession` directly; `assignTodo`/`assign` set/clear it (todo-store.ts:204-264). So **cross-session creation + assignment is fully supported at the store level today** — the project DB is shared, so one session can author a todo assigned to another with a plain insert.
- MCP tools present: `list_session_todos` (filter by `assigneeSession`, `status`), `add_session_todo` (accepts `assigneeSession`, `description`, `status`, `priority`, `dueDate`, `link`), `assign_session_todo` (set/null), plus update/reorder/toggle/clear (setup.ts:1840-1881, 3242-3350). Each write broadcasts `session_todos_updated` over WS.
- CAVEAT: `listTodos` with `filter.session` returns only **owned** todos (assigned-to-me are deliberately excluded to reduce sidebar noise — todo-store.ts:187-194). A supervisor must query with the explicit `assigneeSession` filter to see what a target session has been given. The v1 SKILL already does this (SKILL.md:59-61).
- VERDICT: Todo layer is ready for the pivot. A supervisor creating + assigning work to a (newly created) session works today. Link-to-blueprint exists but ties to per-session blueprints (see §3).

---

## 3. Roadmap concept — closest existing primitive

There is **no "roadmap" / "milestone" artifact today.** Closest primitives:

- **Blueprints + task graphs (per SESSION).** `src/mcp/workflow/task-sync.ts`: blueprints are markdown documents in `<project>/.collab/sessions/<session>/documents/` containing a ```yaml task block (id/files/tests/description/depends-on). `syncTasksFromTaskGraph` (task-sync.ts:382-455) scans active (non-deprecated, per MetadataManager) blueprints, parses tasks, topo-sorts into waves (`buildBatches`), writes a consolidated `task-graph.md`, and persists `batches/pendingTasks/completedTasks` into **per-session `collab-state.json`**. Exposed as `sync_task_graph` / `get_task_graph`; consumed by `/vibe-blueprint` (generate) and `/vibe-go` (launch agent waves).
- **The prioritized todo queue (per PROJECT)** — see §2. This is the only per-project ordered work list today.

**Mismatch to flag:** roadmaps must be PER PROJECT, but blueprints/task-graphs/collab-state are PER SESSION. The todo store is already per-project but is too low-altitude (individual todos, not "major work items").

**Recommendation:** a roadmap should be a NEW per-project artifact (option a), NOT a reuse of per-session blueprints and NOT just the todo queue. A roadmap = an ordered list of major work items (epics) for a project. Each roadmap item, when blessed, can (i) spawn/select a collab session, (ii) optionally seed a per-session blueprint/task-graph for the detailed plan, and (iii) generate assigned todos in the per-project todo store linked back to the roadmap item. This bridges per-project planning to the existing per-session execution machinery (vibe-blueprint/vibe-go) and per-project todos.

---

## 3b. Per-project vs per-session storage

Per-PROJECT state today (all under `<project>/.collab/`):
- `todos.db` (todo-store.ts)
- `session-status.db` (session-status-store.ts)
- `supervisor.db` (supervisor-store.ts — but keyed by supervisor session, see §4)

Per-SESSION state:
- `<project>/.collab/sessions/<session>/` — documents (incl. blueprints, task-graph.md), diagrams, designs, snippets, `collab-state.json` (batches/pending/completed, vibeinstructions).

Global state:
- `~/.mermaid-collab/sessions.json` (collab session registry)
- `~/.claude/settings.json` (+ project/local layers) via `src/agent/settings-store.ts`.

**Where a roadmap store fits:** a new per-project SQLite `<project>/.collab/roadmap.db` (mirroring the exact bun:sqlite-per-project pattern of todo-store/session-status-store: WAL, dbCache Map, `_closeProject` for tests). One roadmap per project, ordered items with status + links to spawned sessions and todos.

---

## 4. Single global supervisor identity

Today supervisor-store keys every membership row on `(supervisorProject, supervisorSession, targetProject, targetSession)` (supervisor-store.ts:20-39). This is a per-supervisor-session, per-target model — the OPPOSITE of "one global supervisor." The reverse lookup is even scoped to a single supervisor-project DB (supervisor-store.ts:103-120). This model does not fit the pivot.

Patterns available for singleton/global state:
- `~/.mermaid-collab/sessions.json` — a global JSON file the collab server already owns (session-registry.ts:16-17).
- `~/.claude/settings.json` layered store (settings-store.ts) — global config, but Claude-Code-owned, wrong place for app state.
- A new global SQLite under `~/.mermaid-collab/` (no precedent yet, but natural).

**Recommendation:** represent "the supervisor" as a global singleton, not a session tuple. Two parts:
1. **The supervisor's set of watched projects** — a global registry `~/.mermaid-collab/supervisor.json` (or `supervisor.db`): `{ watchedProjects: string[] }`. This replaces the per-(supervisor,target) membership entirely.
2. **The supervisor's "identity" as a running actor** — either a well-known reserved collab session name (e.g. session `supervisor`, which this very research doc lives in) OR a server-side background worker with no Claude identity at all (preferred for the background role — see §5). Foreground collaboration happens in whatever session the user is talking to the supervisor in; that session reads the per-project roadmaps.

Per-project roadmap data (the actual plan) lives per-project (§3b); the *global* part is only "which projects does the supervisor watch" + supervisor config (cadence, autonomy level).

---

## 5. Foreground + background concurrency

This is the hardest architectural tension. The user wants the supervisor to (a) collaborate live in a foreground session AND (b) keep nudging/driving other sessions in the background "at the same time."

What exists:
- **Self-scheduling wake loop (v1 supervisor).** SKILL.md:97-101 uses `ScheduleWakeup(delaySeconds, reason, prompt: "/supervisor")` to re-invoke itself. This is a *harness* capability (the running Claude schedules its own next turn). LIMITATION: a skill only acts when invoked/woken — between user turns the foreground Claude is idle. A wake-looped skill cannot truly run "while" collaborating; it interleaves turns. If the user is mid-conversation, the wake either interrupts or waits.
- **In-server agent model (`src/agent/`).** This runs Claude children as server-managed processes, fully decoupled from any foreground session. The server can poll status, send `agent_send` nudges, cancel, etc. independent of what the user's foreground Claude is doing. There are already background reactors here: `idle-recap.ts`, `checkpoint-reactor.ts`, `pr-status-poller.ts` — server-side loops that observe agent events and react.
- **session-status-store + WS replay scaffold** (handler.ts) already give the server a live view of every session's status without a Claude in the loop.

**Assessment / options:**
- Option A — *Foreground-only skill that nudges on each user turn.* Simple; reuses v1. But background work only happens when the user talks, and ScheduleWakeup ticks are coarse/interrupting. Weak fit for "while collaborating."
- Option B — *Server-side background watcher (recommended for the orchestration role).* A server-resident loop (like `pr-status-poller`/`idle-recap`) that reads each watched project's roadmap + todos + session-status and performs the mechanical nudges (`tmux-send-keys` for external sessions, or `agent_send` for server-managed agents) on a timer — entirely independent of any Claude session. The foreground supervisor session then becomes purely the *collaborative planning* surface; it edits roadmaps and grants approvals, and the server enforces them. This cleanly separates "foreground collaborator" (a normal Claude session reading roadmap.db) from "background orchestrator" (a server worker).
- Option C — *In-server agents as the supervised sessions.* If supervised work runs as agent-model children (not external tmux claudes), the server already owns their lifecycle and can drive them directly — no tmux, no bindings. Strongest fit for "briefly steps in to do something with a session it supervises."

**Recommendation:** B + C. Move the mechanical orchestration into a server-side background watcher (Option B) so it runs continuously regardless of the foreground session. Prefer the in-server agent model (Option C) for sessions the supervisor itself spawns, so it can drive them via `agent_send` rather than fragile tmux injection (keep tmux-send-keys as the fallback for human-launched sessions). The foreground supervisor (a Claude session) is then just the planning/approval UI over roadmap.db; it does not need to "multitask" because the server does the continuous part.

---

## 6. Approval gate for session creation

Existing approval/escalation primitives:
- `request_user_input` (MCP, setup.ts:1603, 2160) — routes through the agent `UserInputBridge` + event log + WS broadcast; structured prompt → user response. Designed exactly for agent-initiated questions.
- `render_ui` / `get_ui_response` (setup.ts:1588-1615, 2932-2962) — render a custom UI panel and poll for a response (blocking or non-blocking). The `/ui-question` skill wraps this.
- Pair-mode diagram-approval pattern (`skills/pair/SKILL.md`) — for any behavioral change, build a before/after diagram and **wait for human approval before writing code**; after approval it runs an agent chain. This is the established "propose → block on human → then execute" pattern in this codebase.

**Recommendation:** model "create session X for work Y?" on the pair-mode gate. The supervisor proposes a roadmap item → session plan (which session, what initial todos/blueprint) and blocks on approval via `request_user_input` (for a simple yes/edit/no) or `render_ui` (for a richer "review the proposed session + todos" panel). Only on approval does it (a) register the collab session, (b) optionally spawn the agent / seed the blueprint, and (c) write the assigned todos. The MEMORY note (no `render_ui` for plain questions; use numbered text options) means: default to plain-text numbered approval, escalate to `render_ui` only for genuinely structured review.

---

## 7. v1 artifacts — KEEP / REPURPOSE / REPLACE / DROP

| v1 artifact | Verdict | Rationale |
|---|---|---|
| `session-status-store.ts` (per-project status db) | **KEEP** | Per-project, exactly the granularity the watcher needs. Foundation for background polling. |
| `/api/ide/tmux-send-keys` (ide-routes.ts) | **KEEP** | Still the mechanism to drive human-launched (external) sessions. Becomes the fallback path; agent_send is preferred for server-spawned sessions. |
| `/api/session-notify` persist + `GET /api/session-status` (api.ts) | **KEEP** | Status ingestion/readout; reused by the background watcher. |
| `websocket/handler.ts` status replay scaffold | **REPURPOSE** | Currently inert (needs project on subscribe). Wire it to push live roadmap/status to the UI. |
| `supervisor-store.ts` (per-(sup,target) membership) | **REPLACE** | The 4-tuple membership model contradicts the single-global-supervisor + per-project-roadmap model. Replace with (1) global `watchedProjects` registry and (2) per-project `roadmap.db`. |
| `supervisor-routes.ts` (`/api/supervisor/targets`) | **REPLACE** | Re-skin to `/api/supervisor/projects` (watched set) + `/api/supervisor/roadmap` (CRUD roadmap items, spawn/assign actions). |
| `ui/.../SupervisorPanel.tsx` + `supervisorStore.ts` | **REWORK** | Re-target from "list assigned targets" to "list watched projects → each project's roadmap items + their spawned sessions + status." |
| `skills/supervisor/SKILL.md` | **REWORK** | Drop the per-target assignment model. New skill = foreground planning/approval over roadmaps; the continuous nudging moves to a server-side watcher. Keep the state-machine table and nudge/escalate semantics (good), keep "never answer permissions," reconsider ScheduleWakeup once the server watcher exists. |

---

## What we have (summary table)

| Capability | Where | Status |
|---|---|---|
| Create collab session record (no Claude) | session-registry.ts:232; lazy via create_document | EXISTS |
| Spawn a server-managed Claude | agent/session-registry.ts:146, child-manager.ts:130 | EXISTS (WS only) |
| Drive external Claude (tmux) | ide-routes.ts:94 (tmux-send-keys) | EXISTS |
| Per-project todos w/ owner+assignee, cross-session assign | todo-store.ts; MCP add/assign/list | EXISTS |
| Per-session blueprint → task-graph → agent waves | task-sync.ts; vibe-blueprint/vibe-go | EXISTS (per-session) |
| Per-project status store + polling endpoints | session-status-store.ts; api.ts | EXISTS |
| Approval prompts | request_user_input, render_ui/get_ui_response, pair gate | EXISTS |
| Self-scheduling wake loop | ScheduleWakeup (harness) | EXISTS (foreground-only) |
| Server-side background reactors | idle-recap, checkpoint-reactor, pr-status-poller | EXISTS (pattern) |

## What's missing (build list)

1. **Per-project roadmap store + API + MCP tools** — `<project>/.collab/roadmap.db`: ordered major work items, status, links to spawned sessions and todos. CRUD + reorder. (New, mirrors todo-store pattern.)
2. **Global supervisor registry** — `~/.mermaid-collab/supervisor.json|db`: watched projects + supervisor config (cadence/autonomy). Replaces the per-tuple membership.
3. **A skill/MCP-callable "create session for work" action** — wraps: register collab session → (optionally) spawn agent-model Claude + seed blueprint → create assigned todos → link to roadmap item. No single entrypoint exists today (agent spawn is WS-only).
4. **Server-side background supervisor watcher** — a continuous server loop (like pr-status-poller) over watched projects: read roadmap + status + todos, nudge idle sessions (agent_send preferred, tmux-send-keys fallback), surface escalations — independent of any Claude session.
5. **Approval-gated orchestration flow** — supervisor proposes session/todo plan, blocks on `request_user_input`/`render_ui`, executes only on blessing (pair-mode pattern).

## Recommended high-level architecture

- **The supervisor = (foreground planning session) + (server-side background watcher) + (global watched-projects registry) + (per-project roadmaps).** No per-target membership.
- **Foreground:** a normal Claude collab session the user talks to; reads/edits per-project `roadmap.db`, proposes work, gates session creation/assignment through `request_user_input`/`render_ui` (pair-mode style). On approval it registers sessions, seeds blueprints/todos, and records links on the roadmap item.
- **Background:** a server-resident watcher (independent of any Claude turn) that continuously reconciles each watched project's roadmap + todos + session-status, nudging idle-with-work sessions and surfacing escalations. This gives true "orchestrate while collaborating," because the continuous loop is server-side, not turn-bound.
- **Supervised execution:** prefer in-server agent-model children (driven by `agent_send`) for sessions the supervisor spawns — the server owns their lifecycle and can "briefly step in." Keep `tmux-send-keys` as the fallback for human-launched sessions. Reuse per-session blueprint/task-graph + vibe-go for detailed execution under a roadmap item.
- **Data:** global `~/.mermaid-collab/supervisor.*` (watched projects + config); per-project `<project>/.collab/roadmap.db` (the plans); existing per-project `todos.db` + `session-status.db`; per-session blueprints/collab-state for detailed execution.
