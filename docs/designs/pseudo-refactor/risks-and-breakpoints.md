# Risks and Breakpoints: Pseudo Refactor + Kodex Removal

## 1. Hard Dependencies That Will Break When Kodex Is Removed

### 1.1 Shared `kodexStore` Used by Non-Kodex Pages (CRITICAL)

The Zustand store `ui/src/stores/kodexStore.ts` is **not just for kodex** — it manages project selection globally. Three non-kodex systems depend on it:

- **PseudoPage** (`ui/src/pages/pseudo/PseudoPage.tsx` line 15, 46) — imports `useKodexStore` for `selectedProject`
- **OnboardingLayout** (`ui/src/pages/onboarding/OnboardingLayout.tsx` line 10, 102) — imports `useKodexStore` for `selectedProject`
- **App.tsx** (`ui/src/App.tsx` line 39, 257) — cross-route project sync writes to `kodexStore` when collab session changes

The store itself is actually a **generic project selector** (backed by `projectsApi`, not kodex). It just happens to be named `kodexStore`. Deleting `kodexStore.ts` without a rename/replacement will break Pseudo and Onboarding UIs.

**Mitigation**: Rename `kodexStore` to `projectStore` before deletion, or extract a shared project store.

### 1.2 ProjectSelector Component Lives Under kodex/ (CRITICAL)

`ui/src/components/kodex/ProjectSelector.tsx` is imported by both PseudoPage and OnboardingLayout. It's a generic component that happens to be in the kodex directory.

**Mitigation**: Move `ProjectSelector.tsx` to `ui/src/components/shared/` or `ui/src/components/layout/` before Phase 3 deletion.

### 1.3 Direct Kodex Imports in Onboarding API Route (CRITICAL)

`src/routes/onboarding-api.ts` line 13 directly imports `getKodexManager` from `kodex-manager.ts`. Three route handlers call it:
- `/topics` (line 47-49)
- `/topics/:name` (line 53-59)
- `/topics/:name/diagram` (line 62-65)

**Risk**: If Phase 3 (delete kodex) runs before Phase 2 (rewire onboarding) is complete, the onboarding API crashes on these routes.

### 1.4 OnboardingManager Hard Dependency on Kodex (CRITICAL)

`src/services/onboarding-manager.ts` calls `getKodexManager()` in 4 methods:
- `getConfig()` — calls `kodex.listTopics()` for topic count
- `getCategories()` — calls `kodex.listTopics()` for category derivation
- `getGraph()` — calls `kodex.listTopics()` + reads `.collab/kodex/topics/` filesystem
- `getDiagram()` — calls `kodex.getTopic()` for diagram content

### 1.5 OnboardingDbService FTS Index Reads Kodex Filesystem (HIGH)

`src/services/onboarding-db.ts` line 117 hardcodes the path `.collab/kodex/topics/` and reads `conceptual.md`, `technical.md`, `files.md` from topic directories to build the FTS5 search index. This will produce empty search results once Kodex directories are deleted.

### 1.6 NavMenu Has Hardcoded Kodex Route (LOW)

`ui/src/components/layout/NavMenu.tsx` line 22 has a nav item pointing to `/kodex`. Will produce a dead link after Phase 3.

### 1.7 collab-manager.ts Exclusion Logic (LOW)

`src/services/collab-manager.ts` lines 121, 156 explicitly skip `kodex` when scanning `.collab/` directories. After removal this is harmless dead code but should be cleaned up.

---

## 2. Parser Edge Cases That Won't Map Cleanly to the New Schema

### 2.1 FUNCTION Line Regex Mismatch — Date/EXPORT Ordering (CRITICAL)

The existing parser regex in `parsePseudo.ts` line 89:
```
/^FUNCTION\s+(\w[\w.]*)\s*(\([^)]*\))?\s*(?:->\s*(.+?))?\s*(EXPORT)?\s*(?:\[(\d{4}-\d{2}-\d{2})\])?$/
```

Expects: `FUNCTION name(params) -> type EXPORT [YYYY-MM-DD]`

But **85 FUNCTION lines** across 25 .pseudo files use the opposite order:
```
FUNCTION name(params) -> type [YYYY-MM-DD] EXPORT
```

For these lines, the parser won't capture EITHER the date or the EXPORT flag. This means:
- `is_export` will be `false` (wrong) for 85 functions
- `date` will be `null` (wrong) for 85 functions
- The FTS index and query results will have incorrect export status

A second variant with `EXPORT [YYYY-MM-DD]` (4 files) works correctly with the regex.

**Mitigation**: Fix the regex to handle both orderings before building the server-side parser. Regex should match `(EXPORT)?\s*\[date\]?\s*(EXPORT)?` and check either capture group.

### 2.2 Params with Types Won't Split Cleanly (MEDIUM)

Some .pseudo files include type annotations in params, e.g.:
```
FUNCTION parseColor(input: string) -> Color
FUNCTION computeLayout(graph: SceneGraph, frameId: string) -> void
```

The schema stores `params TEXT` as a raw string, which is fine. But if the design later needs to parse params into structured data (e.g., for type-aware search), the colon-separated format will need its own parser.

### 2.3 Dotted Function Names (LOW)

The parser allows `\w[\w.]*` for function names, supporting patterns like `DocumentManager.constructor`. The schema's `UNIQUE(file_id, name)` constraint works here, but the `name` column should be indexed to handle dotted lookups efficiently.

### 2.4 Multi-Line CALLS Entries (LOW)

The CALLS parser handles only lines starting with `CALLS:`. In practice, all CALLS are single-line. But if a function has many cross-file calls that wrap to the next line, the parser will miss the continuation. This is unlikely based on current files but worth noting.

### 2.5 Empty/Minimal .pseudo Files (LOW)

Files with only header comments and no FUNCTION blocks (e.g., pure prose descriptions) will create `pseudo_files` rows with zero `pseudo_functions`. This is valid but the `search` endpoint needs to handle files that have module_context but no functions.

---

## 3. Onboarding Features That Depend on Kodex Concepts with No Pseudo Equivalent

### 3.1 Five-Tab Topic Content Model (CRITICAL)

Onboarding's `TopicDetail.tsx` renders 5 tabs: Overview (conceptual.md), Technical (technical.md), Files (files.md), Related (related.md), Diagrams (diagrams.md). Each tab has distinct markdown content from Kodex.

Pseudo files have ONE content model: header + module prose + FUNCTION blocks. There's no natural mapping to 5 separate sections. The UI will need a complete redesign of the topic detail view.

**Options**:
- Replace 5 tabs with a single pseudo viewer (reuse `PseudoViewer.tsx`)
- Auto-generate tabs: "Overview" = module_context, "Functions" = function list, "Dependencies" = CALLS graph
- Accept the content model difference and design new tabs around pseudo's strengths

### 3.2 Confidence Levels (MEDIUM)

Kodex topics have a `confidence` field (low/medium/high). Pseudo has no confidence concept. The `TopicSummary` type in `onboarding-api.ts` includes `confidence: string`. Onboarding sorting/filtering by confidence won't work.

**Mitigation**: Could derive a pseudo "completeness" metric from function coverage (% of source file functions that have pseudo blocks).

### 3.3 Topic Relationship Graph (MEDIUM)

Kodex's graph is built from `related.md` which contains curated, human-written topic relationships. Pseudo's CALLS graph is a function-level call graph (much more granular). The visualization in `TopicGraph.tsx` expects topic-level nodes with categories.

The CALLS graph gives file-level and function-level edges, which is richer but different. The UI needs to aggregate function-level edges into file-level edges for a comparable visualization.

### 3.4 Diagrams Tab (LOW — planned deletion)

Already noted in design plan as "REMOVE". The `DiagramsTab.tsx` component and `/topics/:name/diagram` endpoint will be deleted.

### 3.5 Category Derivation (MEDIUM)

Kodex derives categories from topic name prefixes (e.g., `auth-*` -> "auth"). The design plan proposes directory-based grouping. This is fine conceptually but the `deriveCategories()` function in `onboarding-manager.ts` is tightly coupled to the name-prefix approach. It needs a full rewrite, not just swapping the data source.

### 3.6 Learning Paths (LOW)

`kodex-onboarding.json` can define ordered learning paths with topic sequences. Pseudo files don't have an equivalent concept. This feature will be lost unless the config file format is adapted.

---

## 4. Data Migration Risks

### 4.1 Existing Onboarding progress.db Data (HIGH)

The `progress` and `notes` tables in `progress.db` use `topic_name TEXT` (e.g., "authentication", "deployment"). After rewiring to pseudo, the key becomes `file_path` (e.g., "src/services/auth.ts"). 

Existing progress and notes data will become orphaned — no mapping exists from Kodex topic names to source file paths. There's no automated way to create this mapping since topics are conceptual groupings, not file-level.

**Mitigation**: Either accept data loss (progress.db is per-project, low volume) or provide a manual migration mapping via config file.

### 4.2 FTS Index Rebuild (LOW)

The FTS index (`index.db`) will need a full rebuild. This is non-destructive since it's a cache, but the first request after migration will be slow if done lazily.

### 4.3 .pseudo File Coverage Gaps (MEDIUM)

Not every source file has a .pseudo file. If onboarding relies on pseudo for topic browsing, files without .pseudo will be invisible. The `pseudocode` skill's skip rules (files under 20 lines, test files, config files) mean onboarding will show partial coverage.

**Mitigation**: Run `/pseudocode all` before enabling the new onboarding, or show uncovered files with a "no documentation" placeholder.

---

## 5. UI Components Shared Between Kodex and Other Systems

| Component | Location | Used By | Risk |
|-----------|----------|---------|------|
| `kodexStore` | `ui/src/stores/kodexStore.ts` | Kodex, Pseudo, Onboarding, App.tsx | **HIGH** — must rename/extract before deleting kodex |
| `ProjectSelector` | `ui/src/components/kodex/ProjectSelector.tsx` | Kodex, Pseudo, Onboarding | **HIGH** — must relocate before deleting kodex dir |
| `NavMenu` | `ui/src/components/layout/NavMenu.tsx` | Global | **LOW** — just remove kodex nav item |

---

## 6. External Consumers (Skills, Hooks, Plugins)

### 6.1 Ten Kodex Skills (Phase 3 deletion)

All 10 kodex skill directories under `skills/` reference kodex MCP tools. These must be deleted in Phase 3. No external consumers beyond this repo.

### 6.2 `using-kodex` Skill Referenced in Other Skills (MEDIUM)

Several other skills (like `vibe-active`, task execution workflows) may reference `using-kodex` as a dependency. Search for cross-skill references before deletion.

### 6.3 `.claude/settings.local.json` Allow List (LOW)

The settings file has 20+ kodex-related tool permissions in its `allowedTools` array. These will become orphaned entries (harmless but noisy).

### 6.4 MCP Tool Definitions in setup.ts (~380 lines) (LOW)

15 kodex tool definitions + their handler cases in `src/mcp/setup.ts`. Deletion is straightforward but the file is large (~3200+ lines) — be careful not to accidentally remove adjacent non-kodex handlers.

### 6.5 README.md References (LOW)

README has kodex references in directory structure, MCP tools table, and skills list.

---

## 7. Race Conditions and Performance Concerns with SQLite

### 7.1 Concurrent Write Contention (MEDIUM)

If multiple Claude sessions run `/pseudocode` simultaneously on the same project, concurrent `upsertFile()` calls could hit SQLite's single-writer lock. Bun's `bun:sqlite` driver uses WAL mode by default which helps, but `bulkIngest()` (which drops and rebuilds tables) could cause long locks.

**Mitigation**: Use `BEGIN IMMEDIATE` transactions for bulk operations; consider a write queue or mutex.

### 7.2 Server Startup Scan Time (MEDIUM)

The design says "On server start: scan for all .pseudo files, parse and ingest into DB." For large repos, this could delay server startup significantly. A repo with 200+ .pseudo files means 200 file reads + parses + DB inserts on every server restart.

**Mitigation**: Background the initial scan; serve from stale DB data while rebuilding. Or use a "last-modified" check to only re-ingest changed files.

### 7.3 FTS5 Sync Trigger Complexity (LOW)

The design uses a `content=pseudo_functions` FTS5 content table, which means the FTS index is NOT auto-updated. Every INSERT/UPDATE/DELETE on `pseudo_functions` requires a manual corresponding FTS update. If these get out of sync, search results will be corrupted.

**Mitigation**: Use triggers or always rebuild FTS after batch operations.

### 7.4 DB File Location and .gitignore (LOW)

The DB is at `{project}/.collab/pseudo/pseudo.db`. Verify `.collab/` is in `.gitignore` (it should be, since kodex already uses `.collab/`). The DB is a cache and should never be committed.

### 7.5 OnboardingDbService Creates New Instance Per Request (MEDIUM)

`onboarding-api.ts` line 25 creates a `new OnboardingDbService(project)` on every request. Each instance opens SQLite connections. If the same pattern is used for `PseudoDbService`, this means opening and closing DB connections per request, which is expensive.

**Mitigation**: Use a singleton/cache pattern like `getKodexManager()` does — one instance per project, reused across requests.

---

## 8. Execution Order Risks

### 8.1 Phase Ordering is Not Optional (CRITICAL)

Phase 2 must fully complete before Phase 3 starts. The onboarding code currently imports from `kodex-manager.ts`. If you delete kodex files (Phase 3) before rewiring all imports (Phase 2), the build breaks immediately. There's no graceful degradation.

### 8.2 Pseudo DB Must Be Seeded Before Onboarding Rewire (HIGH)

Phase 2 assumes `PseudoDbService` has data. If the DB is empty (e.g., server wasn't restarted after Phase 1, or `.pseudo` files don't exist for the project), all onboarding endpoints will return empty results.

**Mitigation**: Add a health check or auto-rebuild to Phase 2 that ensures the pseudo DB is populated before onboarding starts consuming it.

---

## Summary: Top 5 Action Items Before Implementation

1. **Fix the parser regex** to handle `[YYYY-MM-DD] EXPORT` ordering (85 affected functions)
2. **Extract kodexStore -> projectStore** and move ProjectSelector before any deletion
3. **Design the onboarding topic detail UX** — the 5-tab Kodex content model has no pseudo equivalent
4. **Accept progress.db data loss** or build a manual topic->file mapping
5. **Use singleton DB pattern** for PseudoDbService to avoid per-request connection overhead
