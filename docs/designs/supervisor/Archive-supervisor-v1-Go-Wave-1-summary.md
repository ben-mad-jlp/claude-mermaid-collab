# Wave 1 Implementation

## Tasks
- **session-status-store** — NEW `src/services/session-status-store.ts`. Per-project SQLite (`.collab/session-status.db`), todo-store conventions. Exports `ClaudeStatus`, `SessionStatusRow`, `recordStatus` (UPSERT on PK), `getStatuses`, `getStatus`.
- **tmux-send-keys** — MODIFIED `src/routes/ide-routes.ts`. New `POST /api/ide/tmux-send-keys` between create-terminal and open-diff. Validates body, `tmux has-session` (404 if missing), `send-keys text+Enter`, graceful tmux-absent degrade (`{success:true,tmux:false}`).
- **supervisor-store** — NEW `src/services/supervisor-store.ts`. SQLite (`.collab/supervisor.db`, keyed on supervisor project). `supervisor_targets` table, UNIQUE 4-tuple + 2 indexes. `addTarget`/`removeTarget`/`listTargets`/`listSupervisorsOf`.
- **ui-supervisor-store** — NEW `ui/src/stores/supervisorStore.ts`. Zustand mirror of subscriptionStore. `SupervisorTarget`, localStorage cache, `invoke()` (mc.invokeOnServer + fetch fallback), `loadTargets`/`addTarget`/`removeTarget`.

## Verification
- All four files: STATUS done. Semantic review passed for each.
- Per-file tsc: no new errors introduced. Only pre-existing project-wide `TS5097` (`.ts` import extensions) and unrelated test-file errors remain.

## Wave TSC
clean (no new errors; pre-existing TS5097 config issues unchanged)
