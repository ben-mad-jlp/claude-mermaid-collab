# Blueprint: Pseudo SQLite Refactor

## Source Artifacts
- design-plan

## 1. Structure Summary

### Files

**Phase 0 — Relocate Shared Infra**
- [ ] `ui/src/stores/projectStore.ts` — Renamed from `kodexStore.ts`, hook renamed `useKodexStore` → `useProjectStore`
- [ ] `ui/src/components/shared/ProjectSelector.tsx` — Moved from `ui/src/components/kodex/`

**Phase 1 — Pseudo to SQLite**
- [ ] `src/services/pseudo-parser.ts` — NEW: Server-side `.pseudo` parser with fixed regex
- [ ] `src/services/pseudo-db.ts` — NEW: SQLite service (schema, ingest, queries, singleton)
- [ ] `ui/src/pages/pseudo/parsePseudo.ts` — MODIFY: Fix EXPORT/date regex bug
- [ ] `src/routes/pseudo-api.ts` — MODIFY: Replace filesystem walks with DB queries, add new endpoints
- [ ] `src/server.ts` — MODIFY: Init PseudoDbService on startup, background scan
- [ ] `src/mcp/setup.ts` — MODIFY: Add 6 pseudo_* MCP tool definitions + handlers

**Phase 2 — Rewire Onboarding**
- [ ] `src/services/onboarding-manager.ts` — MODIFY: Replace `getKodexManager()` with `PseudoDbService`
- [ ] `src/services/onboarding-db.ts` — MODIFY: FTS from pseudo DB, rename topic→file
- [ ] `src/routes/onboarding-api.ts` — MODIFY: Remove kodex imports, update endpoints
- [ ] `ui/src/lib/onboarding-api.ts` — MODIFY: Update API client types/paths
- [ ] `ui/src/pages/onboarding/BrowseDashboard.tsx` — MODIFY: File tree with coverage
- [ ] `ui/src/pages/onboarding/TopicDetail.tsx` — MODIFY: 3-tab redesign
- [ ] `ui/src/pages/onboarding/TopicGraph.tsx` — MODIFY: Call graph from pseudo DB
- [ ] `ui/src/pages/onboarding/SearchResults.tsx` — MODIFY: FTS5 search
- [ ] `ui/src/pages/onboarding/OnboardingLayout.tsx` — MODIFY: Update nav labels
- [ ] `ui/src/pages/onboarding/DiagramsTab.tsx` — DELETE

**Phase 3 — Remove Kodex**
- [ ] `src/services/kodex-manager.ts` — DELETE
- [ ] `src/routes/kodex-api.ts` — DELETE
- [ ] `ui/src/pages/kodex/*` — DELETE (7 pages + tests)
- [ ] `ui/src/components/kodex/*` — DELETE (remaining after Phase 0)
- [ ] `ui/src/lib/kodex-api.ts` — DELETE
- [ ] `skills/kodex-*` — DELETE (10 skill directories)
- [ ] `src/server.ts` — MODIFY: Remove kodex route
- [ ] `src/mcp/setup.ts` — MODIFY: Remove ~380 lines of kodex tool defs
- [ ] `ui/src/main.tsx` — MODIFY: Remove kodex routes
- [ ] `ui/src/components/layout/NavMenu.tsx` — MODIFY: Remove kodex nav item

### Type Definitions

```typescript
// src/services/pseudo-parser.ts
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
  date: string | null;
  calls: Array<{name: string, fileStem: string}>;
  steps: ParsedStep[];
  sortOrder: number;
}

interface ParsedStep {
  content: string;
  depth: number;
  sortOrder: number;
}

// src/services/pseudo-db.ts
interface PseudoFileSummary {
  filePath: string;
  title: string;
  methodCount: number;
  exportCount: number;
  lastUpdated: string;
}

interface PseudoFileWithMethods {
  filePath: string;
  title: string;
  purpose: string;
  moduleContext: string;
  syncedAt: string | null;
  methods: Array<{
    name: string;
    params: string;
    returnType: string;
    isExported: boolean;
    date: string | null;
    steps: Array<{content: string, depth: number}>;
    calls: Array<{name: string, fileStem: string}>;
  }>;
}

interface SearchResult {
  filePath: string;
  methodName: string;
  snippet: string;
  rank: number;
}

interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'method';
  filePath: string;
  isExported: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

interface AffectedItem {
  filePath: string;
  methodName: string;
  depth: number;
}

interface CoverageReport {
  coveredFiles: number;
  totalFiles: number;
  percent: number;
  missingFiles: string[];
}
```

### Component Interactions

```
.pseudo files (on disk, authoring format)
    │
    ▼ parse on startup / on write
pseudo-parser.ts
    │
    ▼ upsert
pseudo-db.ts (SQLite singleton per project)
    │
    ├──▶ pseudo-api.ts (REST endpoints)
    │       │
    │       ├──▶ Pseudo UI (existing pages)
    │       └──▶ Onboarding UI (redesigned pages)
    │
    └──▶ setup.ts (6 MCP tools for Claude)
```

---

## 2. Function Blueprints

### `parsePseudo(content: string): ParsedPseudoFile`

**File:** `src/services/pseudo-parser.ts`

**Pseudocode:**
1. Split content by newlines
2. Extract title from first `//` comment line
3. Extract purpose from second `//` comment line
4. Extract `synced:` timestamp if present
5. Collect module prose (lines before first FUNCTION)
6. For each FUNCTION block:
   a. Parse header with regex supporting both `EXPORT [date]` and `[date] EXPORT`
   b. Collect body lines until `---` separator or next FUNCTION
   c. For each body line, determine depth from leading whitespace (2 spaces = 1 depth)
   d. Extract CALLS references from `CALLS: name(file-stem)` lines
   e. Build ParsedMethod with steps array
7. Return ParsedPseudoFile

**Error handling:** Return partial parse on malformed lines (log warning, skip line). Never throw.
**Edge cases:** Empty file, file with no FUNCTION blocks, FUNCTION with no body, nested CALLS.
**Test strategy:** Test both EXPORT orderings, empty files, files with only prose, deeply nested steps.

---

### `PseudoDbService` (class)

**File:** `src/services/pseudo-db.ts`

#### `static getInstance(project: string): PseudoDbService`

**Pseudocode:**
1. Check `managers` Map for existing instance keyed by project path
2. If found, return it
3. If not, create new PseudoDbService(project), store in map, return it

**Pattern:** Same as `getKodexManager()` — `Map<string, PseudoDbService>`.

---

#### `constructor(project: string)`

**Pseudocode:**
1. Set `this.project = project`
2. Ensure `.collab/pseudo/` directory exists
3. Open DB: `new Database(path.join(project, '.collab/pseudo/pseudo.db'))`
4. Enable WAL mode: `db.exec('PRAGMA journal_mode=WAL')`
5. Enable foreign keys: `db.exec('PRAGMA foreign_keys=ON')`
6. Run schema creation (all CREATE TABLE IF NOT EXISTS + indexes)

**Error handling:** If DB file is corrupted, delete and recreate.

---

#### `upsertFile(filePath: string, parsed: ParsedPseudoFile): void`

**Pseudocode:**
1. Begin transaction
2. Delete existing file row (cascade deletes methods, steps, calls)
3. Insert into files table (filePath, title, purpose, moduleContext, syncedAt)
4. Get inserted file ID
5. For each parsed method:
   a. Insert into methods (file_id, name, params, returnType, isExported, date, sortOrder)
   b. Get inserted method ID
   c. For each step: insert into method_steps (method_id, content, depth, sortOrder)
   d. For each call: insert into method_calls (caller_method_id, callee_name, callee_file_stem)
   e. Insert into pseudo_fts (method_name, step_content concatenated)
6. Commit transaction

**Error handling:** Rollback on any insert failure.
**Edge cases:** File with 0 methods (valid — just module prose).

---

#### `bulkIngest(files: Array<{path: string, content: string}>): void`

**Pseudocode:**
1. `BEGIN IMMEDIATE` (exclusive write lock)
2. Delete all rows from pseudo_fts
3. For each file: parse with `parsePseudo()`, call `upsertFile()` logic (inlined, no nested transactions)
4. Commit

**Error handling:** Rollback entire batch on failure.

---

#### `search(query: string): SearchResult[]`

**Pseudocode:**
1. Query pseudo_fts with BM25 ranking:
   ```sql
   SELECT rowid, method_name, snippet(pseudo_fts, 1, '<mark>', '</mark>', '...', 30) as snippet,
          rank FROM pseudo_fts WHERE pseudo_fts MATCH ? ORDER BY rank LIMIT 50
   ```
2. Join back to methods + files to get filePath
3. Return array of SearchResult

**Edge cases:** Empty query, special FTS characters (escape them).

---

#### `getImpactAnalysis(methodName: string, fileStem: string): {direct: AffectedItem[], transitive: AffectedItem[]}`

**Pseudocode:**
1. Find direct callers:
   ```sql
   SELECT f.file_path, m.name FROM method_calls mc
   JOIN methods m ON m.id = mc.caller_method_id
   JOIN files f ON f.id = m.file_id
   WHERE mc.callee_name = ? AND mc.callee_file_stem = ?
   ```
2. Find transitive callers via recursive CTE (max depth 10)
3. Separate results into direct (depth=1) and transitive (depth>1)
4. Return both arrays

**Edge cases:** Circular call chains (recursive CTE depth limit prevents infinite loops).

---

#### `getOrphanFunctions(): Array<{filePath: string, methodName: string}>`

**Pseudocode:**
1. Anti-join: methods not in method_calls as callee AND not exported
   ```sql
   SELECT f.file_path, m.name FROM methods m
   JOIN files f ON f.id = m.file_id
   LEFT JOIN method_calls mc ON mc.callee_name = m.name
   WHERE m.is_exported = 0 AND mc.id IS NULL
   ```
2. Return results

---

#### `getCoverage(directory?: string): CoverageReport`

**Pseudocode:**
1. Get all source files in directory (Glob for `*.ts`, `*.tsx`, etc.)
2. Get all file_paths from files table matching directory
3. Compute covered = intersection count, total = source count
4. Return { coveredFiles, totalFiles, percent, missingFiles }

---

### Updated `handlePseudoAPI(req: Request): Promise<Response>`

**File:** `src/routes/pseudo-api.ts`

**Pseudocode (additions):**
1. Get PseudoDbService singleton for project
2. Existing routes — swap implementation:
   - `/files` → `pseudoDb.listFiles()`
   - `/file` → `pseudoDb.getFile(filePath)`
   - `/search` → `pseudoDb.search(query)`
   - `/references` → `pseudoDb.getReferences(methodName, fileStem)`
3. New routes:
   - `GET /graph` → `pseudoDb.getCallGraph()`
   - `GET /exports` → `pseudoDb.getExports()`
   - `GET /impact` → `pseudoDb.getImpactAnalysis(method, file)`
   - `GET /orphans` → `pseudoDb.getOrphanFunctions()`
   - `GET /stale` → `pseudoDb.getStaleFunctions(days)`
   - `GET /coverage` → `pseudoDb.getCoverage(directory)`
   - `GET /stats` → aggregate stats query
   - `GET /diagram` → generate Mermaid from call graph subgraph
   - `GET /directories` → `pseudoDb.getFilesByDirectory(dir)`

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: relocate-shared-infra
    files:
      - ui/src/stores/projectStore.ts
      - ui/src/components/shared/ProjectSelector.tsx
    tests: []
    description: "Rename kodexStore→projectStore, move ProjectSelector to shared/, update all imports"
    parallel: true
    depends-on: []

  - id: fix-parser-regex
    files:
      - ui/src/pages/pseudo/parsePseudo.ts
    tests: []
    description: "Fix EXPORT/date ordering regex to handle both EXPORT [date] and [date] EXPORT"
    parallel: true
    depends-on: []

  - id: pseudo-parser-server
    files:
      - src/services/pseudo-parser.ts
    tests: []
    description: "Create server-side pseudo parser extracted from UI parser with fixed regex"
    parallel: false
    depends-on: [fix-parser-regex]

  - id: pseudo-db-service
    files:
      - src/services/pseudo-db.ts
    tests: []
    description: "Create PseudoDbService with SQLite schema (files, methods, method_steps, method_calls), FTS5, singleton pattern, ingest + query methods"
    parallel: false
    depends-on: [pseudo-parser-server]

  - id: pseudo-api-update
    files:
      - src/routes/pseudo-api.ts
    tests: []
    description: "Replace filesystem walks with PseudoDbService queries, add new endpoints (/graph, /exports, /impact, /orphans, /stale, /coverage, /stats, /diagram, /directories)"
    parallel: false
    depends-on: [pseudo-db-service]

  - id: pseudo-server-init
    files:
      - src/server.ts
    tests: []
    description: "Initialize PseudoDbService on startup, trigger background ingest scan"
    parallel: true
    depends-on: [pseudo-db-service]

  - id: pseudo-mcp-tools
    files:
      - src/mcp/setup.ts
    tests: []
    description: "Add 6 MCP tools: pseudo_impact_analysis, pseudo_find_function, pseudo_get_module_summary, pseudo_call_chain, pseudo_stale_check, pseudo_coverage_report"
    parallel: true
    depends-on: [pseudo-db-service]

  - id: onboarding-manager-rewire
    files:
      - src/services/onboarding-manager.ts
    tests: []
    description: "Replace getKodexManager() with PseudoDbService, rewrite deriveCategories() for directory-based grouping"
    parallel: false
    depends-on: [pseudo-api-update]

  - id: onboarding-db-rewire
    files:
      - src/services/onboarding-db.ts
    tests: []
    description: "FTS from pseudo DB, rename topic_name→file_path in all tables, add health check"
    parallel: true
    depends-on: [pseudo-api-update]

  - id: onboarding-api-rewire
    files:
      - src/routes/onboarding-api.ts
    tests: []
    description: "Remove kodex imports, update endpoints (topics→files, categories→directories)"
    parallel: false
    depends-on: [onboarding-manager-rewire, onboarding-db-rewire]

  - id: onboarding-ui-redesign
    files:
      - ui/src/pages/onboarding/BrowseDashboard.tsx
      - ui/src/pages/onboarding/TopicDetail.tsx
      - ui/src/pages/onboarding/TopicGraph.tsx
      - ui/src/pages/onboarding/SearchResults.tsx
      - ui/src/pages/onboarding/OnboardingLayout.tsx
      - ui/src/pages/onboarding/DiagramsTab.tsx
      - ui/src/lib/onboarding-api.ts
    tests: []
    description: "Redesign onboarding UI: 3-tab model (Overview, Functions, Dependencies), delete DiagramsTab, update API client"
    parallel: false
    depends-on: [onboarding-api-rewire]

  - id: remove-kodex
    files:
      - src/services/kodex-manager.ts
      - src/routes/kodex-api.ts
      - src/mcp/setup.ts
      - src/server.ts
      - ui/src/main.tsx
      - ui/src/components/layout/NavMenu.tsx
      - src/services/collab-manager.ts
    tests: []
    description: "Delete all kodex files (service, API, UI pages, components, lib, 10 skill dirs), remove kodex routes/MCP tools/nav, clean orphaned settings"
    parallel: false
    depends-on: [onboarding-ui-redesign]
```

### Execution Waves

**Wave 1 (parallel):**
- relocate-shared-infra
- fix-parser-regex

**Wave 2:**
- pseudo-parser-server

**Wave 3:**
- pseudo-db-service

**Wave 4 (parallel):**
- pseudo-api-update
- pseudo-server-init
- pseudo-mcp-tools

**Wave 5 (parallel):**
- onboarding-manager-rewire
- onboarding-db-rewire

**Wave 6:**
- onboarding-api-rewire

**Wave 7:**
- onboarding-ui-redesign

**Wave 8:**
- remove-kodex

### Summary
- Total tasks: 12
- Total waves: 8
- Max parallelism: 3 (Waves 1 and 4)