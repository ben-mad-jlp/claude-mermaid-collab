# Wave 1 Implementation (v2)

## Tasks
- **roadmap-store** — NEW `src/services/roadmap-store.ts`. Per-project `roadmap.db` mirroring todo-store (dbCache/openDb/_closeProject/withLock, crypto.randomUUID). `roadmap_item` + `roadmap_item_todo` + 2 indexes. createItem/listItems/getItem/updateItem/deleteItem/setItemSession/linkTodo/listItemTodos. createdAt/updatedAt as epoch ms.
- **supervisor-store-global** — REPLACED `src/services/supervisor-store.ts` (full rewrite). Global `~/.mermaid-collab/supervisor.db`, single cached connection. Tables watched_project / supervised_session / attended_lock / escalation. Watched/supervised/lock (30m TTL, expiry-aware isLocked)/escalation (dedup on session+questionText+open) functions. Dropped all v1 4-tuple membership.
- **transcript-reader** — NEW `src/services/transcript-reader.ts`. readBinding / transcriptPath (cwd `/`→`-`) / lastAssistantTurn (256KB tail-read, torn-line tolerant, last assistant end_turn non-sidechain text). Read-only.

## Verification
- All three STATUS done; semantic review passed; no tsc errors on the new files.
- Expected: `supervisor-routes.ts` has 3 TS2305 errors from the removed v1 symbols (addTarget/listTargets/removeTarget) — fixed in Wave 2 by `supervisor-routes-v2`.

## Wave TSC
clean for Wave 1 files (the supervisor-routes.ts errors are the intended Wave-2 replacement target).
