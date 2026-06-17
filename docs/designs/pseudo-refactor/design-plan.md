# Design Plan: Remove Kodex, Refactor Pseudo to SQLite, Rewire Onboarding

## Overview

Four phases, executed in strict order:

0. **Phase 0 — Relocate Shared Infra**: Move `kodexStore` and `ProjectSelector` out of kodex directories before touching anything else
1. **Phase 1 — Pseudo to SQLite**: Replace file-based `.pseudo` storage with a SQLite database. Fix parser bug first. Add MCP tools + P0 features.
2. **Phase 2 — Rewire Onboarding**: Redesign onboarding for pseudo's flat format (not just swap data source). Handle progress data migration.
3. **Phase 3 — Remove Kodex**: Delete all Kodex code only after Phase 2 is fully verified. Clean up orphaned settings/permissions.

---

## Phase 0: Relocate Shared Infra

### Why

`kodexStore.ts` and `ProjectSelector.tsx` are generic project-selection infrastructure that happens to live under kodex directories. Three non-kodex systems depend on them (PseudoPage, OnboardingLayout, App.tsx). Deleting kodex dirs in Phase 3 would break these systems. Relocating first makes all later phases safe.

### Tasks

- [ ] Rename `ui/src/stores/kodexStore.ts` → `ui/src/stores/projectStore.ts`
  - Rename the hook: `useKodexStore` → `useProjectStore`
  - Update all imports (PseudoPage.tsx, OnboardingLayout.tsx, App.tsx, and any kodex pages)
  - Update test file: `kodexStore.test.ts` → `projectStore.test.ts`
  - Update `.pseudo` sidecar if present
- [ ] Move `ui/src/components/kodex/ProjectSelector.tsx` → `ui/src/components/shared/ProjectSelector.tsx`
  - Update all imports (PseudoPage, OnboardingLayout, kodex pages)
  - Move test file: `ProjectSelector.test.tsx` → `ui/src/components/shared/`
  - Move `.pseudo` sidecar if present
- [ ] Verify build passes with no references to old paths
- [ ] Commit: `refactor: relocate shared kodexStore and ProjectSelector out of kodex dirs`

---

## Phase 1: Pseudo to SQLite

### Why

The current pseudo system walks the filesystem on every API call (list, search, references). This is O(n) file reads per request and doesn't scale. A SQLite DB with FTS5 gives instant search, structured queries, and a single source of truth.

### Step 1a: Fix Parser Bug (BEFORE building ingest)

The existing parser regex in `parsePseudo.ts` line 89 expects `EXPORT [YYYY-MM-DD]` but **85 FUNCTION lines across 25 .pseudo files** use the opposite order `[YYYY-MM-DD] EXPORT`. For these lines, the parser captures neither the date nor the EXPORT flag.

**Fix**: Update the regex to handle both orderings:
```
/^FUNCTION\s+(\w[\w.]*)\s*(\([^)]*\))?\s*(?:->\s*(.+?))?\s*(?:(EXPORT)\s*)?(?:\[(\d{4}-\d{2}-\d{2})\])?\s*(EXPORT)?$/
```
Check either EXPORT capture group. Apply fix to both the UI parser (`ui/src/pages/pseudo/parsePseudo.ts`) and the new server-side parser.

- [ ] Fix regex in `ui/src/pages/pseudo/parsePseudo.ts` to handle both `EXPORT [date]` and `[date] EXPORT`
- [ ] Write test cases covering both orderings
- [ ] Verify the 85 affected functions now parse correctly

### New SQLite Schema

**Location**: `{project}/.collab/pseudo/pseudo.db`

Three core tables plus a join table for call relationships:

```sql
-- Core: one row per source file that has pseudocode
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,        -- relative path from project root
  title TEXT NOT NULL,                   -- first comment line (short title)
  purpose TEXT NOT NULL DEFAULT '',      -- second comment line (purpose description)
  module_context TEXT NOT NULL DEFAULT '',-- prose before first FUNCTION block
  synced_at TEXT,                        -- ISO timestamp from "// synced:" header
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per FUNCTION block
CREATE TABLE IF NOT EXISTS methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- function name (supports dotted: Class.method)
  params TEXT NOT NULL DEFAULT '',       -- parameter list as string
  return_type TEXT NOT NULL DEFAULT '',  -- return type as string
  is_exported INTEGER NOT NULL DEFAULT 0, -- 1 if EXPORT marker present
  date TEXT,                             -- [YYYY-MM-DD] date from FUNCTION line
  sort_order INTEGER NOT NULL DEFAULT 0, -- preserve file ordering
  UNIQUE(file_id, name)
);

-- One row per step/line within a FUNCTION block body
-- Flat structure with cosmetic depth (not recursive nesting)
CREATE TABLE IF NOT EXISTS method_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method_id INTEGER NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
  content TEXT NOT NULL,                 -- plain English step description
  depth INTEGER NOT NULL DEFAULT 0,     -- indent level (0 = top-level, 1 = nested, etc.)
  sort_order INTEGER NOT NULL DEFAULT 0, -- preserve line ordering within method
  UNIQUE(method_id, sort_order)
);

-- Join table: cross-file call relationships
CREATE TABLE IF NOT EXISTS method_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_method_id INTEGER NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
  callee_name TEXT NOT NULL,             -- function/class name being called
  callee_file_stem TEXT NOT NULL         -- .pseudo file stem (e.g., "http-transport")
);

-- FTS5 index on method_steps.content and methods.name
CREATE VIRTUAL TABLE IF NOT EXISTS pseudo_fts USING fts5(
  method_name, step_content,
  content='',  -- contentless (we manage inserts manually)
  tokenize='porter unicode61'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path);
CREATE INDEX IF NOT EXISTS idx_methods_file ON methods(file_id);
CREATE INDEX IF NOT EXISTS idx_methods_name ON methods(name);
CREATE INDEX IF NOT EXISTS idx_method_steps_method ON method_steps(method_id);
CREATE INDEX IF NOT EXISTS idx_method_calls_callee ON method_calls(callee_name, callee_file_stem);
CREATE INDEX IF NOT EXISTS idx_method_calls_caller ON method_calls(caller_method_id);
```

### New Service: `src/services/pseudo-db.ts`

```
class PseudoDbService {
  // Singleton per project (avoid per-request connection overhead)
  static getInstance(project: string): PseudoDbService

  constructor(project: string)  // opens/creates {project}/.collab/pseudo/pseudo.db

  // Ingest
  upsertFile(filePath: string, parsed: ParsedPseudoFile): void
  deleteFile(filePath: string): void
  bulkIngest(files: Array<{path: string, content: string}>): void  // uses BEGIN IMMEDIATE

  // Query (replaces filesystem walking)
  listFiles(): Array<{filePath: string, title: string, methodCount: number}>
  getFile(filePath: string): PseudoFileWithMethods | null
  search(query: string): SearchResult[]  // FTS5 ranked with BM25, snippet extraction
  getReferences(methodName: string, fileStem: string): Array<{file: string, callerMethod: string}>

  // Graph (new capability — enables onboarding + P0 features)
  getCallGraph(): {nodes: GraphNode[], edges: GraphEdge[]}
  getExports(): Array<{filePath: string, methodName: string, purpose: string}>
  getFilesByDirectory(dir: string): PseudoFileSummary[]
  getImpactAnalysis(methodName: string, fileStem: string): {direct: AffectedItem[], transitive: AffectedItem[]}

  // Orphan & Staleness Detection
  getOrphanFunctions(): Array<{filePath: string, methodName: string}>
  getStaleFunctions(daysThreshold: number): Array<{filePath: string, methodName: string, lastUpdated: string}>

  // Coverage
  getCoverage(directory?: string): {coveredFiles: number, totalFiles: number, percent: number, missingFiles: string[]}

  // Sync
  getLastSyncTime(): string | null
  setLastSyncTime(timestamp: string): void

  close(): void
}
```

### Parser: `src/services/pseudo-parser.ts`

Server-side parser extracted from `ui/src/pages/pseudo/parsePseudo.ts` with the fixed regex:

```typescript
interface ParsedPseudoFile {
  title: string;
  purpose: string;
  syncedAt: string | null;
  moduleContext: string;
  methods: ParsedMethod[];
}

interface ParsedMethod {
  name: string;
  params: string;
  returnType: string;
  isExport: boolean;
  steps: ParsedStep[];  // individual lines with depth
  date: string | null;
  calls: Array<{name: string, fileStem: string}>;
  sortOrder: number;
}

interface ParsedStep {
  content: string;
  depth: number;       // indent level (flat with cosmetic depth)
  sortOrder: number;
}
```

### Migration Strategy for `.pseudo` Files

The `.pseudo` files remain on disk as the authoring format (Claude writes them). The DB is a **read cache** that gets rebuilt from files:

1. **On server start**: Background scan for all `.pseudo` files with last-modified check (only re-ingest changed files)
2. **On `/pseudocode` skill run**: After writing/updating `.pseudo` files, call `pseudoDb.upsertFile()` to update the DB
3. **On sync**: After processing changed files, update the DB entries
4. **Full rebuild**: `pseudoDb.bulkIngest()` — drop and re-parse all files (fallback). Uses `BEGIN IMMEDIATE` to avoid long locks.

### API Changes to `src/routes/pseudo-api.ts`

Existing endpoints keep the same request/response contracts:

| Endpoint | Before | After |
|----------|--------|-------|
| `GET /files` | `walkDir()` recursion | `pseudoDb.listFiles()` |
| `GET /file` | `readFile()` + basename fallback | `pseudoDb.getFile()` — structured data + raw content |
| `GET /search` | `walkDir()` + line-by-line match | `pseudoDb.search()` — FTS5 with BM25 ranking |
| `GET /references` | `walkDir()` + `CALLS:` pattern | `pseudoDb.getReferences()` — indexed lookup |

**New endpoints** (for onboarding + P0/P1 features):

| Endpoint | Purpose |
|----------|---------|
| `GET /graph` | Call graph: nodes (files/methods) + edges (CALLS relationships) |
| `GET /exports` | All exported methods with purpose summaries (Export Surface Map) |
| `GET /directories` | File tree with pseudo coverage stats |
| `GET /stats` | Dashboard: total files, methods, exports, coverage % |
| `GET /impact?method=X&file=Y` | Impact analysis: direct + transitive affected methods |
| `GET /diagram?directory=X` | Auto-generated Mermaid flowchart from call graph |
| `GET /orphans` | Functions never called by anything — dead code candidates |
| `GET /stale?days=30` | Functions whose pseudo hasn't been updated relative to source |
| `GET /coverage?directory=X` | Coverage % per directory with missing file list |

### P0 Features (include in initial build)

These four features come naturally from the SQLite schema and should ship with Phase 1:

1. **FTS5 Ranked Search** — BM25 ranking, Porter stemming, snippet extraction with highlights. Replaces the broken linear `String.includes()` search. Comes free with the schema.

2. **Call Graph Visualization** — Auto-generate Mermaid diagrams from the `method_calls` join table. Reuse existing `TopicGraph.tsx` component from onboarding. Click any method to see callers/callees.

3. **Impact Analysis Query** — Recursive CTE walks the call chain to answer "what breaks if I change this?". Exposed via `GET /impact` endpoint and `pseudo_impact_analysis` MCP tool.

4. **Export Surface Map** — Single query shows every exported method across the codebase with its purpose. Essential for onboarding ("here's what this module exposes").

### P1 Features (include in Phase 1)

These are high-value additions that come naturally from the schema:

1. **Orphan Detection** — Anti-join query finds non-exported functions never called by anything. Dead code candidates surfaced in a "Code Health" view.

2. **Staleness Detection** — Compare function dates against source file changes. Flag functions whose pseudo is >30 days behind source.

3. **Coverage Dashboard** — Compare pseudo DB files against actual source files. Bar chart showing coverage % per directory.

### MCP Tools for Claude (Phase 1)

Six new MCP tools that make Claude significantly smarter about the codebase:

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| `pseudo_impact_analysis` | `{function_name, file_stem}` | `{direct: [...], transitive: [...], total_files: N}` | Understand blast radius before making changes |
| `pseudo_find_function` | `{query: "handles authentication"}` | `[{file, function, purpose, is_export}]` | FTS5 search to find relevant code without reading files |
| `pseudo_get_module_summary` | `{directory: "src/services"}` | `{files: [...], total_functions, exports, dependencies}` | Understand module architecture without reading every file |
| `pseudo_call_chain` | `{from_function, from_file, to_function, to_file}` | `{path: [{function, file}], exists: boolean}` | Check if two functions are connected through call graph |
| `pseudo_stale_check` | `{file_path}` | `{stale_functions: [{name, last_updated, source_modified}]}` | Proactively identify stale pseudo when working on a file |
| `pseudo_coverage_report` | `{directory?: string}` | `{covered_files, uncovered_files, coverage_percent, missing}` | Identify documentation gaps and offer to fill them |

These tools are registered in `src/mcp/setup.ts` and use `PseudoDbService` for instant query results.

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/pseudo-db.ts` | SQLite service (schema, ingest, query, singleton cache) |
| `src/services/pseudo-parser.ts` | Server-side `.pseudo` format parser (fixed regex) |

### Files to Modify

| File | Change |
|------|--------|
| `ui/src/pages/pseudo/parsePseudo.ts` | Fix EXPORT/date ordering regex bug |
| `src/routes/pseudo-api.ts` | Replace filesystem walks with PseudoDbService calls; add new endpoints |
| `src/server.ts` | Initialize PseudoDbService on startup; trigger background initial ingest |
| `src/mcp/setup.ts` | Add 6 new `pseudo_*` MCP tool definitions and handlers |

### Tasks

- [ ] Fix parser regex for both `EXPORT [date]` and `[date] EXPORT` orderings
- [ ] Create `src/services/pseudo-parser.ts` (server-side parser with fixed regex)
- [ ] Create `src/services/pseudo-db.ts` (schema with files/methods/method_steps/method_calls tables, singleton pattern)
- [ ] Implement FTS5 index on method_steps.content and methods.name
- [ ] Implement impact analysis via recursive CTE
- [ ] Implement export surface map query
- [ ] Implement orphan detection (anti-join on method_calls)
- [ ] Implement staleness detection (date comparison)
- [ ] Implement coverage queries (pseudo files vs source files)
- [ ] Update `src/routes/pseudo-api.ts` — swap to DB, add /graph, /exports, /impact, /diagram, /orphans, /stale, /coverage endpoints
- [ ] Update `src/server.ts` — init pseudo DB, background scan with last-modified check
- [ ] Use `BEGIN IMMEDIATE` for bulk operations to avoid write contention
- [ ] Add call graph Mermaid diagram generation endpoint
- [ ] Add 6 MCP tools to `src/mcp/setup.ts`: pseudo_impact_analysis, pseudo_find_function, pseudo_get_module_summary, pseudo_call_chain, pseudo_stale_check, pseudo_coverage_report
- [ ] Test: verify all existing pseudo UI works, verify new endpoints return data, verify MCP tools respond correctly
- [ ] Commit: `feat: add SQLite backend for pseudo system with FTS5 search, call graph, and MCP tools`

---

## Phase 2: Rewire Onboarding to Pseudo

### Why This Is a Redesign, Not a Swap

Onboarding's `TopicDetail.tsx` renders 5 tabs (Overview, Technical, Files, Related, Diagrams), each with distinct markdown from Kodex. Pseudo files have ONE content model: header + module prose + FUNCTION blocks. There is no natural mapping to 5 tabs. The UI needs a complete redesign around pseudo's strengths, not a data source swap.

### New Onboarding Content Model

Replace the 5-tab Kodex model with pseudo-native tabs:
- **Overview** — module_context prose + file title/purpose
- **Functions** — method list with steps (reuse `PseudoViewer.tsx`)
- **Dependencies** — call graph subview for this file (callers + callees)

### Progress Data Migration

The `progress` and `notes` tables in `progress.db` use `topic_name TEXT` (e.g., "authentication"). After rewiring, the key becomes `file_path` (e.g., "src/services/auth.ts"). No automated mapping exists from Kodex topic names to file paths since topics are conceptual groupings.

**Decision**: Accept data loss for progress.db (per-project, low volume). Document in release notes.

### Category Derivation Rewrite

Kodex derives categories from topic name prefixes (e.g., `auth-*` -> "auth"). The `deriveCategories()` function in `onboarding-manager.ts` is tightly coupled to this approach. It needs a full rewrite to use directory-based grouping: `src/services/` -> "services", `src/routes/` -> "routes", etc.

### Confidence Levels

Kodex has `confidence` (low/medium/high). Pseudo has no equivalent. Derive a "completeness" metric from function coverage (% of source file functions with pseudo blocks) or staleness (recently synced = high, 30+ days = low).

### Onboarding-Specific Features

Features that enhance onboarding with the new pseudo data source:

1. **Directory-Based Guided Tour** — Natural grouping by directory (`src/services/`, `src/routes/`, `src/mcp/`). Each directory becomes a chapter with file summaries.

2. **"What Does This Module Do?" Summary** — Click a directory, see aggregated title/purpose for all files, all exports, all inter-file relationships. Instant architectural overview.

3. **Learning Path from Call Graph** — Auto-generate reading order by walking call graph from entry points (e.g., `server.ts`). Breadth-first = "understand the surface first, then dive deeper."

4. **Function-Level Progress Tracking** — Mark individual functions as "understood" vs topic-level tracking. More granular progress.

5. **Dependency-Aware Graph** — Real code-derived edges from `CALLS:` annotations instead of manually curated `related.md` links. Directed edges distinguishing "calls into" vs "called by."

### Changes to `src/services/onboarding-manager.ts`

Replace `getKodexManager()` dependency with `PseudoDbService`:

```typescript
class OnboardingManager {
  private pseudoDb: PseudoDbService;

  constructor(project: string) {
    this.pseudoDb = PseudoDbService.getInstance(project);
  }

  // getConfig() — read from pseudo-onboarding.json (rename from kodex-onboarding.json)
  //   topicCount → fileCount from pseudoDb
  //   categories → directories from pseudoDb

  // getCategories() → getDirectories()  // FULL REWRITE, not just data swap
  //   Group by directory instead of name prefix

  // getGraph() → pseudoDb.getCallGraph()
  //   Aggregate function-level edges into file-level edges for comparable visualization

  // getDiagram() → REMOVE
}
```

### Changes to `src/services/onboarding-db.ts`

- Change `topic_name` references to `file_path` in all tables
- FTS index: rebuild over pseudo DB content instead of `.collab/kodex/topics/`
- `ensureIndex()` reads from pseudo DB instead of kodex filesystem
- Add health check: verify pseudo DB is populated before onboarding consumes it

### Changes to `src/routes/onboarding-api.ts`

- Remove `import { getKodexManager }`
- `/topics` → `/files` (list pseudo files)
- `/topics/:name` → `/files/:path` (get pseudo file content with new 3-tab model)
- `/topics/:name/diagram` → REMOVE
- `/categories` → `/directories` (directory-based grouping, full rewrite)
- `/graph` → call graph from pseudo DB (aggregate to file-level)
- Progress/notes/team endpoints: change `topic` param to `file` param

### Changes to UI

| File | Change |
|------|--------|
| `ui/src/pages/onboarding/BrowseDashboard.tsx` | Show file tree with coverage instead of topic cards |
| `ui/src/pages/onboarding/TopicDetail.tsx` | Redesign: 3 tabs (Overview, Functions, Dependencies) instead of 5 Kodex tabs. Reuse `PseudoViewer.tsx`. |
| `ui/src/pages/onboarding/TopicGraph.tsx` | Show call graph (aggregate function edges to file-level). Distinguish "calls into" vs "called by" with directed edges. |
| `ui/src/pages/onboarding/SearchResults.tsx` | Search pseudo content via FTS5 |
| `ui/src/pages/onboarding/DiagramsTab.tsx` | DELETE |
| `ui/src/pages/onboarding/OnboardingLayout.tsx` | Update nav labels |
| `ui/src/lib/onboarding-api.ts` | Update endpoint paths and types |

### Tasks

- [ ] Rewrite `deriveCategories()` for directory-based grouping
- [ ] Redesign TopicDetail from 5-tab Kodex model to 3-tab pseudo model
- [ ] Add health check: ensure pseudo DB is populated before onboarding consumes it
- [ ] Update `src/services/onboarding-manager.ts` — replace Kodex with PseudoDbService
- [ ] Update `src/services/onboarding-db.ts` — FTS from pseudo DB, rename topic→file
- [ ] Update `src/routes/onboarding-api.ts` — remove Kodex imports, update endpoints
- [ ] Update `ui/src/lib/onboarding-api.ts` — update API client
- [ ] Redesign onboarding UI pages for pseudo's flat content model
- [ ] Implement directory-based guided tour
- [ ] Implement learning path generation from call graph
- [ ] Implement function-level progress tracking
- [ ] Delete `ui/src/pages/onboarding/DiagramsTab.tsx`
- [ ] Rename `kodex-onboarding.json` → `pseudo-onboarding.json`
- [ ] Accept progress.db data loss (document in release notes)
- [ ] Test: verify onboarding browse/search/progress works end-to-end
- [ ] Commit: `refactor: redesign onboarding from kodex topics to pseudo files`

---

## Phase 3: Remove Kodex

### Precondition: Phase 2 must be fully verified before starting Phase 3.

Phase 2 rewires all onboarding imports away from kodex. If Phase 3 runs before Phase 2 is complete, the build breaks immediately with no graceful degradation.

### Files to Delete

**Backend services:**
- `src/services/kodex-manager.ts` + `.pseudo`

**API routes:**
- `src/routes/kodex-api.ts` + `.pseudo`
- `src/routes/__tests__/kodex-api.test.ts`

**UI pages:**
- `ui/src/pages/kodex/Dashboard.tsx` + `.pseudo`
- `ui/src/pages/kodex/Topics.tsx` + `.pseudo`
- `ui/src/pages/kodex/TopicDetail.tsx` + `.pseudo`
- `ui/src/pages/kodex/Drafts.tsx` + `.pseudo`
- `ui/src/pages/kodex/Flags.tsx` + `.pseudo`
- `ui/src/pages/kodex/Graph.tsx` + `.pseudo`
- `ui/src/pages/kodex/KodexLayout.tsx` + `.pseudo` + `.test.tsx`

**UI components (remaining after Phase 0 relocation):**
- `ui/src/components/kodex/KodexSidebar.tsx` + `.pseudo`
- `ui/src/components/kodex/AliasChip.tsx` + `.pseudo`
- `ui/src/components/kodex/AliasEditor.tsx` + `.pseudo`

**UI lib/stores (remaining after Phase 0 relocation):**
- `ui/src/lib/kodex-api.ts` + `.pseudo`

**Skills (10 skill directories):**
- `skills/kodex-init/`, `skills/kodex-fix/`, `skills/kodex-fix-incomplete/`
- `skills/kodex-fix-incorrect/`, `skills/kodex-fix-missing/`, `skills/kodex-fix-outdated/`
- `skills/kodex-bootstrap-missing/`, `skills/kodex-generate-aliases/`
- `skills/kodex-sync-session/`, `skills/using-kodex/`

### Files to Modify

| File | Change |
|------|--------|
| `src/server.ts` | Remove `import { handleKodexAPI }` and the `/api/kodex` route |
| `src/mcp/setup.ts` | Remove all 15 `kodex_*` tool definitions and handler cases (~380 lines) |
| `ui/src/main.tsx` | Remove Kodex route imports and `<Route path="/kodex">` block |
| `ui/src/components/layout/NavMenu.tsx` | Remove kodex nav item (line 22) |
| `src/services/collab-manager.ts` | Remove kodex exclusion logic (lines 121, 156) — harmless dead code but clean up |

### Cleanup

- [ ] Remove `.collab/kodex/` directory guidance from any docs
- [ ] Clean orphaned kodex entries from `.claude/settings.json` and `.claude/settings.local.json` allowedTools
- [ ] Search for cross-skill references to `using-kodex` in other skill definitions before deletion
- [ ] Update `CLAUDE.md` if it references kodex
- [ ] Update `README.md` kodex references (directory structure, MCP tools table, skills list)
- [ ] Remove `kodex-onboarding.json` (or already renamed in Phase 2)

### Tasks

- [ ] Verify Phase 2 is complete and all onboarding tests pass
- [ ] Delete all kodex backend files (service, API route, tests)
- [ ] Delete all kodex UI files (pages, remaining components, lib)
- [ ] Delete all 10 kodex skill directories
- [ ] Update `src/server.ts` — remove kodex route
- [ ] Update `src/mcp/setup.ts` — remove kodex tool definitions and handlers
- [ ] Update `ui/src/main.tsx` — remove kodex routes
- [ ] Remove NavMenu kodex entry, collab-manager exclusion logic
- [ ] Clean orphaned settings/permissions
- [ ] Test: verify nothing imports from deleted modules, build passes
- [ ] Commit: `refactor: remove kodex system`

---

## Risk Assessment

| Risk | Phase | Mitigation |
|------|-------|------------|
| kodexStore/ProjectSelector deletion breaks Pseudo + Onboarding | 0 | Relocate BEFORE any other work |
| Parser misses 85 EXPORT flags + dates | 1 | Fix regex to handle both orderings before building ingest |
| Parser divergence (UI vs server) | 1 | Extract shared parser; keep one source of truth |
| DB not initialized on first request | 1 | Singleton pattern (like getKodexManager); background scan on startup |
| Concurrent write contention from parallel Claude sessions | 1 | `BEGIN IMMEDIATE` for bulk ops; singleton with write queue |
| Server startup delay from scanning 200+ .pseudo files | 1 | Background scan; serve from stale DB; last-modified check |
| FTS5 content table out of sync | 1 | Use contentless FTS with manual insert; rebuild FTS after batch ops |
| Onboarding 5-tab model has no pseudo equivalent | 2 | Full UI redesign to 3-tab model (Overview, Functions, Dependencies) |
| Progress.db data orphaned (topic_name → file_path) | 2 | Accept data loss (low volume); document in release notes |
| Category derivation tightly coupled to name-prefix approach | 2 | Full rewrite to directory-based grouping |
| Empty pseudo DB when onboarding tries to consume it | 2 | Health check ensuring pseudo DB is populated first |
| Phase 3 runs before Phase 2 is done | 3 | Strict ordering; verify all onboarding tests pass first |
| Cross-skill references to using-kodex | 3 | Search for references before deletion |
| Orphaned settings in .claude/settings.json | 3 | Clean up allowedTools entries |

## Feature Priority Summary

| Priority | Features | Phase |
|----------|----------|-------|
| P0 | FTS5 ranked search, call graph visualization, impact analysis, export surface map | 1 |
| P1 | Orphan detection, staleness detection, coverage dashboard, 6 MCP tools for Claude | 1 |
| P1 | Directory-based onboarding, learning paths from call graph, dependency-aware graph | 2 |
| P2 | Rich file tree with metadata badges, function permalinks, session-aware pseudo updates | 2 |
| P2 | Module coupling heatmap, auto Mermaid from call graph, function-level progress | 2 |
| P3 | Search facets, find similar functions, diff view (pseudo vs code), cross-project search | Future |

## Estimated Scope

| Phase | New files | Modified files | Deleted files | Effort |
|-------|-----------|---------------|---------------|--------|
| Phase 0 | 0 | ~6 (renames + import updates) | 0 | Low |
| Phase 1 | 2 | 4 | 0 | High (includes P0/P1 features + MCP tools) |
| Phase 2 | 0 | ~10 | 1 | Medium-High (UI redesign) |
| Phase 3 | 0 | 5 | ~40 | Low (mostly deletion) |