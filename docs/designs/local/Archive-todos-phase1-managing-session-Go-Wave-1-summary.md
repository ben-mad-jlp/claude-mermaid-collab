# Wave 1 Implementation (todos Phase 1)

## Tasks
- **broadcast-payload** ✅ — Extended the `session_todos_updated` WS event type with optional `ownerSession?`/`assigneeSession?` (`src/websocket/handler.ts:54`). Enriched the broadcast at all single-todo emit sites with the affected todo's owner/assignee: `src/routes/api.ts` add/patch/delete (delete snapshots via `getTodo` before removal; added `getTodo` to the import) and `src/mcp/setup.ts` add/update/toggle/remove/**assign** (the assign case is the key one — carries the NEW assignee so the assignee's client can react). Multi-todo ops (clear-completed, reorder, complete_linked_todos) keep `session` only.
- **list-sessions-project-filter** ✅ — `GET /api/sessions` (`api.ts:201`) reads optional `?project=` and filters; `list_sessions` MCP tool (`setup.ts`) gains an optional `project` param (schema + `listSessions(project?)` appends `?project=` + dispatch passes it). Backwards-compatible (no param = all).

## Verification
- tsc on touched files: **clean** (no new errors). Confirmed via stash that the remaining handler.ts/api.ts tsc errors (`.ts`-extension import at handler.ts:3; `browser_*` no-overlap at 163+; `pair_mode_changed` at api.ts:696) are PRE-EXISTING — present on the original files, unrelated to this work.

## Notes
- Reassign-away: the broadcast carries the NEW assignee + owner; the OLD assignee's client drops the todo on its next interaction/reconnect (v1 acceptable, per design).
- This + Wave 2's app-refetch-guard close the live cross-session update gap.

## Wave TSC
clean for this wave's changes (only pre-existing unrelated errors remain)
