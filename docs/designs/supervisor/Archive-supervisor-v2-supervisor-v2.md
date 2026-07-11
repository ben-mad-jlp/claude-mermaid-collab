# Blueprint: Supervisor v2

## Source Artifacts
- [[design-supervisor-v2]] — the design
- [[research-supervisor-v2-design-memo]] — stress-test + schema + KEEP/REPLACE
- [[research-single-supervisor-roadmaps]] — mechanics survey

## Premise
Single foreground supervisor; per-project roadmaps; creates session-records + assigns todos with approval; human opens & binds workers; **nudge-only** (no driving/answering decisions/relaying beyond verbatim); escalate-past-nudge to user; **stateless pull** (start-of-turn + ~12-min wake), no server watcher, no in-server agents. Supervised set = roadmap-spawned sessions + manually-supervised watched sessions. KEEP `session-status-store` + `tmux-send-keys` + `/api/session-notify`+`/api/session-status`; REPLACE membership store + `/targets`; DROP WS replay from supervisor path; REWORK panel + skill.

---

## 1. Structure Summary

### Files
- [ ] `src/services/roadmap-store.ts` — NEW. Per-project `roadmap.db` (roadmap_item + roadmap_item_todo). todo-store pattern.
- [ ] `src/services/supervisor-store.ts` — REPLACE. Global `~/.mermaid-collab/supervisor.db`: watched_project, supervised_session, attended_lock, escalation. (Drop the v1 4-tuple membership.)
- [ ] `src/services/transcript-reader.ts` — NEW. `claudeSessionId → last end_turn assistant text + stop_reason`, via binding file + JSONL tail.
- [ ] `src/routes/supervisor-routes.ts` — REPLACE. `/api/supervisor/{projects,roadmap,escalations,locks}` (drop `/targets`). Already mounted in server.ts via `startsWith('/api/supervisor')` — no server.ts change.
- [ ] `src/mcp/setup.ts` — MODIFY. Add MCP tools the skill calls: roadmap CRUD + spawn-session-for-item, escalation list/resolve, attended-lock set/release, read-last-assistant-turn, list-supervised + status reconcile.
- [ ] `ui/src/stores/supervisorStore.ts` — REWORK. Roadmap + escalations + locks (drop targets model).
- [ ] `ui/src/components/layout/SupervisorPanel.tsx` — REWORK. Watched projects → roadmap items → spawned session status/open-todos; escalations inbox; lock indicators.
- [ ] `ui/src/components/layout/SubscriptionsPanel.tsx` — MODIFY. Per-row **"supervise" toggle** writing the supervised flag.
- [ ] `skills/supervisor/SKILL.md` — REWORK. Foreground planning + approval-gated session creation; per-turn + wake reconciliation; nudge/escalate state machine; structured 3-bucket classification + never-list; escalation drain; attended-lock; planned-but-unattached reminders; roadmap collaboration.
- Leave `src/websocket/handler.ts` status-replay inert (not on the supervisor path) — no task.

### Type Definitions
```ts
// roadmap-store.ts
type RoadmapStatus = 'planned'|'ready'|'in_progress'|'blocked'|'done'|'dropped';
interface RoadmapItem { id:string; project:string; title:string; description:string|null;
  status:RoadmapStatus; ord:number; parentId:string|null; dependsOn:string[];
  sessionName:string|null; blueprintId:string|null; createdAt:number; updatedAt:number; }

// supervisor-store.ts (global)
interface WatchedProject { project:string; addedAt:number; }
interface SupervisedSession { project:string; session:string; source:'roadmap'|'manual'; addedAt:number; }
interface AttendedLock { project:string; session:string; lockedAt:number; reason:string|null; expiresAt:number; }
interface Escalation { id:string; project:string; session:string; kind:'human_only'|'attended_request'|'auto_answered';
  questionText:string; status:'open'|'answered'|'attended'|'abandoned'; createdAt:number; resolvedAt:number|null; }

// transcript-reader.ts
interface LastTurn { text:string; stopReason:'end_turn'|'tool_use'|string|null; found:boolean; }
```

### Component Interactions
```
Supervisor skill (Claude) --MCP--> roadmap/escalation/lock/transcript tools
                          --GET--> /api/session-status (reconcile)
                          --POST-> /api/ide/tmux-send-keys (nudge / verbatim relay)
roadmap item --bless--> create collab session (create_document) + add_session_todo(assigneeSession) + roadmap_item_todo link
worker waiting --> transcript-reader.lastTurn --> classify (continue|answerable|human_only)
  human_only --> escalation(open) --> top chat --> user answers(relay verbatim) | "I'll go"(attended_lock)
UI SupervisorPanel <--/api/supervisor/{projects,roadmap,escalations,locks}--> global store
SubscriptionsPanel supervise toggle --> supervised_session
```

---

## 2. Function Blueprints

### `roadmap-store.ts`
Mirror `todo-store.ts` (bun:sqlite, WAL, per-project `dbCache`, `_closeProject`). DB: `<project>/.collab/roadmap.db`.
- `createItem(project, {title, description?, parentId?, dependsOn?, ord?}) -> RoadmapItem` (status `planned`, uuid, ord = max+1).
- `listItems(project) -> RoadmapItem[]` (ORDER BY ord).
- `getItem(project, id)`, `updateItem(project, id, patch)`, `deleteItem(project, id)`.
- `setItemSession(project, id, sessionName, blueprintId?)`, `linkTodo(project, itemId, todoId)`, `listItemTodos(project, itemId) -> string[]`.
- Status rollup helper is advisory only (supervisor confirms `done`). **Edge:** dangling todo ids tolerated; dependsOn stored as JSON. **Test:** CRUD + link + ordering + isolation.

### `supervisor-store.ts` (REPLACE)
Global DB at `join(os.homedir(), '.mermaid-collab', 'supervisor.db')` (mkdirSync recursive, WAL, single cached connection). Tables per the type defs.
- Watched projects: `addWatchedProject/removeWatchedProject/listWatchedProjects`.
- Supervised: `addSupervised(project,session,source)/removeSupervised/listSupervised()/isSupervised(project,session)`.
- Locks: `setLock(project,session,reason,ttlMs)/releaseLock/getLock/listLocks/isLocked`. expiresAt = now+ttl.
- Escalations: `createEscalation({...}) dedup on (session, hash(questionText)) while an open one exists; listOpenEscalations(); resolveEscalation(id, status)`.
- **Drop** all v1 `addTarget/listTargets/listSupervisorsOf`. **Test:** each table CRUD + dedup + lock expiry semantics.

### `transcript-reader.ts`
- `readBinding(claudeSessionId) -> {project,session,claudePid}|null` from `/tmp/.mermaid-collab-binding-<id>.json`.
- `transcriptPath(project, claudeSessionId) -> ~/.claude/projects/<cwd "/"→"-">/<id>.jsonl`.
- `lastAssistantTurn(claudeSessionId) -> LastTurn`: resolve binding → path; read file; parse JSONL lines tolerating a torn final line; find last `type==="assistant" && message.stop_reason==="end_turn" && isSidechain!==true`; join `message.content[].text`. `found:false` if no file/no match. **Edge:** large files — read tail (e.g. last 256KB) and parse complete lines only. **Test:** fixture jsonl → extracts correct last end_turn text; torn-line tolerance; tool_use stop not returned as a "said" turn.

### `supervisor-routes.ts` (REPLACE)
`handleSupervisorRoutes(req,url)` (no wsHandler), jsonError, trailing return null. Sub-paths (all under `/api/supervisor`):
- `GET/POST/DELETE /api/supervisor/projects` → watched projects.
- `GET/POST/DELETE /api/supervisor/supervised` → supervised sessions (body {project,session,source?}).
- `GET /api/supervisor/roadmap?project=` ; `POST` (create item) ; `PATCH` (update) ; `DELETE` (item) — delegate to roadmap-store.
- `GET /api/supervisor/escalations` (open) ; `POST /api/supervisor/escalations/resolve` {id,status}.
- `GET /api/supervisor/locks` ; `POST /api/supervisor/locks` {project,session,reason?,ttlMs?} ; `DELETE` (release).
- 400 on missing fields; try/catch → 500. **Test:** each verb happy-path + validation.

### `setup.ts` MCP tools (MODIFY)
Add tools wrapping the stores/reader (so the skill can operate without raw curl): `roadmap_list/roadmap_add/roadmap_update/roadmap_spawn_session` (create session-record + seed todos + link), `supervisor_list_supervised`, `supervisor_reconcile` (read statuses for watched projects, return per-session {status, updatedAt, openTodos}), `read_last_assistant_turn` (transcript-reader), `escalation_list/escalation_resolve`, `attended_lock_set/attended_lock_release`. Each mirrors existing tool registration + handler style in setup.ts. **Test:** registration parses; handlers call stores.

### `ui` rework
- `supervisorStore.ts`: state `{ watchedProjects, roadmapByProject, escalations, locks }` + actions backed by the new routes (mc.invokeOnServer + fetch fallback, localStorage cache). Drop targets.
- `SupervisorPanel.tsx`: section per watched project → roadmap items (status chip, spawned session + live status from session-status fetch + open-todo count) → an **Escalations inbox** (open escalations with verbatim text + jump-to-session + resolve) → lock badges. Keep ClaudePixAvatar/statusBg helpers.
- `SubscriptionsPanel.tsx`: add a small **supervise toggle** per row → POST/DELETE `/api/supervisor/supervised`.

### `skills/supervisor/SKILL.md` (REWORK)
Sections: identify the single supervisor (current session); collaborate on per-project roadmaps (roadmap_* tools); **approval-gated** session spawn (request_user_input before creating session + todos); reconcile at **start of every turn** + reschedule a ~12-min `ScheduleWakeup`; for each supervised `waiting` worker call `read_last_assistant_turn` → **structured classify** (Step A awaiting-input? Step B 3-bucket with never-list-first, in-doubt→human_only); **nudge** continue-cases via tmux-send-keys ("continue your N todos"); **escalate** human_only → create escalation + surface verbatim in chat + jump hint; on user answer → relay verbatim; on "I'll go" → attended_lock; drain open escalations each turn; remind about planned-but-unattached sessions; never answer permissions/decisions, never drive/course-correct. Keep last-nudge debounce + stale-status guard.

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: roadmap-store
    files: [src/services/roadmap-store.ts]
    tests: [src/services/roadmap-store.test.ts]
    description: "Per-project roadmap.db store (items + item-todo links), todo-store pattern"
    parallel: true
    depends-on: []
  - id: supervisor-store-global
    files: [src/services/supervisor-store.ts]
    tests: [src/services/supervisor-store.test.ts]
    description: "REPLACE membership with global supervisor.db: watched projects, supervised sessions, attended-locks, escalations"
    parallel: true
    depends-on: []
  - id: transcript-reader
    files: [src/services/transcript-reader.ts]
    tests: [src/services/transcript-reader.test.ts]
    description: "Read a session's last end_turn assistant message from its JSONL transcript via binding"
    parallel: true
    depends-on: []
  - id: supervisor-routes-v2
    files: [src/routes/supervisor-routes.ts]
    tests: [src/routes/supervisor-routes.test.ts]
    description: "REPLACE /targets with /projects /supervised /roadmap /escalations /locks endpoints"
    parallel: false
    depends-on: [roadmap-store, supervisor-store-global]
  - id: supervisor-mcp-tools
    files: [src/mcp/setup.ts]
    tests: []
    description: "Add MCP tools: roadmap CRUD + spawn-session, reconcile, read_last_assistant_turn, escalations, attended-locks"
    parallel: false
    depends-on: [roadmap-store, supervisor-store-global, transcript-reader]
  - id: ui-supervisor-rework
    files: [ui/src/components/layout/SupervisorPanel.tsx, ui/src/stores/supervisorStore.ts]
    tests: []
    description: "Rework panel+store: roadmaps, spawned-session status, escalations inbox, lock badges"
    parallel: false
    depends-on: [supervisor-routes-v2]
  - id: ui-supervise-toggle
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Per-row supervise toggle writing the supervised flag"
    parallel: false
    depends-on: [supervisor-routes-v2]
  - id: supervisor-skill-v2
    files: [skills/supervisor/SKILL.md]
    tests: []
    description: "Rewrite skill: roadmap planning, approval-gated spawn, per-turn+wake reconcile, classify/nudge/escalate, attended-lock"
    parallel: false
    depends-on: [supervisor-mcp-tools, supervisor-routes-v2, transcript-reader]
```

### Execution Waves
**Wave 1 (parallel):** roadmap-store, supervisor-store-global, transcript-reader
**Wave 2:** supervisor-routes-v2, supervisor-mcp-tools
**Wave 3:** ui-supervisor-rework, ui-supervise-toggle, supervisor-skill-v2

### Summary
- Total tasks: 8
- Total waves: 3
- Max parallelism: 3
