# Wave 2 Implementation (v2)

## Tasks
- **supervisor-routes-v2** — REPLACED `src/routes/supervisor-routes.ts`. Dropped `/targets`. New endpoints under `/api/supervisor`: projects (GET/POST/DELETE), supervised (GET/POST/DELETE), roadmap (GET?project=/POST/PATCH/DELETE), escalations (GET) + escalations/resolve (POST), locks (GET/POST/DELETE). Backed by global supervisor-store + roadmap-store; async roadmap calls awaited; 400 validation; try/catch→500. server.ts mount unchanged (startsWith '/api/supervisor').
- **supervisor-mcp-tools** — MODIFIED `src/mcp/setup.ts` (3 sequential edits): (A) imports roadmapStore/supervisorStore namespaces + getStatuses + lastAssistantTurn + listTodos; (B) 12 tool declarations; (C) 12 handler cases. Tools: roadmap_list/add/update/spawn_session, supervisor_list_supervised, supervisor_reconcile, read_last_assistant_turn, escalation_list/resolve/create, attended_lock_set/release. roadmap_spawn_session materializes a session via assigned todos + links + addSupervised('roadmap'); supervisor_reconcile returns per-session {status,updatedAt,openTodos,supervised,locked}.

## Verification
- Both STATUS done. All 12 tools have matching declaration+case; store fn signatures match; no new non-TS5097 errors in setup.ts or supervisor-routes.ts.
- TS5097 (.ts import extension) is the project's Bun convention — ignored, not a logic error.

## Wave TSC
clean for Wave 2 files (only pre-existing project-wide TS5097).
