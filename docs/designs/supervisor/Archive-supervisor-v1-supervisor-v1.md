# Blueprint: Supervisor v1

## Source Artifacts
- `design-supervisor-v1` — the design doc (scope, state machine, decisions)
- `research-supervisor-mechanics` — existing-code mechanics with file:line refs

## Decisions baked in
- Membership is **user-assigned** (opt-in set, like Watching).
- Status store is **SQLite** (survives restart).
- Nudge text includes **open-todo count**.
- Loop is **self-scheduling wake** (`ScheduleWakeup`).
- Escalation: supervisor console **+** UI badge.
- Watch→tmux push: **follow-up wave**, polling ships first.

---

## 1. Structure Summary

### Files
- [ ] `src/services/session-status-store.ts` — NEW. SQLite-backed last-known status per session.
- [ ] `src/routes/api.ts` — MODIFY. In `/api/session-notify` (line 2417) persist status before broadcast; add `GET /api/session-status`.
- [ ] `src/routes/ide-routes.ts` — MODIFY. Add `POST /api/ide/tmux-send-keys`.
- [ ] `src/services/supervisor-store.ts` — NEW. SQLite-backed supervisor→assigned-sessions membership.
- [ ] `src/routes/supervisor-routes.ts` — NEW. CRUD endpoints for membership; mounted in the main router.
- [ ] `src/websocket/handler.ts` — MODIFY (optional). Replay last-known `claude_session_status` to new subscribers (mirrors `ide_status` replay at handler.ts:127-138).
- [ ] `ui/src/stores/supervisorStore.ts` — NEW. Zustand store mirroring `subscriptionStore` for the assigned set.
- [ ] `ui/src/components/layout/SupervisorPanel.tsx` — NEW. Sidebar section (above Watching) listing assigned sessions + status + add/remove.
- [ ] Sidebar mount point (`ui/src/views/SidebarView.tsx` or wherever `SubscriptionsPanel` renders) — MODIFY. Render `SupervisorPanel` above `SubscriptionsPanel`.
- [ ] `skills/supervisor/SKILL.md` — NEW. The supervisor loop skill.
- [ ] `desktop/src/main/index.ts` + `desktop/src/main/watch-aggregator.ts` — MODIFY (FOLLOW-UP). Tap `forward()` to push tmux send-keys into the supervisor's tmux.

### Type Definitions
```ts
// session-status-store.ts
type ClaudeStatus = 'active' | 'waiting' | 'permission';
interface SessionStatusRow { project: string; session: string; status: ClaudeStatus; updatedAt: number; }

// supervisor-store.ts
interface SupervisorMembership { supervisorProject: string; supervisorSession: string; targetProject: string; targetSession: string; createdAt: number; }
```

### Component Interactions
```
Claude hooks → POST /api/session-notify → [status store write] → WS broadcast
Supervisor skill → GET /api/session-status + list_session_todos → state machine
                 → POST /api/ide/tmux-send-keys (nudge eligible)
                 → reads supervisor membership (GET /api/supervisor/:proj/:sess/targets)
UI SupervisorPanel → CRUD /api/supervisor/... ; renders status from WS claude_session_status
```

---

## 2. Function Blueprints

### `session-status-store.ts`
**`recordStatus(project, session, status): void`**
1. Open/create per-project SQLite DB (reuse todo-store's per-project pattern, todo-store.ts:1-10).
2. UPSERT row keyed by (project, session) with status + `updatedAt = Date.now()`.

**`getStatuses(project): SessionStatusRow[]`** — SELECT all rows for project.
**`getStatus(project, session): SessionStatusRow | null`** — SELECT one.
- **Staleness** is computed by the *reader* (supervisor), not stored: if `now - updatedAt > N` → treat `unknown`. N is config (default ~120s).
- **Edge cases:** missing DB dir → mkdirSync (todo-store pattern). Unknown status enum → reject (already validated upstream at api.ts:2384).
- **Test:** record→get round-trip; upsert overwrites; multi-session isolation.

### `api.ts` — `/api/session-notify` patch
1. After the binding trust-check passes (api.ts:2415), call `recordStatus(project, session, status)`.
2. Then existing `wsHandler.broadcast(...)` (unchanged).
- **Error handling:** wrap store write in try/catch; a store failure must NOT block the broadcast (log + continue).

### `api.ts` — `GET /api/session-status`
- Query `?project=`; return `getStatuses(project)`. 400 if no project.

### `ide-routes.ts` — `POST /api/ide/tmux-send-keys`
**Body:** `{ project, session, text }`.
1. Validate project/session/text present (mirror create-terminal, ide-routes.ts:56-64).
2. `const tmuxSession = tmuxBaseName(project, session)` (already imported, line 4).
3. `tmux has-session -t <name>` → if absent, 404 (don't create; nudging a nonexistent terminal is a no-op).
4. `Bun.spawn(['tmux', 'send-keys', '-t', tmuxSession, text, 'Enter'])` — send text + Enter as one call (tmux treats trailing `Enter` as the submit key). Await exit.
5. Graceful degrade if tmux ENOENT (mirror create-terminal soft no-op, ide-routes.ts:73-81) → return `{ success:true, tmux:false }`.
- **Edge cases:** text with quotes/newlines — pass as a single argv element (no shell), so injection-safe. Empty text → 400.
- **Safety:** route only *sends*; the "only when waiting" decision lives in the skill.
- **Test:** send to live tmux session echoes text; missing session → 404; tmux absent → soft success.

### `supervisor-store.ts`
- `addTarget(supProj, supSess, tgtProj, tgtSess)`, `removeTarget(...)`, `listTargets(supProj, supSess): SupervisorMembership[]`, `listSupervisorsOf(tgtProj, tgtSess)` (for the watch-push follow-up).
- SQLite, same per-project pattern. Unique constraint on the 4-tuple.
- **Test:** add/list/remove; dedupe on re-add.

### `supervisor-routes.ts`
- `GET /api/supervisor/targets?project=&session=` → listTargets.
- `POST /api/supervisor/targets` `{ supervisorProject, supervisorSession, targetProject, targetSession }` → addTarget.
- `DELETE /api/supervisor/targets` (same body) → removeTarget.
- 400 on missing fields. Returns updated list.

### `handler.ts` — status replay (optional)
- On `subscribe`, after the existing `ide_status` replay (handler.ts:127-138), also send last-known `claude_session_status` rows for the subscribed channel/project. Keeps a fresh subscriber from missing current state.

### `supervisorStore.ts` (UI)
- Mirror `subscriptionStore`: `{ targets, addTarget, removeTarget }`, persisted; backed by `/api/supervisor/targets`. Cross-server via `mc.invokeOnServer` like SubscriptionsPanel does.

### `SupervisorPanel.tsx` (UI)
- Reuse SubscriptionsPanel layout (status colors at SubscriptionsPanel.tsx:178-185, ClaudePixAvatar, elapsed). Header "Supervisor" with count + add button. Each row: assigned session, live status from `claude_session_status` WS, remove button. **Badge** when any assigned session is `permission` or has been `waiting`+has-todos beyond threshold (escalation surface).

### `skills/supervisor/SKILL.md`
- Frontmatter (name/description/trigger) like `skills/vibe-go`.
- Entry: register own session (collab pattern); read membership via `GET /api/supervisor/targets`.
- **Wake loop:**
  1. `GET /api/session-status?project=` + `list_session_todos(assigneeSession=X)` per target.
  2. Apply state machine: `active`/`permission`/stale → skip; `waiting`+open todos → nudge; `waiting`+none → report.
  3. Nudge = `POST /api/ide/tmux-send-keys` with "You have N open todos — continue working on them." Track last-nudge + require active→waiting transition before re-nudging.
  4. Escalate blocked/questions to console (and rely on UI badge).
  5. `ScheduleWakeup(delaySeconds≈1200, prompt=<<autonomous-loop-dynamic>> or /supervisor)`. Faster wake later via watch-push.
- Never nudge itself.

### Watch→tmux push (FOLLOW-UP) — `desktop/src/main/index.ts:273`
- In `WatchAggregator.forward`, for a `claude_session_status` event whose (project,session) is a supervised target transitioning to `waiting`, resolve supervisor's tmux via `tmuxBaseName` and call the send-keys route (main process has tmux access). Requires `listSupervisorsOf`.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: session-status-store
    files: [src/services/session-status-store.ts]
    tests: [src/services/session-status-store.test.ts]
    description: "SQLite per-project last-known Claude status store (record/get)"
    parallel: true
    depends-on: []
  - id: tmux-send-keys
    files: [src/routes/ide-routes.ts]
    tests: [src/routes/ide-routes.test.ts]
    description: "POST /api/ide/tmux-send-keys — inject text+Enter into a session's tmux"
    parallel: true
    depends-on: []
  - id: supervisor-store
    files: [src/services/supervisor-store.ts]
    tests: [src/services/supervisor-store.test.ts]
    description: "SQLite supervisor→assigned-sessions membership store"
    parallel: true
    depends-on: []
  - id: ui-supervisor-store
    files: [ui/src/stores/supervisorStore.ts]
    tests: [ui/src/stores/supervisorStore.test.ts]
    description: "Zustand store for assigned sessions, backed by supervisor REST API"
    parallel: true
    depends-on: []
  - id: api-status-wire
    files: [src/routes/api.ts]
    tests: [src/routes/api.test.ts]
    description: "Persist status in /api/session-notify; add GET /api/session-status"
    parallel: false
    depends-on: [session-status-store]
  - id: ws-status-replay
    files: [src/websocket/handler.ts]
    tests: [src/websocket/handler.test.ts]
    description: "Replay last-known claude_session_status to new subscribers (optional)"
    parallel: true
    depends-on: [session-status-store]
  - id: supervisor-api
    files: [src/routes/supervisor-routes.ts]
    tests: [src/routes/supervisor-routes.test.ts]
    description: "CRUD endpoints for supervisor membership"
    parallel: false
    depends-on: [supervisor-store]
  - id: ui-supervisor-panel
    files: [ui/src/components/layout/SupervisorPanel.tsx]
    tests: [ui/src/components/layout/SupervisorPanel.test.tsx]
    description: "Sidebar Supervisor section (status rows, add/remove, escalation badge)"
    parallel: false
    depends-on: [ui-supervisor-store]
  - id: ui-sidebar-wire
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Mount SupervisorPanel above the Watching section"
    parallel: false
    depends-on: [ui-supervisor-panel]
  - id: supervisor-skill
    files: [skills/supervisor/SKILL.md]
    tests: []
    description: "Supervisor wake-loop skill: poll status+todos, nudge idle, escalate"
    parallel: false
    depends-on: [tmux-send-keys, api-status-wire, supervisor-api]
  - id: watch-tmux-push
    files: [desktop/src/main/index.ts, desktop/src/main/watch-aggregator.ts]
    tests: []
    description: "FOLLOW-UP: push tmux send-keys into supervisor tmux on watch events"
    parallel: false
    depends-on: [tmux-send-keys, supervisor-api]
```

### Execution Waves

**Wave 1 (parallel):**
- session-status-store, tmux-send-keys, supervisor-store, ui-supervisor-store

**Wave 2 (depends on Wave 1):**
- api-status-wire, ws-status-replay, supervisor-api, ui-supervisor-panel

**Wave 3 (depends on Wave 2):**
- ui-sidebar-wire, supervisor-skill

**Wave 4 (follow-up, optional):**
- watch-tmux-push

### Summary
- Total tasks: 11 (10 core + 1 follow-up)
- Total waves: 4 (3 core + 1 follow-up)
- Max parallelism: 4
