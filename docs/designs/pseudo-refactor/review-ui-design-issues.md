# Design Review: Pseudo UI Update Issues

## Critical Issues

### 1. References API: `callerFunction` vs `callerMethod` Mismatch (WILL BREAK)

The backend `getReferences()` returns `{ file, callerMethod }` (pseudo-db.ts:390), but the frontend `Reference` type uses `callerFunction` (pseudo-api.ts:7). **PseudoBlock.tsx line 160** renders `ref.callerFunction` in the USED BY section.

The design mentions this mismatch but leaves the resolution ambiguous ("Either update all UI references or map in the API client"). **Decision needed**: The simplest fix is to map in `fetchPseudoReferences()`, but the design should be explicit about which approach to take, since the current code is already broken against the new backend.

### 2. `fetchPseudoFile` Return Type Change Breaks CallsLink (TYPE ERROR)

`CallsLink.tsx` line 68 does `content = await fetchPseudoFile(project, fileStem)` and stores it as `string`. The design correctly says to change this to `PseudoFileWithMethods`, but **the popoverState type** at line 33-37 has `content?: string` — this needs to change to `fileData?: PseudoFileWithMethods`. The design mentions this but the state shape `{ visible, anchorRect, content }` must change to `{ visible, anchorRect, fileData }`, which is a larger refactor than shown.

### 3. `fetchPseudoFile` Already Returns Different Shape from Backend

The current `pseudo-api.ts` line 66 does `return data.content || ''`. But the backend `handleGetFile` (pseudo-api.ts:148-149) returns `Response.json(result)` where `result` is `PseudoFileWithMethods` — **there is no `.content` wrapper**. The current frontend is already broken: `data.content` will be `undefined` and it returns empty string. The design correctly identifies this but understates the severity — this means the pseudo viewer is currently non-functional with the new backend.

### 4. Search API Response Shape Completely Different

The current frontend `searchPseudo()` (pseudo-api.ts:107-108) expects `data.matches` to be `Record<string, SearchMatch[]>` (a dictionary keyed by filename). The new backend returns `{ matches: SearchResult[] }` — a flat array with `{ filePath, methodName, snippet, rank }`.

**PseudoSearch.tsx is deeply coupled to the old shape**: `flatResults` iterates `results.forEach(result => result.matches.slice(0,3)...)` (line 68-80). The entire flattening logic, `FlatResult` type, and result rendering must be rewritten. The `match.functionName`, `match.line`, `match.lineNumber` fields used in rendering (lines 248, 252-253, 258-259) don't exist in the new shape.

### 5. `fetchPseudoFiles` Already Has Partial Migration (INCONSISTENT)

The current `fetchPseudoFiles()` (pseudo-api.ts:40-41) already maps `PseudoFileSummary[]` back to `string[]` via `files.map((f: any) => typeof f === 'string' ? f : f.filePath)`. The design says to change this to return `PseudoFileSummary[]`, which means `PseudoFileTree` and `PseudoPage` need updating. But the current code is an intentional compatibility shim that's already working. Removing it will break `PseudoFileTree` which takes `fileList: string[]`.

---

## Missing Components in Design

### 6. Test Files Not Mentioned (6 test files need updating)

The design omits all test file changes. These files import from `parsePseudo.ts` and use the old types:
- `PseudoBlock.test.tsx` — imports `ParsedFunction`, constructs test data with `isExport`, `updatedAt`, `body: string[]`
- `FunctionJumpPanel.test.tsx` — imports `ParsedFunction`, uses `isExport`
- `CallsPopover.test.tsx` — passes raw pseudo text as `content` string prop
- `PseudoSearch.test.tsx` — mocks `searchPseudo` returning `{ file, matches: SearchMatch[] }[]`
- `parsePseudo.test.ts` — tests the parser directly (should be deleted with parsePseudo.ts)
- `PseudoPage.test.tsx` — likely uses old types

All 6 test files will fail after the migration and need updates to match the new types and API response shapes.

### 7. `PseudoBlock.tsx` Body Contains CALLS Lines

The current parser extracts CALLS from body lines (parsePseudo.ts:139-155 `parseCallsFromBody`). In the old flow, CALLS lines like `CALLS: fetchUser(api)` appear in `func.body` (the string array) but are also parsed into `func.calls`. PseudoBlock renders both the CALLS section AND the body. With the new API, `steps` won't contain CALLS lines (they're stored separately in `method_calls` table). The design doesn't mention this — it means the body rendering will no longer show duplicate CALLS lines, which is actually an improvement, but the design should explicitly note this behavioral change.

---

## API Response Mismatches

### 8. `handleGetFile` Returns Null for Missing Files

The backend (pseudo-api.ts:148) returns `jsonError('File not found', 404)` when file is null. But the current frontend `fetchPseudoFile` throws on non-ok response. The design's proposed `fetchPseudoFile` returns `PseudoFileWithMethods` (not nullable). The frontend should handle 404 gracefully — either return null or throw with a specific error. The current code handles this via the error state, so this is fine, but the return type should be `PseudoFileWithMethods` (not `PseudoFileWithMethods | null`).

### 9. `getFile` Lookup Uses `filePath` but Callers Pass `fileStem`

`CallsLink.tsx` calls `fetchPseudoFile(project, fileStem)` where `fileStem` is something like `api` or `utils/helpers`. But the backend `getFile(filePath)` does `SELECT * FROM files WHERE file_path = ?` — it matches on full `file_path` column, not `file_stem`. If `fileStem` doesn't match `file_path` exactly, the lookup will return null.

The old system probably worked because the file-based system used the stem to locate `.pseudo` files. The design doesn't address this mismatch. Either:
- The API route needs to also accept `fileStem` and query by `file_stem` column
- Or `CallsLink` needs to pass the full `filePath` instead of `fileStem`

**This is a critical data flow bug that will break the CallsLink hover popover and CALLS navigation.**

---

## Data Flow Issues

### 10. `onFunctionsChange` Type Mismatch Through Component Chain

The data flow is: `PseudoViewer.onFunctionsChange` -> `PseudoPage.setFunctions` -> `FunctionJumpPanel.functions`. Currently all use `ParsedFunction[]` (except `PseudoViewer` which types it as `any[]`). The design says to change to `PseudoMethod[]`, but `PseudoViewer.tsx` line 25 types `onFunctionsChange` as `(functions: any[]) => void` — so the viewer won't catch type mismatches. The design should make this explicitly typed.

### 11. `PseudoPage.fileCache` Is Unused After Migration

The design mentions changing `fileCache: Map<string, string>` to `Map<string, PseudoFileWithMethods>` or removing it. Looking at the current code, `fileCache` is declared but never populated or read (PseudoPage.tsx:78). It should simply be deleted, not updated.

### 12. `moduleContext` Rendering: String vs String[] Mismatch

The design correctly notes `moduleProse` is `string[]` (one `<p>` per line) while `moduleContext` is a single string. PseudoViewer.tsx line 143-145 does `.filter(l => l.trim()).map((line, idx) => <p>...)` on the array. The design says to split by `\n` — but if `moduleContext` is empty string, `"".split('\n')` returns `[""]`, which would render an empty `<p>`. Need to handle empty moduleContext explicitly.

---

## Type Mismatches

### 13. `isExport` vs `isExported` Throughout

The old type uses `isExport` (parsePseudo.ts:10), the new backend returns `isExported` (pseudo-db.ts:36). The design correctly identifies this for PseudoBlock and FunctionJumpPanel, but also note:
- PseudoBlock.tsx line 129: `func.isExport`
- FunctionJumpPanel.tsx line 109: `func.isExport`
- All test files constructing `ParsedFunction` objects use `isExport`

### 14. `updatedAt` vs `date`

Old: `func.updatedAt` (string like "2024-01-15"). New: `func.date` (string | null). PseudoBlock.tsx line 124-127 renders `func.updatedAt`. Both are nullable strings so this is a simple rename, but the design should note the different semantics — `date` is less descriptive than `updatedAt`.

### 15. `body: string[]` vs `steps: Array<{ content, depth }>`

This is the largest rendering change. PseudoBlock.tsx `renderBodyLine` (line 51-76) takes a raw string, computes `leadingSpaces` from whitespace, and renders with `paddingLeft: 20 + leadingSpaces * 8`. The new `step.depth` is an integer (0, 1, 2...) and the design proposes `20 + depth * 16`. The visual output will differ — old code handles arbitrary whitespace amounts while new code uses fixed depth increments. The design acknowledges this but the calibration needs testing.

---

## Edge Cases

### 16. Empty Methods Array

If a file has no methods, `PseudoViewer` renders "No functions" (line 149-150). This will still work with the new API since `fileData.methods` will be an empty array. No issue here.

### 17. File With No moduleContext

If `moduleContext` is empty string, the header section shouldn't render. Current code checks `parsed.moduleProse.length > 0`. Need to check `fileData.moduleContext.trim()` instead, since empty string is truthy but has no content.

### 18. `PseudoFileTree` Active Path Matching

Currently `PseudoFileTree` matches `currentPath` against `node.path` (line 72: `node.path === currentPath`). The tree is built from file path strings. If the design changes `fileList` to `PseudoFileSummary[]` and extracts `filePaths`, the paths must be in the same format as `currentPath` (which comes from the URL). This should work since `buildTree` preserves the original path strings.

---

## Summary Table

| # | Severity | Issue |
|---|----------|-------|
| 1 | HIGH | `callerFunction` vs `callerMethod` — currently broken |
| 2 | HIGH | CallsLink popoverState type needs full rework |
| 3 | HIGH | `fetchPseudoFile` returning empty string — viewer broken now |
| 4 | HIGH | Search response shape completely different |
| 5 | MEDIUM | `fetchPseudoFiles` has partial shim, removal breaks tree |
| 6 | HIGH | 6 test files not mentioned in design |
| 7 | LOW | CALLS lines no longer in body (behavioral change) |
| 8 | LOW | 404 handling is fine as-is |
| 9 | HIGH | `fileStem` vs `filePath` lookup mismatch breaks CallsLink |
| 10 | MEDIUM | `onFunctionsChange` typed as `any[]` — should be explicit |
| 11 | LOW | `fileCache` is dead code — just delete |
| 12 | MEDIUM | Empty `moduleContext` renders empty `<p>` |
| 13 | MEDIUM | `isExport` -> `isExported` rename in all files + tests |
| 14 | LOW | `updatedAt` -> `date` rename |
| 15 | MEDIUM | Body indent calibration needs testing |
| 16 | NONE | Empty methods handled correctly |
| 17 | MEDIUM | Empty moduleContext check needs adjustment |
| 18 | LOW | Path matching should work unchanged |
