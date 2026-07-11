# Supervisor feature — existing mechanics to build on

Research of mechanisms a "supervisor" Claude Code session could use to monitor,
task, and drive other collab sessions. File:line references below.

## Key distinction: two kinds of "session"

1. **External Claude Code sessions** — real `claude` CLI processes the user runs
   in terminals, bound to a collab session via `register_claude_session`. Status
   is observed passively through hooks. **This is what the supervisor monitors.**
2. **In-server agent sessions** — sub-agents the collab server itself spawns and
   drives (`AgentSessionRegistry`, vibe-go waves). The server has *full* stdin/
   stdout control of these. Different lifecycle, but a richer control surface.

---

## 1. Session monitoring

### Binding files (source of truth for "which Claude PID == which collab session")
- `register_claude_session` tool: `src/mcp/setup.ts:1621` (def), `:2978` (handler).
  - Caller runs Bash `echo $PPID`, passes `claudePid`.
  - Reads `/tmp/.claude-session-id-<claudePid>` (written by SessionStart hook),
    writes `/tmp/.mermaid-collab-binding-<claudeSessionId>.json` containing
    `{ claudeSessionId, project, session, claudePid, boundAt }` (setup.ts:3009-3016).
  - Also registers in-memory via `registerPidSession` (`src/services/cdp-session.ts`).
  - POSTs `/api/claude-session/register` → broadcasts `claude_session_registered`
    and calls `watchSession(project, session)` (api.ts:2338-2373).
- SessionStart hook: `scripts/session-start-hook.sh` — walks process tree to find
  the `claude` PID, writes `/tmp/.claude-session-id-<PID>`, carries the binding
  forward across `/clear` and `/compact`, prunes stale files.
- Hook wiring: `.claude-plugin/plugin.json` (SessionStart, UserPromptSubmit,
  PreToolUse, PostToolUse, Stop, PermissionRequest, PermissionDenied).

### Status signal (active / waiting / permission)
- `active-hook.sh` (UserPromptSubmit/PreToolUse/PostToolUse): POSTs status
  `active` to `/api/session-notify`.
- `notification-hook.sh` (Stop): POSTs status `waiting`.
- `/api/session-notify` (api.ts:2375-2427): validates against binding file,
  broadcasts `claude_session_status { project, session, status, lastUpdate }`.
  Allowed statuses: `active | waiting | permission`.
- **Supervisor implication:** subscribe to WS and watch `claude_session_status`
  to know if a session is busy (`active`), idle/done (`waiting`), or blocked
  (`permission`). This is the primary "is it idle?" signal. There is no
  server-side persisted status store though — it is fire-and-forget broadcast,
  so a supervisor must keep its own last-seen map from the WS stream.

### Session state file (collab-state.json)
- `GET /api/session-state?project=&session=` (api.ts:393): reads
  `<project>/.collab/sessions/<session>/collab-state.json` →
  `{ state, displayName, batches, pendingTasks, completedTasks, ... }`.
- `session_state_updated` WS broadcast carries `completedTasks`/`pendingTasks`/
  `state`. Task-graph view: `GET /api/projects/:project/sessions/:session/task-graph`.

### Session todos (the assignment + tracking substrate)
- Store: `src/services/todo-store.ts` (SQLite). Each todo has `ownerSession`,
  `assigneeSession`, `status` (`backlog|todo|in_progress|blocked|done`),
  `priority`, `dueDate`, `parentId`, `link`. Indexed by owner/assignee/status.
- Tools (handlers `src/mcp/setup.ts:3242+`), all broadcast `session_todos_updated`:
  - `list_session_todos` (filter by `assigneeSession`, `status`, `includeCompleted`)
  - `add_session_todo` (accepts `assigneeSession`, `priority`, `status`, `dueDate`)
  - `assign_session_todo` (set/clear `assigneeSession`)
  - `update_session_todo`, `toggle_session_todo`, `reorder_session_todos`,
    `clear_completed_session_todos`, `complete_linked_todos`
- **Supervisor implication:** this is the ready-made task-assignment channel.
  The supervisor can create todos assigned to a target session and poll
  `list_session_todos(assigneeSession=X)`; the target session reads its own
  assigned todos. `status=in_progress`/`blocked` doubles as a self-reported
  "currently doing" signal. WS `session_todos_updated` gives push updates.

### "Currently Doing" / vibeinstructions
- `/vibe-checkpoint` skill updates a `.vibeinstructions` snippet with current
  work so it survives `/clear`. `/vibe-read` displays it. These are snippet
  artifacts (queryable via snippet tools), giving a human-readable "where is
  this session at" that the supervisor can read.

---

## 2. Knowing where a session is at (notifications / WS)

- WebSocket handler: `src/websocket/handler.ts`. Single broadcast bus with
  channel subscriptions (`subscribe { channel }`). All `WSMessage` variants are
  enumerated at handler.ts:18-91. Relevant to supervisor:
  - `claude_session_registered`, `claude_session_status`, `claude_context_update`
  - `session_created`, `session_deleted`, `session_todos_updated`,
    `session_state_updated`, `status_changed`
  - `agent_event` (full transcript stream for in-server agents — see §3)
- WS broadcast methods: `broadcast`, `broadcastToChannel`, `broadcastStatus`
  (handler.ts:337). Context %: `claude_context_update` via a `/api/...` POST of
  `{ claudePid, contextPercent }` resolved through the pid→session-id file
  (api.ts:2431-2455).
- **Supervisor polling/subscription options:**
  - (best) Open a WS to the collab server (`ws://localhost:<PORT>`, default 9002,
    `src/config.ts:25`), subscribe to the relevant channels, build a live model
    of every session's status. Reconstruct state from the event stream.
  - (fallback) Poll `GET /api/session-state`, `list_session_todos`, snippet
    `.vibeinstructions`, and `GET /api/status` (api.ts:662).

---

## 3. Sending commands / input INTO another session

This is the weakest existing capability for *external* Claude sessions, and the
strongest for *in-server* agents.

### (a) tmux + terminals
- `src/services/tmux-naming.ts` → `tmuxBaseName(project, session)` gives a stable
  tmux session name per collab session.
- IDE routes (`src/routes/ide-routes.ts`):
  - `POST /api/ide/create-terminal` (line 56): `tmux new-session -d -s <name>`,
    broadcasts `ide_open_terminal`.
  - `POST /api/ide/focus-terminal` (line 17): resolves binding, broadcasts
    `ide_focus_terminal { claudePid, claudeSessionId }`.
  - `GET /api/ide/tmux-sessions` (line 119): `tmux ls`.
- PTY: `src/terminal/PTYManager.ts` — attaches a PTY to a *grouped* tmux session
  (`buildTmuxAttachCommand`, line 44): `tmux has-session ... || new-session ...;
  ... attach-session -t <grouped>`. Used to mirror/attach terminals in the UI.
- **Supervisor implication:** if a target Claude session runs inside a known tmux
  session (`tmuxBaseName(project, session)`), the supervisor CAN inject input via
  `tmux send-keys -t <tmuxSession> "..." Enter`. The codebase already manages tmux
  session names and create/attach, but there is **no existing `send-keys` helper
  or API** — that is the gap a supervisor would add (a new ide-route or a Bash
  call). Caveat: this only works when the user actually launched Claude inside
  that tmux session.

### (b) IPC / push / RemoteTrigger
- No generic RemoteTrigger/push-into-session IPC exists for external Claude
  sessions. The only "push toward a session" primitives are the WS broadcasts
  (UI-facing) and the todo assignment channel (§1).
- Permission flow IS bidirectional for in-server agents: `permission-socket.ts` +
  `PermissionBridge` (`src/agent/`) — a unix socket the spawned child's
  permission hook talks to; the server resolves decisions
  (`resolvePermission`, session-registry.ts:127). Not usable for external sessions.

### (c) In-server agent control surface (full input control)
- `AgentSessionRegistry` (`src/agent/session-registry.ts`) spawns `claude` children
  with a deterministic claudeSessionId (`uuidv5`, line 143) and pipes stream-json.
- Commands via WS (`agent_*` in handler.ts:62-76, dispatched at handler.ts:145-167
  to `agentDispatcher`): `agent_start`, `agent_send` (inject a user message!),
  `agent_cancel`, `agent_resume`, `agent_stop`, `agent_clear`,
  `agent_user_input_respond`, `agent_permission_resolve`, `agent_set_model`, etc.
- **Supervisor implication:** for agents the server itself owns, `agent_send` is a
  first-class "send text into the session" primitive. If supervised sessions were
  modeled as in-server agents (vibe-go style) rather than user-run terminals, the
  supervisor would get clean programmatic control + full transcript via
  `agent_event`. This is the most promising path for true "drive another session".

---

## 4. Cross-session / cross-server architecture

- Each collab server instance is one process on one PORT (default 9002,
  `src/config.ts`). "Cross-server" = the desktop/UI app connecting to *multiple*
  server instances (one per machine/port), aggregating their sessions. The
  "Servers section" and "cross-server unified watching" (commits ea1e63a,
  683456e) are UI-side: `ui/src/views/SidebarView.tsx`,
  `ui/src/hooks/useWatchEvents.ts`, `ui/src/App.tsx`,
  `ui/src/components/layout/SubscriptionsPanel.tsx`.
- Server-side watching: `watchSession(project, session)` (called from
  claude-session/register) and `src/services/session-artifact-watcher.ts` watch
  artifact files and fan out WS events.
- **Supervisor implication:** a supervisor scoped to one server watches that
  server's WS bus. To supervise across servers it would replicate the desktop
  pattern: maintain N WS connections (one per server base URL) and merge models.

---

## 5. Skill structure & what a supervisor skill needs

- Skills live in `skills/<name>/SKILL.md` with YAML frontmatter (name,
  description, trigger). Examples: `skills/collab`, `skills/vibe-active`,
  `skills/vibe-go`, `skills/vibe-checkpoint`.
- `vibe-go` (`skills/vibe-go/SKILL.md`) is the closest prior art for orchestration:
  reads a task graph, computes dependency **waves**, spawns research+implement
  agents per wave **in parallel** (Task tool / sub-agents), posts before/after
  diagrams, has a pair-mode approval gate, fires `ide/open-diff`. It already
  demonstrates: wave scheduling, parallel dispatch, per-task collab artifacts,
  STATUS markers.
- `dispatching-parallel-agents` skill: pattern for 2+ independent tasks.

### A supervisor skill would compose existing pieces:
1. **Discover sessions:** `list_sessions(project)` + read binding files in
   `/tmp/.mermaid-collab-binding-*.json` to map sessions→PIDs.
2. **Monitor:** open WS, track `claude_session_status` (active/waiting/permission),
   `session_todos_updated`, `session_state_updated`; read `.vibeinstructions`
   snippets and `list_session_todos` for "currently doing".
3. **Assign work:** `add_session_todo` / `assign_session_todo` with
   `assigneeSession`, `priority`, `status`. Target sessions poll their assigned
   todos.
4. **Keep idle sessions busy:** when a session goes `waiting` and has unassigned
   backlog todos in scope, assign/nudge it. To *actually wake* a terminal session,
   the only existing transport is `tmux send-keys` to `tmuxBaseName(project,
   session)` (needs a small new helper). For server-owned agents, `agent_send`.
5. **Escalate to user:** `request_user_input` (setup.ts:2160 / `request_user_input`
   tool) and `render_ui` (setup.ts:2932) post blocking/non-blocking UI prompts and
   broadcast `ui_render`; poll with `get_ui_response`. The `/ui-question` skill
   wraps this.

### Notable gaps the supervisor feature must add
- No server-side persisted per-session status store (status is broadcast-only) —
  supervisor must derive it from the WS stream or add a store.
- No `tmux send-keys` API/route — needs adding to inject prompts into external
  terminal sessions.
- No "supervisor registry" of which sessions are under supervision — new state.
- External sessions only signal status; they don't expose live transcript. Only
  in-server agents emit `agent_event`. Driving real transcript-level oversight
  favors the in-server-agent model.
