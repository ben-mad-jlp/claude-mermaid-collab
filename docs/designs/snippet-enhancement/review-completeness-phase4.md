# Completeness Review — Phase 4

## Verdict: Everything complete. No gaps.

Phase 4 (Navigation Features) implementation matches the blueprint spec (`bp-phase4-navigation`) across all required files, symbols, and validation criteria.

---

## Files verified

### Backend
- **src/services/pseudo-db.ts** — `FunctionForSource` interface (line 104), `getFunctionsForSource` method (line 1045), `getReferences` enriched with `sourceLine: r.source_line ?? null` (line 778).
- **src/routes/pseudo-api.ts** — `GET /functions-for-source` handler (line 93) with `jsonError` for missing `sourcePath` (line 96) and call via `getPseudoDb(project).getFunctionsForSource(sourcePath)` (line 98).
- **src/services/__tests__/pseudo-db.test.ts** — new `describe('getFunctionsForSource')` block (line 557) and `describe('getReferences (includes sourceLine)')` block (line 617).
- **src/routes/pseudo-api.test.ts** — new `describe('GET /api/pseudo/functions-for-source')` block (line 484) with missing-sourcePath, unknown-file, and seeded-file cases.

### Frontend
- **ui/src/lib/pseudo-api.ts** — `Reference` type extended with `sourceLine?: number | null` (line 8). `PseudoMethod` extended with Phase 3 optional fields: `visibility?`, `isAsync?`, `kind?`, `sourceLine?`, `sourceLineEnd?`, `paramCount?`, `owningSymbol?` (lines 37-43). New `FunctionForSource` interface (line 46). New `fetchFunctionsForSource` async function (line 158).
- **ui/src/lib/extract-functions.ts** — NEW file. Exports `ExtractedFunction` interface (line 21), `extractFunctions` (line 127), `findSymbolAtPos` (line 210). Regex constants `FUNCTION_DECL_RE` (line 36), `ARROW_RE` (line 39), `FUNC_EXPR_RE` (line 42). Helper `findMatchingBraceLineIndex` (line 55).
- **ui/src/lib/__tests__/extract-functions.test.ts** — NEW file. 13 tests, all passing.
- **ui/src/components/editors/CodeMirrorWrapper.tsx** — `onSymbolClick?: (symbol: string, rect: DOMRect) => void` prop (line 75). Imports `findSymbolAtPos` (line 17). `buildSymbolClickExtension` function (line 436). Extension conditionally included in `extensions` useMemo via `symbolClickExtension` (lines 566-574).
- **ui/src/components/editors/FunctionJumpDropdown.tsx** — NEW file. Exports `FunctionJumpDropdown` and `FunctionJumpDropdownProps` (lines 23, 28). Uses `createPortal` (line 161). Keyboard handling for ArrowDown/ArrowUp/Enter/Escape (lines 128-138, 68).
- **ui/src/components/editors/ReferencesPopover.tsx** — NEW file. Exports `ReferencesPopover` and `ReferencesPopoverProps` (lines 22, 42). Uses `createPortal` (line 165). `onNavigateSameFile` callback (lines 30, 48, 85). `getBaseStem` helper (line 35) used for same-file detection. Expected `TODO(phase5)` comment present (line 82).
- **ui/src/components/editors/CodeEditor.tsx** — All required wiring: `FunctionJumpDropdown` imported (line 16) and rendered in toolbar (line 374). `ReferencesPopover` imported (line 17) and conditionally rendered (line 517). `fetchFunctionsForSource`, `fetchPseudoReferences`, `extractFunctions` imports (lines 21-22) and calls (lines 121, 131, 145). `editorViewRef` state (line 103). `jumpToLine` callback uses `EditorView.scrollIntoView` (line 172). `handleSymbolClick` callback (line 141). `fileStemFromPath` helper (line 78). Both SnippetEditor instances receive `onEditorReady` + `onSymbolClick` (lines 476-477, 486-487). `parseLinkedEnvelope` returns `language` (line 66).
- **ui/src/components/editors/SnippetEditor.tsx** — `onEditorReady?: (view: EditorView | null) => void` prop (line 48). `onSymbolClick?: (symbol, rect) => void` prop (line 50). Both destructured (lines 137-138). Both forwarded ONLY to the MAIN (non-diff) CodeMirrorWrapper at line 541 (forwarding at lines 552-553). The diff pair instances at lines 511 and 526 do NOT receive these props — matches blueprint.

---

## Stub search

No unexpected `TODO`, `NotImplementedError`, or `throw new Error('Not implemented')` in the Phase 4 files. The only TODO is `// TODO(phase5): resolve pseudo file → source file mapping for cross-file navigation` in ReferencesPopover.tsx line 82 — expected per blueprint Section 4.

---

## Test runs

| Test suite | Expected | Actual |
|---|---|---|
| `bun test src/services/__tests__/pseudo-db.test.ts` | 21/21 pass | **21 pass, 0 fail** |
| `bun test src/routes/pseudo-api.test.ts` | 17 pass + 13 pre-existing fail | **17 pass, 13 fail** (exact match; all 3 new `functions-for-source` tests pass) |
| `bunx vitest run src/lib/__tests__/extract-functions.test.ts` | 13/13 pass | **13 pass** |

## TypeScript check (scoped)

- Backend `tsc --noEmit` scoped to pseudo-db/pseudo-api/pseudo-parser/code-api: **no errors in production files**. The 20 errors in `src/routes/pseudo-api.test.ts` are all `TS18046 'data' is of type 'unknown'` — a pre-existing strictness issue from `await response.json()` untyped, NOT in the new `functions-for-source` describe block (verified by line-number filtering; all errors are in the 48-480 range, new block starts at line 484).
- UI `tsc --noEmit` scoped to CodeEditor/SnippetEditor/CodeMirrorWrapper/FunctionJumpDropdown/ReferencesPopover/extract-functions/pseudo-api: **zero errors**.

---

## Out-of-scope items correctly deferred (Section 4)

- Cross-file navigation to unlinked files: NOT implemented (confirmed; popover shows file but no click handler for cross-file targets).
- Go-to-definition right-click menu: NOT implemented.
- Cross-artifact code search: NOT implemented.
- ReferencesPopover `TODO(phase5)` comment: present at line 82 — documents the deferred cross-file resolution.

---

## Validation criteria (Section 5)

1. Backend endpoint works — verified via 3 passing tests covering missing param, unknown path, and seeded file with ordering assertions.
2. Tier 1 / Tier 2 logic — present in `CodeEditor.tsx` lines 113-139 (Tier 1 via `fetchFunctionsForSource`, Tier 2 fallback via `extractFunctions`).
3. Click-on-symbol wiring through layers — complete chain: CodeMirrorWrapper `buildSymbolClickExtension` → SnippetEditor forward → CodeEditor `handleSymbolClick` → `fetchPseudoReferences` → `ReferencesPopover`.
4. Same-file reference navigation via sourceLine enrichment — `getReferences` returns `sourceLine`; `ReferencesPopover.handleClick` invokes `onNavigateSameFile(ref.sourceLine)` (line 85); CodeEditor wires it to `jumpToLine` (line 523).

---

## Summary

**0 gaps found. Phase 4 implementation is complete and matches blueprint specification exactly.**
