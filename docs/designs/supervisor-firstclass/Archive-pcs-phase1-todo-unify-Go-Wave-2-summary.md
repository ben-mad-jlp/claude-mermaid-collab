# Wave 2 Implementation

## Tasks
- **session-todos-mcp** (`src/mcp/tools/session-todos.ts` + `src/mcp/setup.ts`): status enums extended to include planned/ready/dropped (listSessionTodos/add/update); added optional `dependsOn`, `parentId`, `sessionName` to addSessionTodo + updateSessionTodo schemas + signatures; addSessionTodo forwards via `...extrasRest`, updateSessionTodo adds them to the explicit updateTodo patch. setup.ts dispatch built explicit objects → updated both cases to destructure+forward the three new fields. Additive; tsc-clean.
- **roadmap-migration** (`src/services/roadmap-migration.ts` NEW + `todo-store.ts` importTodo + `src/server.ts` wire-in + test): `migrateRoadmapToTodos(project)` — idempotent (sentinel todo `__roadmap_migration_v1__`), absent-roadmap.db → skipped (existsSync guard, doesn't create it), maps roadmap_item→todo with SAME id (deps resolve), status 1:1 map, ord→order, parentId/dependsOn/sessionName/blueprintId, ownerSession=`__roadmap__`; backfills parentId from `listItemTodos` join. Added `importTodo` (INSERT OR IGNORE, caller id) to todo-store. server.ts runs it on boot for MERMAID_PROJECT (non-fatal). Does NOT delete roadmap.db or re-point consumers (Phase 5). Real roadmap-store exports used: listItems, listItemTodos(→string[]), createItem, linkTodo.

## Verification
- Both implement agents tsc-clean.
- `bun test todo-store.test.ts roadmap-migration.test.ts` → 33 pass / 0 fail (28 + 5).
- Wave tsc: `npx tsc --noEmit` clean (exit 0).

## Wave TSC
clean.

## Scope held
Additive only — shipped supervisor feature untouched (roadmap-store + REST + RoadmapPanel + localStorage cache all intact; re-point/deprecate = Phase 5).
