# Pseudo UI Update: SQLite-Backed API Migration

## Overview

The backend was refactored from file-based `.pseudo` files to a SQLite DB. The API now returns **structured data** instead of raw text, but the UI still tries to parse raw text client-side via `parsePseudo.ts`. This design eliminates client-side parsing entirely and updates each UI component to consume the new structured responses directly.

This document incorporates all findings from the issues review and feature opportunities analysis.

---

## Critical Issue Fixes (Baked Into Plan)

These issues are **currently broken or will break** and must be resolved as part of the migration:

| Issue | Severity | Resolution |
|-------|----------|------------|
| `fetchPseudoFile` returns `data.content` which is `undefined` — viewer is non-functional now | HIGH | Return `PseudoFileWithMethods` directly (no `.content` wrapper) |
| `fileStem` vs `filePath` lookup mismatch — CallsLink hover popover broken | HIGH | Add `/api/pseudo/file-by-stem` endpoint on backend, or resolve stems to full paths on frontend using the file list |
| `callerFunction` → `callerMethod` field rename — USED BY section broken | HIGH | Rename in `fetchPseudoReferences()` return type and update all consumers (no shim) |
| Search response shape completely different — PseudoSearch must be rewritten | HIGH | Full rewrite of `PseudoSearch.tsx` for flat `SearchResult[]` with `<mark>` snippets |
| 6 test files need updating (not mentioned in original design) | HIGH | Update all test files to match new types and API shapes |
| `fileCache` is dead code (declared but never populated) | LOW | Delete, do not update |
| `moduleContext` empty state renders empty `<p>` | MEDIUM | Guard with `moduleContext.trim()` check before splitting/rendering |
| Body indent calibration (old: `leadingSpaces * 8px`, new: `depth * 16px`) | MEDIUM | Use `depth * 16px` — needs visual testing to confirm parity |

---

## API Response Shape Changes

### `GET /api/pseudo/files`
- **Old:** `{ files: string[] }` — flat list of file path strings
- **New:** `{ files: PseudoFileSummary[] }` — array of objects:
  ```ts
  { filePath: string; title: string; methodCount: number; exportCount: number; lastUpdated: string }
  ```

### `GET /api/pseudo/file`
- **Old:** `{ content: string }` — raw `.pseudo` text, parsed client-side
- **New:** Returns `PseudoFileWithMethods` directly (**no wrapper** — `data.content` is `undefined` against new backend):
  ```ts
  {
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
      steps: Array<{ content: string; depth: number }>;
      calls: Array<{ name: string; fileStem: string }>;
    }>;
  }
  ```

### `GET /api/pseudo/file-by-stem` (NEW — needed for CallsLink)
- **Purpose:** Resolve a `fileStem` (e.g., `api`, `utils/helpers`) to the full file and return its data
- **Returns:** Same `PseudoFileWithMethods` shape
- **Why:** `CallsLink.tsx` passes `fileStem` but `getFile()` queries by `file_path`. Either add this endpoint or resolve stems client-side from the file list.

### `GET /api/pseudo/search`
- **Old:** `{ matches: Record<string, SearchMatch[]> }` — grouped by file, each match has `functionName`, `line`, `lineNumber`, `isFunctionLine`
- **New:** `{ matches: SearchResult[] }` — flat array:
  ```ts
  { filePath: string; methodName: string; snippet: string; rank: number }
  ```

### `GET /api/pseudo/references`
- **Old:** `{ references: { file: string; callerFunction: string }[] }`
- **New:** `{ references: { file: string; callerMethod: string }[] }` — field renamed from `callerFunction` to `callerMethod`

---

## New Types & Interfaces

All types defined in `pseudo-api.ts` — single source of truth after `parsePseudo.ts` deletion:

```ts
export interface PseudoFileSummary {
  filePath: string;
  title: string;
  methodCount: number;
  exportCount: number;
  lastUpdated: string;
}

export interface PseudoMethod {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  date: string | null;
  steps: Array<{ content: string; depth: number }>;
  calls: Array<{ name: string; fileStem: string }>;
}

export interface PseudoFileWithMethods {
  filePath: string;
  title: string;
  purpose: string;
  moduleContext: string;
  syncedAt: string | null;
  methods: PseudoMethod[];
}

export interface SearchResult {
  filePath: string;
  methodName: string;
  snippet: string;
  rank: number;
}

export interface Reference {
  file: string;
  callerMethod: string;
}
```

---

## File-by-File Changes

### 1. `ui/src/lib/pseudo-api.ts` — API Client Types & Fetch Methods

**Changes:**
- Replace old types (`Reference`, `SearchMatch`, `SearchResult`) with new DB-aligned types (see above)
- `fetchPseudoFiles()` returns `PseudoFileSummary[]` instead of `string[]` — **remove the existing compatibility shim** that maps back to strings
- `fetchPseudoFile()` returns `PseudoFileWithMethods` directly — **fix: `return data` not `return data.content`**
- `searchPseudo()` returns the new flat `SearchResult[]`
- `fetchPseudoReferences()` returns `Reference[]` with `callerMethod` field — **no backward compat mapping**

**Updated fetch functions:**
```ts
export async function fetchPseudoFiles(project: string): Promise<PseudoFileSummary[]> {
  const data = await response.json();
  return data.files || [];
}

export async function fetchPseudoFile(project: string, file: string): Promise<PseudoFileWithMethods> {
  // GET /api/pseudo/file -> PseudoFileWithMethods (direct, no .content wrapper)
  const data = await response.json();
  return data; // NOT data.content
}

export async function searchPseudo(project: string, q: string): Promise<SearchResult[]> {
  const data = await response.json();
  return data.matches || [];
}

export async function fetchPseudoReferences(...): Promise<Reference[]> {
  const data = await response.json();
  return data.references || [];
}
```

---

### 2. `ui/src/pages/pseudo/PseudoPage.tsx` — State Management

**Changes:**
- `fileList` type: `string[]` → `PseudoFileSummary[]`
- **Delete `fileCache`** — it's dead code (declared but never populated or read)
- `functions` type: `ParsedFunction[]` → `PseudoMethod[]`
- `onFunctionsChange` callback: type explicitly as `(fns: PseudoMethod[]) => void` — **not `any[]`**
- Remove import of `ParsedFunction` from `parsePseudo.ts`
- Import `PseudoFileSummary`, `PseudoMethod` from `pseudo-api.ts`

**Key state type change:**
```ts
// Before
const [fileList, setFileList] = useState<string[]>([]);
const [functions, setFunctions] = useState<ParsedFunction[]>([]);
const fileCache = useRef(new Map<string, string>()); // DEAD CODE

// After
const [fileList, setFileList] = useState<PseudoFileSummary[]>([]);
const [functions, setFunctions] = useState<PseudoMethod[]>([]);
// fileCache deleted
```

---

### 3. `ui/src/pages/pseudo/PseudoViewer.tsx` — Core Viewer

**Changes:**
- Replace `fetchPseudoFile` return handling: store `PseudoFileWithMethods` instead of raw `string`
- **Remove** `parsePseudo()` call and `useMemo` for parsing — data arrives pre-parsed
- State: `content: string` → `fileData: PseudoFileWithMethods | null`
- Render module header from `fileData.title`, `fileData.purpose`, `fileData.moduleContext`
- **moduleContext rendering**: guard with `fileData.moduleContext.trim()` before splitting on `\n` — empty string `.split('\n')` returns `[""]` which renders an empty `<p>`
- Render methods from `fileData.methods` instead of `parsed.functions`
- `onFunctionsChange` passes `fileData.methods` instead of `parsed.functions`
- Remove import of `parsePseudo`

**Before:**
```tsx
const [content, setContent] = useState<string>('');
const parsed = useMemo(() => parsePseudo(content), [content]);
```

**After:**
```tsx
const [fileData, setFileData] = useState<PseudoFileWithMethods | null>(null);
// fileData comes directly from API, no parsing needed

// moduleContext rendering:
{fileData.moduleContext.trim() && fileData.moduleContext.split('\n')
  .filter(l => l.trim())
  .map((line, idx) => <p key={idx}>{line}</p>)}
```

**Field mapping:**
| Old (ParsedPseudo) | New (PseudoFileWithMethods) |
|---|---|
| `parsed.titleLine` | `fileData.title` |
| `parsed.subtitleLine` | `fileData.purpose` |
| `parsed.syncedAt` | `fileData.syncedAt` |
| `parsed.moduleProse` (string[]) | `fileData.moduleContext` (single string) |
| `parsed.functions` | `fileData.methods` |

---

### 4. `ui/src/pages/pseudo/PseudoBlock.tsx` — Function Block Rendering

**Changes:**
- Import `PseudoMethod` from `pseudo-api.ts` instead of `ParsedFunction` from `parsePseudo.ts`
- Props: `func: ParsedFunction` → `func: PseudoMethod`
- Field mappings:
  - `func.isExport` → `func.isExported`
  - `func.updatedAt` → `func.date`
  - `func.body` (string[]) → `func.steps` (Array<{ content, depth }>)
  - `func.calls` — same shape, no change needed
- **Body rendering overhaul**: Replace `renderBodyLine(line, idx)` with `renderStep(step, idx)` using `step.depth` for indentation and `step.content` for text
- **CALLS lines no longer in body**: The old parser extracted CALLS from body lines but also kept them in `body`. With the new API, `steps` won't contain CALLS lines (stored separately in `method_calls` table). This removes the old duplicate rendering — an improvement.
- References: `ref.callerFunction` → `ref.callerMethod`

**renderBodyLine replacement:**
```tsx
// Before: receives raw line string, computes indent from leading spaces
function renderBodyLine(line: string, index: number) {
  const leadingSpaces = line.length - line.trimStart().length;
  style={{ paddingLeft: `${20 + leadingSpaces * 8}px` }}
}

// After: receives step object with explicit depth
function renderStep(step: { content: string; depth: number }, index: number) {
  style={{ paddingLeft: `${20 + step.depth * 16}px` }}
  // content is already trimmed
}
```

---

### 5. `ui/src/pages/pseudo/PseudoFileTree.tsx` — File Tree Sidebar

**Changes:**
- Props: `fileList: string[]` → `fileList: PseudoFileSummary[]`
- `buildTree()` takes string[] — extract with `fileList.map(f => f.filePath)`
- **P0 feature: Metadata badges** — render `methodCount` and `exportCount` badges on leaf nodes

**Implementation:**
```tsx
const filePaths = useMemo(() => fileList.map(f => f.filePath), [fileList]);
const tree = useMemo(() => {
  const builtTree = buildTree(filePaths);
  return deepSortTree(builtTree);
}, [filePaths]);

// For badges, create a lookup map:
const fileMeta = useMemo(() => {
  const map = new Map<string, PseudoFileSummary>();
  fileList.forEach(f => map.set(f.filePath, f));
  return map;
}, [fileList]);

// In TreeNodeRenderer for leaf nodes:
const summary = fileMeta.get(node.path);
// Render: "{summary.methodCount} methods, {summary.exportCount} exports"
```

---

### 6. `ui/src/pages/pseudo/FunctionJumpPanel.tsx` — Function List Sidebar

**Changes:**
- Import `PseudoMethod` from `pseudo-api.ts` instead of `ParsedFunction` from `parsePseudo.ts`
- Props: `functions: ParsedFunction[]` → `functions: PseudoMethod[]`
- Field mapping: `func.isExport` → `func.isExported`
- Everything else works the same (name, data-function attribute)

---

### 7. `ui/src/pages/pseudo/CallsLink.tsx` — Call Reference Links

**Changes:**
- `fetchPseudoFile()` now returns `PseudoFileWithMethods` instead of `string`
- **fileStem resolution**: Use `/file-by-stem` endpoint or resolve the stem to a full path using the file list before calling `fetchPseudoFile`
- popoverState type change: `{ visible, anchorRect, content: string }` → `{ visible, anchorRect, fileData: PseudoFileWithMethods }`
- Pass `PseudoFileWithMethods` to `CallsPopover` instead of `content: string`

**Before:**
```tsx
content = await fetchPseudoFile(project, fileStem);
setPopoverState({ visible: true, anchorRect: rect, content });
```

**After:**
```tsx
const fileData = await fetchPseudoFile(project, resolvedFilePath);
setPopoverState({ visible: true, anchorRect: rect, fileData });
```

---

### 8. `ui/src/pages/pseudo/CallsPopover.tsx` — Call Reference Popover

**Changes:**
- Remove import of `parsePseudo`
- Props: `content?: string` → `fileData?: PseudoFileWithMethods`
- Remove `parsePseudo(content)` call — data already structured
- Read `title`, `purpose` directly from `fileData`
- Get exported methods: `fileData.methods.filter(m => m.isExported)`

**Before:**
```tsx
const parsed = useMemo(() => parsePseudo(content), [content]);
const exportedFunctions = parsed.functions.filter(fn => fn.isExport);
```

**After:**
```tsx
const exportedMethods = fileData?.methods.filter(m => m.isExported) ?? [];
// renders fileData.title, fileData.purpose
```

---

### 9. `ui/src/pages/pseudo/PseudoSearch.tsx` — Search Overlay (FULL REWRITE)

**Changes:**
- The new `SearchResult` is a flat array `{ filePath, methodName, snippet, rank }` — **completely different from old grouped shape**
- Remove old `SearchMatch` / `SearchResult` types, `FlatResult` type, and all flatten/group logic
- Each result displays `filePath`, `methodName`, and `snippet` (which contains `<mark>` tags for highlighting)
- **Render `snippet` with `dangerouslySetInnerHTML`** to show `<mark>` highlights (FTS5 ranked results)
- Navigation: extract fileStem from `filePath` (last segment minus `.pseudo`)

**Before (flatten grouped results):**
```tsx
const flatResults = results.flatMap(result => 
  result.matches.slice(0, 3).map(match => ({ file: result.file, match, ... }))
);
```

**After (already flat):**
```tsx
const displayResults = results.slice(0, 20).map((r, idx) => ({
  filePath: r.filePath,
  fileStem: r.filePath.split('/').pop()?.replace('.pseudo', '') || r.filePath,
  methodName: r.methodName,
  snippet: r.snippet,
  globalIndex: idx,
}));

// Render snippet with highlights:
<span dangerouslySetInnerHTML={{ __html: r.snippet }} />
```

---

### 10. `ui/src/pages/pseudo/parsePseudo.ts` — Client-Side Parser

**Action: DELETE.**

This file becomes unnecessary since the backend DB returns pre-parsed structured data. All consumers switch to importing types from `pseudo-api.ts`.

**Files that currently import from `parsePseudo.ts`:**
- `PseudoViewer.tsx` — imports `parsePseudo` function
- `PseudoBlock.tsx` — imports `ParsedFunction` type
- `FunctionJumpPanel.tsx` — imports `ParsedFunction` type
- `CallsPopover.tsx` — imports `parsePseudo` function
- `PseudoPage.tsx` — imports `ParsedFunction` type

---

### 11. `ui/src/pages/pseudo/tree.utils.ts` — Tree Building

**No changes needed.** This file takes `string[]` paths and builds a tree. The file tree component will extract `filePaths` from `PseudoFileSummary[]` before passing to `buildTree()`.

---

### 12. Test Files (6 files need updating)

All test files use old types and API shapes. Each must be updated:

| Test File | Changes Required |
|-----------|-----------------|
| `PseudoBlock.test.tsx` | Replace `ParsedFunction` with `PseudoMethod`, `isExport` → `isExported`, `updatedAt` → `date`, `body: string[]` → `steps: Array<{content, depth}>` |
| `FunctionJumpPanel.test.tsx` | Replace `ParsedFunction` with `PseudoMethod`, `isExport` → `isExported` |
| `CallsPopover.test.tsx` | Change `content: string` prop to `fileData: PseudoFileWithMethods`, remove raw pseudo text fixtures |
| `PseudoSearch.test.tsx` | Update `searchPseudo` mock to return flat `SearchResult[]` instead of `{ file, matches: SearchMatch[] }[]` |
| `parsePseudo.test.ts` | **DELETE** — parser is being removed |
| `PseudoPage.test.tsx` | Update state types and mock data to use `PseudoFileSummary[]` and `PseudoMethod[]` |

---

## P0 Features (Ship With Migration)

### File Tree Badges
- **What:** Show method count and export count from `PseudoFileSummary` on each leaf node
- **Where:** `PseudoFileTree.tsx` → `TreeNodeRenderer`
- **Data:** Already returned by `/api/pseudo/files` — zero additional API calls
- **Render:** Small badge like `(5m, 2e)` or icon-based indicators

### Search: FTS5 Ranked Results with Highlighted Snippets
- **What:** BM25-ranked results with `<mark>` tag highlighting from FTS5
- **Where:** `PseudoSearch.tsx` full rewrite (required by API shape change anyway)
- **Render:** `dangerouslySetInnerHTML` for snippet display
- **UX improvement:** Better relevance than old substring matching, method names shown prominently

---

## P1 Features (Quick Wins After Migration)

### Impact Analysis Panel
- **What:** "What breaks if I change this function?" — direct and transitive callers
- **Endpoint:** `GET /api/pseudo/impact?methodName=X&fileStem=Y` → `{ direct: AffectedItem[], transitive: AffectedItem[] }`
- **Where:** Add "Impact" button to `PseudoBlock` header, extending existing "refs" pattern
- **Effort:** Low — endpoint exists, UI is a list similar to refs panel

### Staleness Indicators
- **What:** Amber warning badges on methods where `date` is >30 days old
- **Where:** `PseudoBlock` header (amber border or icon), file tree (indicator dot)
- **Data:** Client-side computation from `func.date` already in response, or `/api/pseudo/stale?days=30`
- **Effort:** Low

### Function Deep Links
- **What:** Hash fragment routing: `/pseudo/src/services/auth#validateToken`
- **Where:** `PseudoPage.tsx` routing — add hash fragment support
- **Behavior:** On load with `#funcName`, scroll to that function; update hash on jump panel click
- **Effort:** Low — builds on existing `scrollToFunction`

### Stats Overview
- **What:** Landing page when no file selected showing `fileCount`, `methodCount`, `exportCount`
- **Endpoint:** `GET /api/pseudo/stats` → `{ fileCount, methodCount, exportCount }`
- **Where:** `PseudoPage.tsx` — render when no file is selected instead of blank area
- **Effort:** Low

---

## P2 Features (New Views)

### Call Graph Visualization
- **What:** Interactive graph of function calls across files
- **Endpoint:** `GET /api/pseudo/graph` → `{ nodes, edges }` or `GET /api/pseudo/diagram` → Mermaid string
- **Where:** New `CallGraphView.tsx` component
- **Options:** Mermaid renderer (medium) or interactive library like reactflow (high)

### Orphan Detection
- **What:** Badge on `PseudoBlock` for non-exported functions with zero callers
- **Endpoint:** `GET /api/pseudo/orphans` → `Array<{ filePath, methodName }>`
- **Where:** `PseudoBlock` badge or dashboard view
- **Effort:** Medium (need to fetch orphan data and cross-reference)

### Export Surface View
- **What:** Table of all exported functions across the codebase — the "public API surface"
- **Endpoint:** `GET /api/pseudo/exports` → `Array<{ filePath, methodName, purpose }>`
- **Where:** New `ExportSurface.tsx` list/table view
- **Effort:** Low

### Coverage Dashboard
- **What:** Coverage % per directory showing which code files have pseudo files
- **Endpoint:** `GET /api/pseudo/coverage?directory=src/` → `{ coveredFiles, totalFiles, percent, missingFiles }`
- **Where:** New `CoverageDashboard.tsx` panel
- **Note:** Backend endpoint is incomplete — `totalFiles` always equals `coveredFiles`. Needs backend work to scan actual source files.

---

## Migration Summary

| File | Action | Key Change |
|---|---|---|
| `pseudo-api.ts` | **Update** | New types, fix `fetchPseudoFile` to return data directly, flat search results |
| `PseudoPage.tsx` | **Update** | State types change, delete `fileCache`, typed `onFunctionsChange` |
| `PseudoViewer.tsx` | **Update** | Remove `parsePseudo()`, store `PseudoFileWithMethods`, guard `moduleContext` |
| `PseudoBlock.tsx` | **Update** | `PseudoMethod` type, `renderStep()`, `isExported`, `date`, `callerMethod` |
| `PseudoFileTree.tsx` | **Update** | Accept `PseudoFileSummary[]`, extract paths, add metadata badges (P0) |
| `PseudoSearch.tsx` | **Rewrite** | Flat `SearchResult[]`, `dangerouslySetInnerHTML` for snippets |
| `FunctionJumpPanel.tsx` | **Update** | `PseudoMethod` type, `isExported` |
| `CallsLink.tsx` | **Update** | Pass `PseudoFileWithMethods`, resolve `fileStem` → `filePath` |
| `CallsPopover.tsx` | **Update** | Receive structured data, remove `parsePseudo()` |
| `parsePseudo.ts` | **Delete** | No longer needed |
| `tree.utils.ts` | **No change** | Still takes `string[]` paths |
| 6 test files | **Update/Delete** | Match new types and API shapes |

## Implementation Order

1. **pseudo-api.ts** — Update types and fetch functions first (foundation)
2. **PseudoViewer.tsx** — Core change: remove parsing, use structured data
3. **PseudoBlock.tsx** — Update to render from steps/structured method
4. **CallsPopover.tsx** → **CallsLink.tsx** — Update popover first, then link
5. **FunctionJumpPanel.tsx** — Simple type swap
6. **PseudoFileTree.tsx** — Extract filePaths from summaries, add badges (P0)
7. **PseudoSearch.tsx** — Full rewrite for flat search results + FTS5 snippets (P0)
8. **PseudoPage.tsx** — Update state types, delete fileCache (after all children updated)
9. **Delete parsePseudo.ts** and **parsePseudo.test.ts**
10. **Update remaining 5 test files**

---

## Task List for Blueprint Generation

- [ ] Define new types in `pseudo-api.ts` (PseudoFileSummary, PseudoMethod, PseudoFileWithMethods, SearchResult, Reference)
- [ ] Fix `fetchPseudoFile()` to return `data` not `data.content`
- [ ] Fix `fetchPseudoFiles()` to return `PseudoFileSummary[]` (remove string shim)
- [ ] Fix `searchPseudo()` for flat `SearchResult[]`
- [ ] Fix `fetchPseudoReferences()` for `callerMethod` field
- [ ] Add `/file-by-stem` backend endpoint or implement client-side stem resolution
- [ ] Refactor `PseudoViewer.tsx` — remove `parsePseudo`, use `PseudoFileWithMethods`
- [ ] Guard `moduleContext` empty state (`.trim()` before split)
- [ ] Refactor `PseudoBlock.tsx` — `renderStep()`, field renames, `callerMethod`
- [ ] Calibrate body indent: `depth * 16px` — visual test against old output
- [ ] Refactor `CallsPopover.tsx` — receive `PseudoFileWithMethods`
- [ ] Refactor `CallsLink.tsx` — resolve `fileStem`, pass structured data
- [ ] Refactor `FunctionJumpPanel.tsx` — `PseudoMethod`, `isExported`
- [ ] Refactor `PseudoFileTree.tsx` — accept summaries, extract paths
- [ ] Add file tree metadata badges (P0: method count, export count)
- [ ] Rewrite `PseudoSearch.tsx` — flat results, `dangerouslySetInnerHTML` snippets
- [ ] Refactor `PseudoPage.tsx` — state types, delete `fileCache`, typed callback
- [ ] Delete `parsePseudo.ts`
- [ ] Update `PseudoBlock.test.tsx`
- [ ] Update `FunctionJumpPanel.test.tsx`
- [ ] Update `CallsPopover.test.tsx`
- [ ] Update `PseudoSearch.test.tsx`
- [ ] Delete `parsePseudo.test.ts`
- [ ] Update `PseudoPage.test.tsx`
- [ ] P1: Impact analysis button on PseudoBlock
- [ ] P1: Staleness badges (>30 day amber)
- [ ] P1: Hash fragment deep links
- [ ] P1: Stats overview landing page

---

## Risk Table

| Risk | Severity | Mitigation |
|------|----------|------------|
| `dangerouslySetInnerHTML` for search snippets — XSS vector if backend returns unsanitized HTML | MEDIUM | Backend FTS5 snippets only produce `<mark>` tags; sanitize or allowlist `<mark>` only |
| `moduleContext` empty string renders empty `<p>` via `"".split('\n')` → `[""]` | MEDIUM | Guard with `.trim()` check before splitting |
| Body indent calibration — `depth * 16px` may not match old `leadingSpaces * 8px` visually | MEDIUM | Visual regression testing; old code used arbitrary whitespace, new uses fixed increments |
| `fileStem` vs `filePath` lookup breaks CallsLink hover | HIGH | Requires backend `/file-by-stem` endpoint or client-side resolution — must resolve before migration |
| `callerFunction` → `callerMethod` rename touches UI + all test files | MEDIUM | Rename everywhere, no shim — clean break |
| CALLS lines no longer duplicated in body (behavioral change) | LOW | Net improvement — removes old duplicate rendering. Note in changelog. |
| Coverage endpoint is a stub (`totalFiles == coveredFiles`) | LOW | Document as known limitation; P2 feature depends on backend completion |
| No batch endpoint for orphan/stale status per-file — N+1 queries for tree decoration | MEDIUM | Fetch orphan/stale lists once on mount, cross-reference client-side |
| `fetchPseudoFiles` has existing compatibility shim — removing it breaks tree until tree is updated | MEDIUM | Update `PseudoFileTree` in same PR as `pseudo-api.ts` changes |
| `onFunctionsChange` typed as `any[]` hides type mismatches | MEDIUM | Explicitly type as `(fns: PseudoMethod[]) => void` |
