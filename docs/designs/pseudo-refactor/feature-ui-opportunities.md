# Pseudo UI Feature Opportunities — SQLite-Backed API

## Context

The backend now has a SQLite DB (`pseudo-db.ts`) with rich structured data: methods with steps, call graphs, impact analysis, exports, orphans, staleness, coverage. The old UI (`pseudo-api.ts`) still fetches raw strings and parses client-side via `parsePseudo.ts`. This document catalogs every new UI feature the structured API enables.

---

## Feature Matrix

### 1. File Tree Enhancements — Metadata Badges

**What:** Show method count, export count, and staleness indicators on each file node in `PseudoFileTree`. Currently the tree just shows file names.

**API endpoint:** `GET /api/pseudo/files` — already returns `PseudoFileSummary[]` with `methodCount`, `exportCount`, `lastUpdated`.

**UI change:** In `TreeNodeRenderer`, render small badges next to leaf nodes: `(5 methods, 2 exports)`. Color-code staleness based on `lastUpdated` relative to today.

**Effort:** Low  
**Priority:** P0 — comes free with the API migration, just render what's already returned.

---

### 2. Call Graph Visualization

**What:** Interactive graph view showing which functions call which, across files. Click a node to navigate to that function.

**API endpoint:** `GET /api/pseudo/graph` — returns `{ nodes: GraphNode[], edges: GraphEdge[] }`. Also `GET /api/pseudo/diagram` returns a pre-built Mermaid flowchart string (with optional `?directory=` filter).

**UI change:** New component (e.g., `CallGraphView.tsx`). Options:
- **Simple:** Render the Mermaid diagram from `/diagram` endpoint using the existing mermaid renderer
- **Rich:** Use a graph library (e.g., `reactflow`, `d3-force`) to render `nodes`/`edges` with click-to-navigate, zoom, pan

**Effort:** Medium (Mermaid route) / High (interactive graph)  
**Priority:** P1 — high value for understanding codebase structure, but not blocking the migration.

---

### 3. Impact Analysis Panel

**What:** "What breaks if I change this function?" — show direct and transitive callers of any method.

**API endpoint:** `GET /api/pseudo/impact?methodName=X&fileStem=Y` — returns `{ direct: AffectedItem[], transitive: AffectedItem[] }` with depth info.

**UI change:** Add an "Impact" button to `PseudoBlock` header (next to existing "refs" button). Opens a collapsible panel showing:
- **Direct callers** (depth 1) — listed with file + method name, click to navigate
- **Transitive callers** (depth 2+) — grouped by depth, visually nested

The existing "refs" button uses `/references` which only shows depth-1 callers. Impact analysis goes deeper with the recursive CTE.

**Effort:** Low — the endpoint exists, UI is a list similar to the existing refs panel.  
**Priority:** P1 — very useful for refactoring, and the hard work (recursive SQL) is done.

---

### 4. Search Improvements

**What:** The new search returns `{ filePath, methodName, snippet, rank }` with `<mark>` highlighted snippets from FTS5. The old search returned raw line matches that the UI had to group and flatten.

**API endpoint:** `GET /api/pseudo/search?q=X` — returns `{ matches: SearchResult[] }` with BM25 ranking and snippet highlighting.

**UI change:** Update `PseudoSearch.tsx`:
- Results are already flat and ranked — remove the flatten/group logic
- Render `snippet` with `<mark>` tags (use `dangerouslySetInnerHTML` or a sanitizer)
- Show `methodName` prominently — the old UI showed function names but had to guess from line context
- Better relevance ordering (BM25 from FTS5 vs. simple substring match)

**Effort:** Low — mostly simplifying existing code.  
**Priority:** P0 — comes with the migration, and the UX improves significantly.

---

### 5. Export Surface View

**What:** A dedicated view showing all exported functions across the entire codebase — the "public API surface" of the project.

**API endpoint:** `GET /api/pseudo/exports` — returns `Array<{ filePath, methodName, purpose }>`.

**UI change:** New tab or panel (e.g., in the sidebar or as a top-level view). Table/list with:
- File path (click to navigate)
- Method name (click to navigate to function)
- Purpose (first few steps concatenated)
- Sortable/filterable

**Effort:** Low — straightforward list rendering.  
**Priority:** P2 — nice to have for API documentation, but not critical for daily use.

---

### 6. Orphan Detection UI

**What:** Highlight dead code candidates — non-exported functions that no other function calls.

**API endpoint:** `GET /api/pseudo/orphans` — returns `Array<{ filePath, methodName }>`.

**UI change:** Options:
- **Badge approach:** In `PseudoBlock`, if a function is an orphan, show a "dead code?" badge (yellow/orange)
- **Dashboard approach:** Add an "Orphans" section to a stats panel listing all orphan functions
- **Tree integration:** Show an icon on file tree nodes that contain orphans

Would need to fetch orphan list once and cross-reference with displayed methods.

**Effort:** Medium (need to fetch orphan data and cross-reference with current view).  
**Priority:** P2 — useful for code cleanup, not blocking.

---

### 7. Staleness Indicators

**What:** Visual cues for outdated pseudo — functions whose `date` field is older than a threshold.

**API endpoint:** `GET /api/pseudo/stale?days=30` — returns `Array<{ filePath, methodName, lastUpdated }>`.

**UI change:**
- In `PseudoBlock`: if `func.date` is older than N days, show a warning icon or amber border
- In file tree: if a file has stale methods, show an indicator dot
- Client-side computation is also possible since `func.date` is already in the structured response

**Effort:** Low — can be done client-side from existing data, or use the `/stale` endpoint for a threshold-based list.  
**Priority:** P1 — helps maintain pseudo freshness.

---

### 8. Coverage Dashboard

**What:** Show what percentage of code files have corresponding pseudo files, broken down by directory.

**API endpoint:** `GET /api/pseudo/coverage?directory=src/` — returns `{ coveredFiles, totalFiles, percent, missingFiles }`.

**UI change:** New panel or overlay:
- Directory tree with coverage percentages
- Green/yellow/red color coding
- List of missing files that need pseudo

Note: The current backend implementation is incomplete — `totalFiles` always equals `coveredFiles` (it doesn't scan the actual codebase for source files). Would need backend enhancement to compare against actual source files.

**Effort:** Medium (UI is simple, but backend needs work to be useful).  
**Priority:** P2 — depends on backend improvement.

---

### 9. Function-Level Deep Links

**What:** URL-based navigation to specific functions, e.g., `/pseudo/src/services/auth#validateToken`.

**API endpoint:** No new endpoint needed — uses existing file + method data.

**UI change:**
- Add hash fragment support to `PseudoPage` routing
- On initial load, if URL has `#functionName`, scroll to that function after render
- Update browser URL hash when user clicks a function in the jump panel
- Share-friendly links

**Effort:** Low — mostly routing/scroll logic, builds on existing `scrollToFunction`.  
**Priority:** P1 — improves shareability and bookmarking.

---

### 10. Stats/Overview Panel

**What:** Codebase-wide metrics dashboard: total files, total methods, total exports, orphan count, stale count.

**API endpoint:** `GET /api/pseudo/stats` — returns `{ fileCount, methodCount, exportCount }`. Combine with `/orphans` and `/stale` counts.

**UI change:** A summary bar or collapsible panel at the top of the file tree, or a dedicated "Overview" landing page when no file is selected:
- Total pseudo files: N
- Total methods: N
- Exported: N
- Orphans: N  
- Stale (>30d): N
- Progress bars or sparkline charts

**Effort:** Low — just fetch and display numbers.  
**Priority:** P1 — gives immediate value when landing on the pseudo page.

---

## Summary Table

| # | Feature | API Endpoint | Effort | Priority | New Component? |
|---|---------|-------------|--------|----------|----------------|
| 1 | File tree badges | `/files` | Low | **P0** | No — enhance `TreeNodeRenderer` |
| 2 | Call graph viz | `/graph`, `/diagram` | Med-High | P1 | Yes — `CallGraphView.tsx` |
| 3 | Impact analysis | `/impact` | Low | **P1** | No — extend `PseudoBlock` |
| 4 | Search improvements | `/search` | Low | **P0** | No — update `PseudoSearch` |
| 5 | Export surface | `/exports` | Low | P2 | Yes — `ExportSurface.tsx` |
| 6 | Orphan detection | `/orphans` | Med | P2 | Optional — badge in `PseudoBlock` |
| 7 | Staleness indicators | `/stale`, client-side | Low | **P1** | No — badge in `PseudoBlock` + tree |
| 8 | Coverage dashboard | `/coverage` | Med | P2 | Yes — `CoverageDashboard.tsx` |
| 9 | Deep links | N/A (client routing) | Low | **P1** | No — routing in `PseudoPage` |
| 10 | Stats/overview | `/stats` + others | Low | **P1** | Optional — panel in sidebar |

---

## Recommended Implementation Order

### Phase 1 — Migration (P0, required)
These must happen as part of the API migration:
1. **pseudo-api.ts** type + fetch updates
2. **Search improvements** (#4) — new response shape requires UI update
3. **File tree badges** (#1) — new `PseudoFileSummary[]` type enables badges naturally

### Phase 2 — Quick Wins (P1, low effort)
4. **Staleness indicators** (#7) — client-side from `func.date`
5. **Deep links** (#9) — routing enhancement
6. **Stats overview** (#10) — fetch + display
7. **Impact analysis** (#3) — extend existing refs UI pattern

### Phase 3 — New Views (P1-P2, medium+ effort)
8. **Call graph visualization** (#2) — new component
9. **Orphan detection** (#6) — cross-reference data
10. **Export surface** (#5) — new list view
11. **Coverage dashboard** (#8) — needs backend work

---

## Key API Gaps

1. **Coverage endpoint** is a stub — always returns `totalFiles = coveredFiles`. Needs to scan source files on disk to provide real coverage.
2. **No batch endpoint** for fetching orphan/stale status per-file — would need N+1 queries or a combined endpoint for efficient tree decoration.
3. **No WebSocket events** for pseudo DB changes — the current WebSocket is for general connectivity, but pseudo-specific change events would enable live updates without polling.
