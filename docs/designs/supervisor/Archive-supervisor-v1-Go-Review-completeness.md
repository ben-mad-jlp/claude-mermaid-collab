# Completeness Review — Supervisor v1

**Verdict: Everything complete (minus the deferred `watch-tmux-push` follow-up). No real gaps.**

All 10 core tasks across Waves 1–3 are implemented with real (non-stub) code, and every wiring point specified in the blueprint is present. `watch-tmux-push` (Wave 4) was consciously deferred per the Wave 3 summary — the self-scheduling wake loop already delivers the functionality.

## Files (all present, real implementations)

| File | Status | Notes |
|------|--------|-------|
| `src/services/session-status-store.ts` | OK | SQLite per-project (`.collab/session-status.db`), WAL, conn cache. `ClaudeStatus`, `SessionStatusRow`, `recordStatus` (UPSERT on PK), `getStatuses`, `getStatus`. |
| `src/services/supervisor-store.ts` | OK | SQLite per-supervisor-project (`.collab/supervisor.db`). `supervisor_targets` with UNIQUE 4-tuple + 2 indexes. `addTarget` (INSERT OR IGNORE = dedupe), `removeTarget`, `listTargets`, `listSupervisorsOf`. |
| `src/routes/supervisor-routes.ts` | OK | `handleSupervisorRoutes(req,url)`; GET/POST/DELETE `/api/supervisor/targets`; 400 on missing fields; returns updated list. |
| `ui/src/stores/supervisorStore.ts` | OK | Zustand mirror; `loadTargets`/`addTarget`/`removeTarget`; localStorage cache; `invoke()` via `mc.invokeOnServer` with fetch fallback. |
| `ui/src/components/layout/SupervisorPanel.tsx` | OK | Collapsible "Supervisor" section, status rows, add picker, remove button, pulsing escalation badge on `permission`. |
| `skills/supervisor/SKILL.md` | OK | Frontmatter (name/description/user-invocable/allowed-tools); full wake-loop, state machine, nudge, escalate, ScheduleWakeup. |

## Wiring (all present)
- `recordStatus` called in `src/routes/api.ts` `/api/session-notify` (line 2419) inside try/catch — failure logged, broadcast not blocked.
- `GET /api/session-status?project=` → `{ statuses: getStatuses(project) }`, 400 if no project (api.ts:2437).
- `POST /api/ide/tmux-send-keys` in `src/routes/ide-routes.ts` (line 94): validates project/session/text; `tmux has-session` → 404 if absent; `send-keys text Enter`; ENOENT soft no-op `{success:true,tmux:false}`; success `{success:true,tmux:true}`.
- `handleSupervisorRoutes` mounted in `src/server.ts` (line 301).
- Status replay in `src/websocket/handler.ts` (line 145): replays `claude_session_status` rows on subscribe when `data.project` present (inert until client passes `project` — documented v1 limitation).
- `SupervisorPanel` rendered above `SubscriptionsPanel` in BOTH `ui/src/views/SidebarView.tsx` (line 70) and `ui/src/components/layout/Sidebar.tsx` (line 83).

## Stubs / TODOs
No missing implementations. Only TODOs found are 2 documented v1 limitations in `SupervisorPanel.tsx` (lines 203, 212):
1. Targets not also in the Watching set show `unknown` live status (supervisor skill covers this via `/api/session-status` poll).
2. Escalation badge fires only on `permission`; `waiting`+todos handled by the skill, not the badge.
Both are acceptable, matching the Wave 2 "Known v1 limitations".

## Acceptance vs goal — SKILL endpoint shapes match code
- List targets: SKILL uses `GET /api/supervisor/targets?project=&session=` → matches route (requires both, 400 otherwise).
- Read status: `GET /api/session-status?project=` returning `{ statuses }` → matches.
- Read todos: `list_session_todos` with `assigneeSession` → MCP tool exists.
- Nudge: `POST /api/ide/tmux-send-keys {project,session,text}` → matches; SKILL correctly handles 404 and `{success,tmux:false}` responses.
- Escalate permission/blocked: surfaced to console + UI `permission` badge → matches.

End-to-end goal (list assigned targets, read status+todos, nudge idle via tmux, escalate permission/blocked) is fully described in SKILL.md and backed by existing endpoints with matching shapes.

## Deferred (not a gap)
- `watch-tmux-push` (`desktop/src/main/index.ts`, `watch-aggregator.ts`) — optional fast-path follow-up; deferred per Wave 3 summary (reverse-lookup under-determined by per-supervisor-project DB partitioning; polling loop already delivers functionality).
