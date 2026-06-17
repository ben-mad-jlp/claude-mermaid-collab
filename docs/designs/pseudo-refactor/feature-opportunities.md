# Feature Opportunities: Pseudo SQLite Refactor

Features that become possible, natural, or trivially implementable with the new SQLite-backed pseudo architecture.

---

## 1. Queries That Become Trivial

### 1.1 Cross-File Call Graph (currently impossible at scale)
**Before**: Finding all callers of a function requires `walkDir()` across every `.pseudo` file, line-by-line regex matching. O(n) file reads per request.
**After**: Single indexed JOIN query:
```sql
SELECT f.file_path, fn.name AS caller
FROM pseudo_calls c
JOIN pseudo_functions fn ON fn.id = c.caller_function_id
JOIN pseudo_files f ON f.id = fn.file_id
WHERE c.callee_name = ? AND c.callee_file_stem = ?
```
**Feature**: Full interactive call graph visualization using React Flow (reuse the existing `TopicGraph.tsx` from onboarding). Click any function, see who calls it and what it calls, fan-out/fan-in counts.

### 1.2 Reverse Dependency Graph ("What breaks if I change this?")
**Before**: Not possible without scanning every file.
**After**: Recursive CTE walks the call chain:
```sql
WITH RECURSIVE affected AS (
  SELECT caller_function_id FROM pseudo_calls
  WHERE callee_name = ? AND callee_file_stem = ?
  UNION
  SELECT c.caller_function_id FROM pseudo_calls c
  JOIN affected a ON c.callee_name = (SELECT name FROM pseudo_functions WHERE id = a.caller_function_id)
)
SELECT DISTINCT f.file_path, fn.name FROM affected a
JOIN pseudo_functions fn ON fn.id = a.caller_function_id
JOIN pseudo_files f ON f.id = fn.file_id
```
**Feature**: "Impact analysis" panel — select a function, see the full transitive dependency tree of everything that would be affected by a change.

### 1.3 Orphan Detection
**Before**: Would require loading every file into memory.
**After**: Simple anti-join:
```sql
SELECT f.file_path, fn.name FROM pseudo_functions fn
JOIN pseudo_files f ON f.id = fn.file_id
LEFT JOIN pseudo_calls c ON c.callee_name = fn.name
WHERE fn.is_export = 0 AND c.id IS NULL
```
**Feature**: Find functions that are never called by anything — dead code candidates. Surface in a "Code Health" dashboard.

### 1.4 Export Surface Map
**Before**: Grep through every `.pseudo` file for `EXPORT` markers.
**After**: `SELECT file_path, name, body FROM pseudo_functions WHERE is_export = 1`
**Feature**: "Public API" view — shows every exported function across the codebase with its purpose description. Useful for onboarding ("here's what this module exposes").

### 1.5 Function Staleness Detection
**Before**: Can parse `[YYYY-MM-DD]` dates from files, but comparing against git commit dates requires per-file shell commands.
**After**: Compare `pseudo_functions.date` against `pseudo_files.updated_at` or git log data stored alongside:
```sql
SELECT f.file_path, fn.name, fn.date
FROM pseudo_functions fn
JOIN pseudo_files f ON f.id = fn.file_id
WHERE fn.date < date(f.updated_at, '-30 days')
```
**Feature**: "Stale pseudocode" alerts — highlight functions whose pseudo hasn't been updated in N days relative to their source file's last change.

---

## 2. FTS5-Powered Search Improvements

### 2.1 Ranked, Highlighted Search Results
**Before**: Simple `String.includes()` with no ranking. Results are ordered by filesystem walk order.
**After**: FTS5 provides BM25 ranking, snippet extraction with `<mark>` highlights, and Porter stemming ("handlers" matches "handle", "configuring" matches "config").
**Feature**: Search that actually surfaces the most relevant results first, with highlighted snippets showing context.

### 2.2 Search Facets by File, Directory, Export Status
**After**: Combine FTS5 with regular columns:
```sql
SELECT * FROM pseudo_fts WHERE pseudo_fts MATCH ?
  AND file_path LIKE 'src/services/%'
  AND function_name IN (SELECT name FROM pseudo_functions WHERE is_export = 1)
```
**Feature**: Scoped search — "search only in services", "search only exported functions", "search only in routes/". Add filter chips to the search overlay.

### 2.3 "Find Similar Functions"
**After**: Use FTS5 ranking to find functions with similar body descriptions.
**Feature**: Select a function, click "find similar" — surfaces functions with overlapping logic descriptions (potential duplication candidates).

---

## 3. Statistics & Coverage Dashboards

### 3.1 Pseudo Coverage Dashboard
**After**: Compare pseudo DB files against actual source files:
```sql
-- Files with pseudo coverage
SELECT COUNT(*) FROM pseudo_files;
-- Total qualifying source files (from a filesystem scan at ingest time, cached in a stats table)
```
**Feature**: Coverage percentage per directory. Bar chart showing which areas of the codebase are documented vs not. Trend line over time if we store historical snapshots.

### 3.2 Codebase Complexity Metrics
**After**: Aggregate queries:
```sql
SELECT f.file_path,
  COUNT(fn.id) AS function_count,
  SUM(CASE WHEN fn.is_export THEN 1 ELSE 0 END) AS export_count,
  (SELECT COUNT(*) FROM pseudo_calls c WHERE c.caller_function_id = fn.id) AS outgoing_calls
FROM pseudo_files f
JOIN pseudo_functions fn ON fn.file_id = f.id
GROUP BY f.file_path
ORDER BY function_count DESC
```
**Feature**: "Complexity hotspots" view — files with the most functions, most outgoing calls, highest fan-in. Helps prioritize refactoring targets.

### 3.3 Module Coupling Analysis
**After**: Count cross-file edges per directory pair:
```sql
SELECT
  substr(caller_file.file_path, 1, instr(caller_file.file_path, '/')) AS caller_dir,
  c.callee_file_stem AS callee_module,
  COUNT(*) AS coupling_count
FROM pseudo_calls c
JOIN pseudo_functions fn ON fn.id = c.caller_function_id
JOIN pseudo_files caller_file ON caller_file.id = fn.file_id
GROUP BY caller_dir, callee_module
ORDER BY coupling_count DESC
```
**Feature**: Module coupling heatmap — which directories depend on which. Surfaces tight coupling that might indicate architectural issues.

---

## 4. Onboarding Features (Rewired from Kodex)

### 4.1 Directory-Based Guided Tour
**Before**: Kodex categories derived from topic name prefixes (fragile, manual).
**After**: Natural grouping by directory: `src/services/`, `src/routes/`, `src/mcp/`, `ui/src/pages/`.
**Feature**: "Start here" guided tour organized by architectural layers. Each directory becomes a chapter. Within each chapter, files are shown with their title/purpose from pseudo headers.

### 4.2 "What Does This Module Do?" One-Click Summary
**After**: `SELECT title, purpose FROM pseudo_files WHERE file_path LIKE 'src/services/%'`
**Feature**: Click on a directory in the tree, see an aggregated summary: all file titles/purposes, all exported functions, all inter-file relationships. Instant architectural overview for any directory.

### 4.3 Function-Level Progress Tracking
**Before**: Onboarding tracks progress per-topic (coarse-grained).
**After**: Can track per-file or even per-function:
```sql
-- progress.db
ALTER TABLE progress ADD COLUMN function_name TEXT;
```
**Feature**: Mark individual functions as "understood" or "need to review". More granular progress than topic-level tracking. The jump panel could show green dots for understood functions.

### 4.4 Learning Path from Call Graph
**Before**: Learning paths were manually configured in `kodex-onboarding.json`.
**After**: Auto-generate learning paths by walking the call graph from entry points:
```sql
-- Start from main entry points (e.g., server.ts exports)
-- Walk outward through CALLS edges
-- Order: breadth-first = "understand the surface first, then dive deeper"
```
**Feature**: "Follow the code path" — pick an entry point (e.g., `handlePseudoAPI`), and the system generates a reading order by following CALLS references. Each step is a function with its pseudo description.

### 4.5 Dependency-Aware Topic Graph
**Before**: Graph edges from manually written `related.md` links (often stale or incomplete).
**After**: Graph edges from actual `CALLS:` annotations — real, code-derived dependencies.
**Feature**: Much richer and more accurate relationship graph. Can distinguish between "calls into" vs "called by" with directed edges. Color by directory. Filter by depth.

---

## 5. MCP Tool Opportunities for Claude

### 5.1 `pseudo_impact_analysis` Tool
```
Input: { function_name, file_stem }
Output: { directly_affected: [...], transitively_affected: [...], total_files: N }
```
Claude can use this before making changes to understand blast radius.

### 5.2 `pseudo_find_function` Tool
```
Input: { query: "handles authentication" }
Output: [{ file, function, purpose, is_export }]
```
FTS5 search for Claude to find relevant code without reading files. Much faster than grepping the codebase.

### 5.3 `pseudo_get_module_summary` Tool
```
Input: { directory: "src/services" }
Output: { files: [...], total_functions: N, exports: [...], internal_dependencies: [...] }
```
Claude can understand a module's architecture without reading every file.

### 5.4 `pseudo_call_chain` Tool
```
Input: { from_function, from_file, to_function, to_file }
Output: { path: [{ function, file }], exists: boolean }
```
"Is there a path from function A to function B through the call graph?" Useful for understanding if two pieces of code are connected.

### 5.5 `pseudo_stale_check` Tool
```
Input: { file_path }
Output: { stale_functions: [{ name, last_updated, source_last_modified }] }
```
Claude can proactively identify and update stale pseudo when working on a file.

### 5.6 `pseudo_coverage_report` Tool
```
Input: { directory?: string }
Output: { covered_files, uncovered_files, coverage_percent, missing_files: [...] }
```
Claude can identify documentation gaps and offer to fill them.

---

## 6. Integration with Existing Collab Tools

### 6.1 Auto-Generate Mermaid Diagrams from Call Graph
**After**: The call graph is structured data in SQLite.
**Feature**: `GET /api/pseudo/diagram?directory=src/services` returns a Mermaid flowchart of the call relationships. Use existing `diagram_from_code` patterns but driven by pseudo data instead of parsing source.

### 6.2 Session-Aware Pseudo Updates
**Feature**: When a collab session modifies code files, automatically flag which pseudo files need updating. Show a notification: "3 pseudo files are stale after this session's changes." The existing `.pseudo-needs-update` mechanism becomes a DB query.

### 6.3 Design-to-Pseudo Linking
**Feature**: When viewing a design artifact, show which pseudo functions implement the components in the design. Uses the same file path matching that already exists in the collab system.

### 6.4 Spreadsheet Export of Codebase Metrics
**Feature**: Use existing `create_spreadsheet` MCP tool to export pseudo analytics:
- Function inventory (name, file, export status, last updated, call count)
- Coverage report per directory
- Dependency matrix

---

## 7. Developer Experience Improvements

### 7.1 Instant File Tree with Metadata
**Before**: File tree shows bare file names.
**After**: File tree can show function count, export count, staleness indicators per file — all from a single indexed query.
**Feature**: Rich file tree with inline badges: `server.ts (12 fn, 4 exported, 2 stale)`.

### 7.2 Diff View: Pseudo vs Code
**Feature**: Side-by-side view showing pseudo description alongside the actual code. Highlight where they diverge. Requires reading the source file on demand but the pseudo side is instant from DB.

### 7.3 Batch Staleness Resolution
**Feature**: Dashboard showing all stale pseudo files sorted by staleness. "Update all" button that triggers the pseudo skill for each. Progress bar. Currently this requires running `/pseudocode sync` manually and hoping the manifest is up to date.

### 7.4 Function Permalink & Deep Links
**After**: Functions have stable IDs in the database.
**Feature**: Share a link like `/pseudo/src/routes/pseudo-api.ts#handleSearch` that deep-links to a specific function. Currently the URL only goes to file level.

### 7.5 Cross-Project Pseudo (Multi-Repo)
**After**: Each project has its own `pseudo.db`. The server already supports multiple registered projects.
**Feature**: Cross-project search — "find all functions across all projects that handle authentication". Useful in monorepo or multi-service architectures.

---

## 8. Kodex Features Worth Preserving in New Form

### 8.1 Confidence / Verification Status
**Kodex had**: confidence levels (low/medium/high) and verified flag per topic.
**Pseudo equivalent**: Add `confidence` and `verified` columns to `pseudo_files`. Auto-set confidence based on staleness (recently synced = high, 30+ days old = low). Allow manual verification.

### 8.2 Flag System (Lightweight)
**Kodex had**: 5 flag types with open/resolved/dismissed workflow.
**Pseudo equivalent**: Simpler flags table — just `stale` and `needs-review`. Auto-detect stale from date comparison. Manual `needs-review` for files Claude couldn't fully parse.

### 8.3 Access Logging
**Kodex had**: Track which topics are accessed, surface most/least viewed.
**Pseudo equivalent**: Log which pseudo files are viewed in the UI and queried via MCP tools. Surface "most referenced functions" and "never viewed files" for coverage prioritization.

### 8.4 Aliases / Search Synonyms
**Kodex had**: Alias system for alternative topic names.
**Pseudo equivalent**: Not needed — FTS5 with Porter stemming handles most synonym cases. Function names themselves are searchable. If needed, a simple `pseudo_aliases` table mapping alternative names to file paths.

---

## Priority Ranking

| Priority | Feature | Effort | Value |
|----------|---------|--------|-------|
| P0 | FTS5 ranked search (2.1) | Comes free with schema | High — replaces broken linear search |
| P0 | Call graph visualization (1.1) | Medium — reuse TopicGraph | High — killer feature for code navigation |
| P0 | Impact analysis query (1.2) | Low — just SQL | High — critical for safe refactoring |
| P0 | Export surface map (1.4) | Low — just a query | High — essential for onboarding |
| P1 | Coverage dashboard (3.1) | Medium | Medium — motivates pseudo adoption |
| P1 | Directory-based onboarding (4.1, 4.2) | Medium — adapt existing UI | High — replaces Kodex browsing |
| P1 | MCP tools (5.1-5.6) | Medium — 6 new tool defs | High — makes Claude much smarter |
| P1 | Orphan detection (1.3) | Low | Medium — code health |
| P1 | Staleness detection (1.5) | Low | Medium — keeps pseudo fresh |
| P2 | Module coupling analysis (3.3) | Medium | Medium — architectural insight |
| P2 | Learning path from call graph (4.4) | Medium | Medium — smart onboarding |
| P2 | Auto Mermaid from call graph (6.1) | Low | Medium — integration synergy |
| P2 | Rich file tree (7.1) | Low | Medium — better DX |
| P2 | Function-level progress (4.3) | Low | Low — niche use case |
| P3 | Search facets (2.2) | Medium | Low — nice to have |
| P3 | Find similar functions (2.3) | Medium | Low — speculative |
| P3 | Diff view (7.2) | High | Medium — complex UI |
| P3 | Cross-project search (7.5) | Medium | Low — edge case |

---

## Key Insight

The biggest unlock is that **structured data enables relational queries**. The current system treats pseudo files as opaque text blobs — every operation is a linear scan. With SQLite, the call graph becomes a first-class queryable data structure. This transforms pseudo from "documentation you read" into "an interactive map of your codebase" — which is exactly what both the pseudo viewer and onboarding system need.
