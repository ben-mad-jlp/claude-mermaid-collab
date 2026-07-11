# Removal Footprint: kodex, pseudo (pseudocode-db), onboarding

## Scope Summary (counts)

| Subsystem | DELETE files | UNWIRE (edit) points | MCP tools to drop | Skills | Deps |
|-----------|-------------|----------------------|-------------------|--------|------|
| **onboarding** | 11 (2 server svc + 1 route + 1 test + 8 UI pages) + lib/onboarding-api.ts + graph-utils (kodex orphan) | main.tsx routes, server.ts dispatch+import, vitest.config exclude | 0 | none | none |
| **pseudo** | ~50 (20 services + 8 service tests + 2 routes + 9 mcp tools + ~20 UI pages/components/tests) + bin/bootstrap-pseudo.ts + .pseudo-sync + .collab/pseudo/pseudo.db | server.ts, mcp/setup.ts (9 imports + 27 tool defs + 27 case handlers + startup init), shared UI editors (CodeEditor/CodeFileView/GlobalSearch/etc.), lib/pseudo-api.ts (SPLIT — keep code-file fns), plugin.json SessionStart hook, vitest.config, .gitignore | 27 | pseudocode, pseudocode-seed | none (chokidar is shared, KEEP) |
| **kodex** | 1 test (skills-kodex-fix-missing.test.ts) + ui/src/lib/graph-utils.ts (+ its test) | none in live code | 0 | kodex-fix-missing skill ALREADY ABSENT (test is dead) | none |

**Key dependency constraint:** `src/services/onboarding-manager.ts` imports `getPseudoDb` from `pseudo-db.ts`. **Onboarding must be removed before pseudo** (onboarding depends on pseudo, not vice-versa).

---

## D. What is "kodex"?
Kodex is a **dead / never-fully-removed feature** — there is no live kodex code:
- No `kodex_*` MCP tools in `src/mcp/setup.ts` (grep returns nothing).
- No `KodexManager` service or `src/services/kodex*` files.
- `skills/kodex-fix-missing/` **does not exist** — yet `ui/src/__tests__/skills-kodex-fix-missing.test.ts` asserts it does and references `kodex_create_topic`/`kodex_list_topics` MCP tools. **This test is already failing/dead** and should be deleted.
- `ui/src/lib/graph-utils.ts` header says "generate Mermaid graph syntax from **Kodex topic relationships**." It is imported **only by its own test** (`ui/src/lib/__tests__/graph-utils.test.ts`) — orphaned. The onboarding `TopicGraph.tsx` defines its own GraphNode/GraphEdge types and does NOT import graph-utils. Safe to delete both.
- Gitignored runtime dir `/.collab/kodex/` (.gitignore:43) — local cache, never committed. Just remove the .gitignore line.

**Conclusion:** "kodex" was the original name for what became "onboarding" (topic graph / knowledge base). Removing it = delete the test + graph-utils.ts + its test + the .gitignore line. Zero live wiring.

---

## ONBOARDING

### A. DELETE outright
- `src/services/onboarding-db.ts`
- `src/services/onboarding-manager.ts`  (NOTE: imports pseudo-db — see ordering)
- `src/services/__tests__/onboarding-db.test.ts`
- `src/routes/onboarding-api.ts`
- `ui/src/lib/onboarding-api.ts`
- `ui/src/pages/onboarding/` (entire dir, 8 files): BrowseDashboard, OnboardingDashboard, OnboardingLayout, SearchResults, TeamDashboard, TopicDetail, TopicGraph, WelcomeScreen
- (kodex) `ui/src/lib/graph-utils.ts` + `ui/src/lib/__tests__/graph-utils.test.ts`

### B. EDIT to unwire
- `src/server.ts:30` — remove `import { handleOnboardingAPI } from './routes/onboarding-api'`
- `src/server.ts:269-272` — remove the `/api/onboarding` dispatch block
- `ui/src/main.tsx:20-27` — remove 8 onboarding page imports
- `ui/src/main.tsx:47-55` — remove the `<Route path="/onboarding">` block
- `ui/src/main.tsx:10` — update the header comment ("Collab, Onboarding, and Pseudo")
- `ui/src/App.tsx:1271` — comment mentions onboarding/pseudo cross-route sync; verify the sync logic itself (read around 1271) — likely just a comment + project-state sync that can stay or be simplified
- `vitest.config.ts:14` — remove `'src/services/__tests__/onboarding-db.test.ts'` from exclude
- `vitest.config.ts:16` — remove `'src/services/__tests__/onboarding-manager.test.ts'` from exclude (file already does not exist — stale entry)

### C. Shared-code caution
- `onboarding-manager.ts` consumes `getPseudoDb` from pseudo-db — only matters for ordering (delete onboarding first; pseudo-db survives until pseudo removal).
- No core code imports FROM onboarding. Clean cut.

---

## PSEUDO (pseudocode-db)

### A. DELETE outright

**Server services (20)** — `src/services/`:
pseudo-ctags.ts, pseudo-db.ts, pseudo-docstring.ts, pseudo-drift.ts, pseudo-fts.ts, pseudo-id.ts, pseudo-indexer.ts, pseudo-migration.ts, pseudo-orphan.ts, pseudo-overlay.ts, pseudo-path-escape.ts, pseudo-prose-file.ts, pseudo-query.ts, pseudo-ranking.ts, pseudo-resolver.ts, pseudo-schema.ts, pseudo-snapshot.ts, pseudo-watcher.ts, (plus pseudo-* not listed: confirm full glob `src/services/pseudo-*.ts`)

**Service tests (8)** — `src/services/__tests__/`:
pseudo-identity.edge.test.ts, pseudo-integration.multiplatform.test.ts, pseudo-migration-rel.test.ts, pseudo-query.test.ts, pseudo-resolver.test.ts, pseudo-stress.test.ts, pseudo-unification.test.ts (+ stale-excluded pseudo-db.test.ts which does not exist on disk)

**Routes (2)** — `src/routes/pseudo-api.ts`, `src/routes/pseudo-api.test.ts`

**MCP tool files (9)** — `src/mcp/tools/`:
pseudo-get-file-state.ts, pseudo-graph.ts, pseudo-orphan-tools.ts, pseudo-ranking-tools.ts, pseudo-reassign.ts, pseudo-rescan.ts, pseudo-search.ts, pseudo-status.ts, pseudo-upsert-prose.ts

**UI pages** — `ui/src/pages/pseudo/` (entire dir, ~20 files incl. tests): CallsLink(.test), CallsPopover(.test), FunctionJumpPanel(.test), PseudoBlock(.test), PseudoFileTree(.test), PseudoPage(.test), PseudoSearch(.test), PseudoViewer, tree.utils.ts

**UI components**:
- `ui/src/components/pseudo/` (ProseOriginBadge, PseudoStatusBar, RenameWarningsList)
- `ui/src/components/editors/PseudoSideBySideView.tsx`
- `ui/src/components/layout/sidebar-tree/PseudoTreeBody.tsx` (used ONLY by pseudo/PseudoFileTree.tsx — safe)

**UI lib tests**: `ui/src/lib/pseudo-api.test.ts`, `ui/src/lib/__tests__/pseudo-api.test.ts`

**Tooling/data**:
- `bin/bootstrap-pseudo.ts`
- `.pseudo-sync` (tracked)
- `.collab/pseudo/pseudo.db` (COMMITTED — git rm it)

**Skills**: `skills/pseudocode/SKILL.md`, `skills/pseudocode-seed/SKILL.md` (delete both dirs)

**Docs (optional cleanup, not load-bearing)**: `docs/pseudo-db-v6-migration.md`, `docs/designs/pseudo-viewer/*`, many `docs/designs/*/pseudocode-item-*.md` (these are design-doc artifacts, leave unless you want a clean sweep)

### B. EDIT to unwire

**`src/server.ts`**:
- Line 28 — remove `import { handlePseudoAPI } from './routes/pseudo-api'`
- Lines 259-262 — remove the `/api/pseudo` dispatch block

**`src/mcp/setup.ts`** (largest unwire):
- Lines 196-215 — remove 9 pseudo tool-module imports (pseudo-status, pseudo-rescan, pseudo-upsert-prose, pseudo-reassign, pseudo-search, pseudo-graph, pseudo-ranking-tools, pseudo-orphan-tools, pseudo-get-file-state). Also find/remove the v2 imports (initPseudoDbV6, pseudo_impact_analysis etc. — grep `pseudo` imports near top, there are more above line 196).
- Lines 2211-2604 — remove all 27 `name: 'pseudo_*'` tool definitions: pseudo_impact_analysis, pseudo_find_function, pseudo_get_module_summary, pseudo_call_chain, pseudo_stale_check, pseudo_coverage_report, pseudo_index_structural, pseudo_index_project, pseudo_upsert_prose, pseudo_get_file_state, pseudo_db_status, pseudo_rescan, pseudo_rerank, pseudo_upsert_prose_v6, pseudo_reassign_prose, pseudo_reassign_prose_bulk, pseudo_search, pseudo_find_function_v6, pseudo_import_graph, pseudo_call_chain_v6, pseudo_stats_delta, pseudo_hot_files, pseudo_list_heuristic_files, pseudo_team_ownership, pseudo_list_orphaned_prose, pseudo_cleanup_orphaned_prose, pseudo_get_file_state_v6
- Lines 4227-4500 — remove all 27 matching `case 'pseudo_*':` handlers
- Lines ~1011-1025 — remove the **startup pseudo-db init block** (`const pseudoHandle = initPseudoDbV6(cwd)` and the SessionStart rescan-marker consumer logic — read 1011 to end of that try block)

**`ui/src/main.tsx`**:
- Line 28 — remove `import PseudoPage`
- Lines 58-59 — remove `<Route path="/pseudo/*">`
- Line 10 — comment

**Shared UI editors (surgical — DO NOT delete these files)**:
- `ui/src/components/editors/CodeEditor.tsx` — core editor. Remove: import of PseudoSideBySideView (14), pseudo imports from pseudo-api (20: fetchFunctionsForSource, fetchPseudoReferences, fetchSourceLink), `showPseudo` state (89), the Pseudo toggle button (~339-350), and the side-by-side render block (~409-424). Keep fetchSourceLink/Reference if still used by jump nav — VERIFY; jump dropdown at 140-177 uses fetchFunctionsForSource/fetchPseudoReferences (pseudo-db tier) so that feature degrades.
- `ui/src/components/editors/CodeFileView.tsx` — core file viewer. Remove: PseudoViewerLazy (7-8), peekPseudoFile import (2) + usage (81-90), the PseudoViewerLazy render (164). Keep `fetchCodeFile`/`CodeFileResponse`/`CodeFileNotFoundError` (those are CORE — see caution).
- `ui/src/components/layout/GlobalSearch.tsx` — Cmd+K search. Uses `SourceLinkCandidate` type + 'pseudo' result kind. Remove pseudo result-kind handling (68 KindIconPseudo, 291 placeholder text, 330 icon switch). Core search stays.
- `ui/src/components/editors/LinkAndNavigateDialog.tsx:10` and `DefinitionPickerPopover.tsx:14` — import `SourceLinkCandidate` type from pseudo-api. These are cross-file-nav features partly built on pseudo. Decide: keep the type by moving it to a core lib, or remove the nav feature. VERIFY whether nav works without pseudo-db.

**`ui/src/lib/pseudo-api.ts` — SPLIT, do NOT delete**:
This file mixes pseudo functions with CORE code-file functions. Pseudo fns (delete): fetchPseudoFiles, fetchPseudoFile, peekPseudoFile, prefetchPseudoFile, fetchPseudoReferences, searchPseudo, fetchFunctionsForSource, fetchSourceLink, invalidatePseudoFileCache + types (PseudoMethod, PseudoFileSummary, PseudoFileWithMethods, SearchResult, FunctionForSource, SourceLinkCandidate, Reference). CORE fns to PRESERVE (hit `/api/code/file`, a separate core route): `fetchCodeFile`, `CodeFileResponse`, `CodeFileNotFoundError`, `CodeFilePathError`. → Rename file to e.g. `ui/src/lib/code-file-api.ts` keeping only the code-file exports, and update CodeFileView + its test import.

**`vitest.config.ts`**:
- Line 12 — remove `'src/routes/pseudo-api.test.ts'`
- Line 17 — remove `'src/services/__tests__/pseudo-db.test.ts'` (stale; file absent)

**`.claude-plugin/plugin.json:30`** — remove the SessionStart hook that touches `pseudo-rescan-${PWD}.marker` (and its enclosing hook entry).

**`.gitignore`** — remove lines 29-51 pseudo/kodex block (comment, pseudo.db-wal/shm, cache, !pseudo.db, kodex cache, pseudo/prose, .migrated*, *.pseudo legacy).

### C. Shared-code caution
- **KEEP `chokidar`** dep — used by file-watcher.ts, session-artifact-watcher.ts (core) in addition to pseudo-watcher/pseudo-db.
- **`pseudo-api.ts` is mixed** (see SPLIT above): `fetchCodeFile` → `/api/code/file` is core; the core `/api/code/*` route is owned by `src/routes` code-api (NOT pseudo-api.ts), confirmed via `src/routes/__tests__/code-api.test.ts`.
- **CORE imports FROM pseudo at callsites that will break**: CodeEditor (jump-to-definition / function dropdown via fetchFunctionsForSource+fetchPseudoReferences), CodeFileView (PseudoViewer tab + freshness badge), GlobalSearch (pseudo result kind), LinkAndNavigateDialog + DefinitionPickerPopover (SourceLinkCandidate cross-file nav). These features must be removed or stubbed at each callsite; the editor/search shells themselves stay.
- `onboarding-manager.ts` imports getPseudoDb — already covered by ordering.

---

## E. Recommended removal ORDER + verification gates

### Step 0 — kodex (trivial, do first, decouples test suite)
- Delete `ui/src/__tests__/skills-kodex-fix-missing.test.ts`, `ui/src/lib/graph-utils.ts`, `ui/src/lib/__tests__/graph-utils.test.ts`.
- Remove `/.collab/kodex/` from .gitignore.
- **Gate:** `npm run test:ci` (UI) — the dead kodex test no longer fails.

### Step 1 — onboarding (small, no dependents)
- Delete services/route/test/UI-pages/lib (Section A).
- Unwire server.ts (30, 269-272), main.tsx (imports + route block), vitest.config (lines 14, 16).
- **Gates:** server boots (`bun src/server.ts` or `npm run dev`); `cd ui && npm run build` (vite + tsc) passes; `npm run test:ci`.

### Step 2 — pseudo (largest, must be after onboarding)
- Split `pseudo-api.ts` → `code-file-api.ts` FIRST, repoint CodeFileView + test, so core file viewing survives.
- Surgically unwire shared editors (CodeEditor, CodeFileView, GlobalSearch, LinkAndNavigateDialog, DefinitionPickerPopover).
- Unwire mcp/setup.ts (imports + 27 defs + 27 handlers + startup init).
- Unwire server.ts (28, 259-262), main.tsx (28, 58-59), vitest.config (12, 17), plugin.json SessionStart hook, .gitignore.
- Delete all Section-A pseudo files; `git rm .collab/pseudo/pseudo.db`, `.pseudo-sync`, `bin/bootstrap-pseudo.ts`; delete `skills/pseudocode`, `skills/pseudocode-seed`.
- **Gates:**
  1. `tsc` / `npm run build` (backend) clean — no dangling pseudo imports.
  2. MCP tool list: start server, confirm `tools/list` excludes all `pseudo_*` (27 gone).
  3. `cd ui && npm run build` — vite + tsc clean (CodeEditor/CodeFileView/GlobalSearch compile without pseudo-api).
  4. `npm run test:ci` (backend) and UI tests green.
  5. Manual: open a code file in the editor → core view + `/api/code/file` still works; Cmd+K search still works (sans pseudo kind).

### Notes / pre-existing tsc errors
- The task brief mentioned `sidebarTreeState.pseudoCollapsedPaths` as a pre-existing tsc error, but grep of `ui/src/stores/` found NO `pseudoCollapsed`/pseudo references — the store appears already clean (verify during Step 2 UI build).
- No `package.json` scripts reference pseudo/onboarding/bootstrap; no deps are pseudo-exclusive.
