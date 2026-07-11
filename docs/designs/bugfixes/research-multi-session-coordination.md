# Multi-Session Coordination — Architecture Research

Goal: understand what the codebase already supports for coordinating multiple concurrent Claude Code sessions on the same project, to design "assign a todo/document to another session" and bake multi-session coordination into the vibe skills.

## 1. Session Registry & Identity

There are **two distinct registries**, do not conflate them:

### A. Collab session registry (`src/services/session-registry.ts`)
- `interface Session { project; session; lastAccess }` (line 6-10). Stored in `~/.mermaid-collab/sessions.json` (global, line 16-17), NOT per-project.
- `SessionRegistry.register(project, session, useRenderUI?)` (line 232) — idempotent, creates `.collab/sessions/<session>/{diagrams,documents,designs,spreadsheets,snippets,images,code-files}` and `collab-state.json` (line 271-286).
- `list(): Promise<Session[]>` (line 328) — enumerates ALL sessions across ALL projects; auto-cleans stale entries. **A session can already enumerate other sessions in the same project** by filtering `list()` on `project`.
- `resolvePath(project, session, type)` (line 421) — resolves the on-disk artifact folder for any (project, session). **Not bound to caller identity** — any session can compute another session's path today.
- Session names validated `^[a-zA-Z0-9-]+$` (line 241).
- This registry has **no concept of a Claude process / PID** — it's pure project+session+lastAccess.

### B. Claude-process binding (PID ↔ session)
- `register_claude_session` MCP tool (`src/mcp/setup.ts:1686`, handler `:3432`). Flow:
  1. Caller runs `echo $PPID`, passes `claudePid`.
  2. Reads `/tmp/.claude-session-id-<pid>` (written by the SessionStart hook) → `claudeSessionId` (UUID).
  3. `registerPidSession(pid, session)` in-memory (`cdp-session.ts:37`).
  4. Writes binding file `/tmp/.mermaid-collab-binding-<claudeSessionId>.json` = `{ claudeSessionId, project, session, claudePid, boundAt }` (setup.ts:3463-3470).
  5. POSTs `/api/claude-session/register` → server broadcasts `claude_session_registered` over WS (`api.ts:2357`).
- `resolveSessionId(claudePid)` (`cdp-session.ts:41`) maps a Claude PID → collab session name (in-memory map, then binding file, else `auto-<pid>`).
- **So identity exists at two layers**: collab-session string (durable, on disk) and Claude-process UUID/PID (ephemeral, `/tmp`). The binding files in `/tmp` are the only link between a Claude process and a collab session.

### C. Agent session registry (`src/agent/session-registry.ts`) — SEPARATE, internal agent runner
- `AgentSessionRegistry` manages **child Claude processes spawned BY the collab server** (the "agent" / vibe-go feature), not external interactive Claude Code sessions. Events stored in SQLite (`.collab/agent-sessions/agent-events.db`), per-session deterministic `claudeSessionId = uuidv5(sessionId, NAMESPACE)` (line 142-144). `listSessions()` (line 355) reads `agent_sessions` table.
- This is the closest thing to a true "session directory" with messaging (it has an event log + broadcast), but it only covers server-spawned agents, not peer interactive sessions.

## 2. Cross-Session Artifacts (storage layout)

Strictly per-session on disk:
```
.collab/sessions/<session>/
  collab-state.json          # batches, pendingTasks, completedTasks, useRenderUI
  metadata.json              # folders[], items{ id -> {folder,locked,deprecated,blueprint} }
  update-log.json
  session-todos.json         # { todos: SessionTodo[], nextId }
  diagrams/ documents/ designs/ spreadsheets/ snippets/ images/ code-files/ embeds/
```
- Todos: `getSessionTodosPath = .collab/sessions/<session>/session-todos.json` (`session-todos.ts:177`). All todo ops take explicit `(project, session)` params and lock per `project::session` (line 16). **There is no caller-identity check** — any caller passing `(project, sessionB)` already writes into B's todos. Same for documents (`create_document` takes `session`).
- **Cross-session move that exists today**: `archive_by_prefix` (`setup.ts:1743`/`:3617`) and the metadata `deprecated` flag — but these operate within a single session, archiving by name prefix. No copy/move BETWEEN sessions found.
- `resolvePath` + the per-(project,session) param convention mean **cross-session writes are already mechanically possible**; what's missing is intent/semantics (who owns it, who was assigned), not the plumbing.

## 3. Notifications / Messaging

- WS broadcast types (`src/websocket/handler.ts:55-56`): `claude_session_registered`, `claude_session_status` (status ∈ active|waiting|permission), plus `notification`, `status_changed`, `browser_tab_update`, `claude_context_update`.
- `broadcastNotification` / `broadcastStatus` (handler.ts:309, 334) — **fan out to ALL connected WS clients**, no per-session targeting. `statusManager` (`status-manager.ts`) is a **global singleton with a single status** — not per-session.
- `/api/session-notify` (`api.ts:2370`) lets a bound Claude session announce its own status (active/waiting/permission); trust-gated by the `/tmp` binding file matching project+session (api.ts:2389-2410). It **broadcasts to the UI**, it does NOT deliver to another Claude session.
- **Crucial gap**: there is no mechanism to wake/notify another Claude *process*. WS broadcasts reach browser UIs, not Claude CLI processes. The `/tmp/.mermaid-collab-binding-*.json` files give us the target session's `claudePid`, so a `process.kill(pid, 0)` liveness probe (as in `instance-discovery.ts:134`) is feasible, but there's no signal/inbox path into a peer Claude process. A peer session would only "see" an assignment by polling its own todos/inbox on disk.

## 4. Todos Model & Document Metadata

- `SessionTodo` (`session-todos.ts:33`): `{ id, text, completed, order, createdAt, updatedAt, link? }`. `SessionTodoLink = { blueprintId, taskId? }` (line 43).
- To support delegation, add optional fields: `assignedToSession?: string`, `assignedBySession?: string`, `assignedAt?: string`, and a status beyond boolean `completed` (e.g. `accepted|in_progress|done`). All todo writers already thread `(project, session)`, so adding fields is a localized change to the interface + schemas (the `addSessionTodoSchema`/`updateSessionTodoSchema` at line 76/95) + write functions.
- Document/artifact metadata: `ItemMetadata { folder, locked, deprecated?, blueprint? }` (`src/types.ts:164`). Has no owner/assignee field. Managed by `MetadataManager` per session dir (`metadata-manager.ts`). Adding `assignedToSession?` here is the parallel change for documents/diagrams.

## 5. Task Graph

- Tasks parsed from blueprint markdown YAML (`task-sync.ts:parseTaskGraph` line 29) → `TaskGraphTask { id, files[], tests?, description, parallel?, depends-on[] }`.
- `buildBatches` (line 99) topologically sorts into **waves** (`TaskBatch { id, tasks[], status }`). Stored in `collab-state.json` via `updateSessionState({ batches, pendingTasks, completedTasks })` (line 448).
- Task status: `src/mcp/workflow/task-status.ts` + `update_task_status` MCP tool track per-task pending/completed within ONE session's collab-state.
- **Partitioning across sessions is not modeled.** A task has `files[]` but no `session`/`owner`. To partition, each task (or each wave) would need an `assignedToSession` and the runner (vibe-go) would dispatch a wave's tasks to the target session's todos/inbox instead of spawning local sub-agents. The dependency graph is global; cross-session waves would need a shared task graph (currently each session has its own copy).

## 6. Existing Multi-Instance Work (`instance-discovery.ts`)

- Records **live SERVER instances**, not collab sessions: `Instance { version, sessionId, port, project, session, pid, startedAt, serverVersion }` (line 9). Stored at `~/.mermaid-collab/instances/<sessionId>.json` with a proper-lockfile lock (line 52). `sessionId = sha1(project\0session).slice(0,12)` (line 47).
- `readInstances()` (line 101) GCs dead owners via `process.kill(pid,0)` liveness probe. `findInstance(project, session?)` (line 184) locates a running server.
- **Distinction**: this answers "is there a mermaid-collab *server* already running for this project/session, and on what port?" (supports PORT=0 + VS Code auto-tunnel). It is about server processes, NOT about coordinating peer Claude *sessions*. However it is **directly reusable as a discovery primitive**: it already maps (project, session) → live pid + port, and demonstrates the lockfile + liveness pattern we'd want for a session directory.

## 7. Gaps & Primitives Needed

To support "assign a todo/document to another session" + broader coordination, grounded in the above:

1. **Session directory tool (read-only).** Wrap `sessionRegistry.list()` filtered by project into an MCP tool (`list_project_sessions`) so a session can enumerate addressable peers + their `lastAccess`. Optionally enrich with liveness from `instance-discovery.readInstances()` and `/tmp` bindings (claudePid alive?). *Mostly composition of existing pieces.*

2. **Assignee fields on the todo model.** Add `assignedToSession?`, `assignedBySession?`, `assignedAt?`, and a richer status to `SessionTodo` (`session-todos.ts:33`) + schemas + write fns. Same for `ItemMetadata` (`types.ts:164`) for documents/diagrams.

3. **Cross-session write API.** Mechanically already possible (all writers take `(project, session)`), but expose explicit, intention-revealing tools: `assign_todo_to_session(fromSession, toSession, text, link?)` and `assign_document_to_session(...)`. These would write into the TARGET session's `session-todos.json` / documents dir with provenance (`assignedBySession`). Add validation that the target session exists in the registry.

4. **An inbox / pull model.** Since we cannot push into a peer Claude process, add an `inbox` concept (could just be assigned-but-unaccepted todos filtered by `assignedToSession == me`). A `list_my_assignments(session)` tool lets a session poll for delegated work. This is the realistic delivery mechanism given the WS-to-UI-only constraint (§3).

5. **Notification fan-out to the UI (exists) + optional process wake.** Reuse `broadcastNotification`/`claude_session_status` to surface "session B was assigned work" in the UI. For waking the peer Claude process, the only available lever is its `claudePid` from the binding file; there is no signal channel today — document this as a hard limitation, or build a dedicated inbox-poll hook.

6. **Shared/partitionable task graph.** Currently each session owns its own `collab-state.json` batches. To partition waves across sessions, introduce `assignedToSession` on `TaskGraphTask`/`BatchTask` and let vibe-go (the AgentSessionRegistry orchestrator) either spawn local agents OR delegate a task into a peer session's inbox. Requires a shared task-graph source rather than per-session copies.

7. **Trust / ownership semantics.** Today cross-session writes are unguarded. If delegation becomes a first-class feature, decide whether a session may write into another's space directly, or only into an `inbox/` subtree the owner then accepts (mirrors the binding trust-gate in `/api/session-notify`, api.ts:2389).

### Reusable primitives that already exist
- `sessionRegistry.list()` / `resolvePath()` — directory + path resolution.
- Per-(project,session) param convention threaded through every todo/document/diagram tool — cross-session writes need no new plumbing, only new intent + fields.
- `instance-discovery` lockfile + `process.kill(pid,0)` liveness pattern — reuse for a live-session directory.
- `/tmp/.mermaid-collab-binding-<uuid>.json` — already maps a collab session to a live Claude pid (the only Claude-process handle we have).
- WS `claude_session_status` / `broadcastNotification` — UI-facing signaling.
