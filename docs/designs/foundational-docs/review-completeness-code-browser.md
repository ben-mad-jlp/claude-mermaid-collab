# Completeness Review — Code Browser Revamp

## Summary

**14/14 blueprint tasks implemented.** All specified files exist with real, non-stub implementations; all 14 functions in Section 2 have concrete bodies; no `TODO` / `Not implemented` / `NotImplementedError` sentinels in any changed/new file.

**Test coverage gap**: Only 3 of the 6 test files listed in the blueprint actually exist. Three are missing.

---

## Task Completion (Section 3 YAML graph)

| Task | Status | Evidence |
|---|---|---|
| pr1-preview-slot | DONE | `ArtifactTree.tsx:1182` uses `openPreview({...kind:'code-file'...})` |
| pr1-hover-prefetch | DONE | `pseudo-api.ts:153-158` exports `prefetchPseudoFile`; `PseudoFileTree.tsx:117-119` wires `onMouseEnter` → `onPrefetch` |
| pr1-memoize-pseudoblock | DONE | `PseudoBlock.tsx:209` `export default React.memo(PseudoBlock)` |
| pr2-peek-and-skeleton | DONE | `peekPseudoFile` at `pseudo-api.ts:145-147`; `PseudoViewer.tsx:35,52` seeds from cache; skeleton with `animate-pulse` at line 134 |
| pr3-code-file-endpoint | DONE | `code-api.ts:319-465`; discriminated `{kind:'text'|'image'|'binary'}`; `validatePathUnderRoot`; realpath check; size caps |
| pr4a-ui-store-view-mode | DONE | `uiStore.ts:33,133-134` `codeFileViewMode: 'code'` + setter, reset at line 203 |
| pr4b-code-file-view | DONE | `CodeFileView.tsx` (178 lines); `fetchCodeFile` at `pseudo-api.ts:264-289` |
| pr4c-pane-content-dispatch | DONE | `PaneContent.tsx:186-196` branches on `codeFirstView` flag, `PseudoViewer` remains fallback |
| pr5-remove-link-button | DONE | `PseudoFileTree.tsx` no `handleLinkAndOpen` and no `linkFile` import (grep confirmed) |
| pr6a-link-file-dedupe | DONE | `link-file.ts:24-34` scans `sessionStore.snippets`, parses envelope, returns existing id on `filePath` match |
| pr6b-promote-code-file | DONE | `promote-code-file.ts` implements dedupe → linkFile → closeTab → openPermanent |
| pr6c-rewire-promotion | DONE | `useEditorAutoPromote.ts:39` branches on `tab.kind === 'code-file'`; `TabBar.tsx:207,223,244` and `PinnedTabBar.tsx:96` all branch |
| pr7-edge-cases | DONE | `CodeFileView.tsx`: `allowLarge` state + "Fetch anyway" (140-145), drift badge "stale" (78,112), `CodeFileNotFoundError` UI (121-122) |
| pr8-perf-bus | DONE | `perf-bus.ts` exports `PerfMark`/`mark`/`measureBetween`; used in `CodeFileView.tsx` (code-fetch-start/end, code-first-paint via rAF, prose-toggle, prose-mounted) and `PseudoFileTree.tsx:116` (code-click) |

---

## Files (Section 1)

### Created — all present
- `ui/src/components/editors/CodeFileView.tsx` — 178 lines, real impl
- `ui/src/lib/promote-code-file.ts` — 59 lines, real impl
- `src/routes/__tests__/code-api.test.ts` — present
- `ui/src/components/editors/__tests__/CodeFileView.test.tsx` — **MISSING**

### Modified — all present with blueprint-compliant changes
- `ArtifactTree.tsx`, `pseudo-api.ts`, `PseudoFileTree.tsx`, `PseudoBlock.tsx`, `PseudoViewer.tsx`, `code-api.ts`, `uiStore.ts`, `PaneContent.tsx`, `link-file.ts`, `useEditorAutoPromote.ts`, `TabBar.tsx`, `PinnedTabBar.tsx`, `perf-bus.ts` — all verified

---

## Functions (Section 2)

| Function | File | Non-stub? |
|---|---|---|
| `peekPseudoFile` | `ui/src/lib/pseudo-api.ts:145-147` | yes |
| `prefetchPseudoFile` | `ui/src/lib/pseudo-api.ts:153-158` | yes |
| `fetchCodeFile` | `ui/src/lib/pseudo-api.ts:264-289` | yes (runtime-validates discriminant, throws typed errors) |
| `GET /api/code/file` handler | `src/routes/code-api.ts:319-465` | yes (path security, NUL scan, image dataUrl, 2MB cap, allowLarge) |
| `CodeFileView` | `ui/src/components/editors/CodeFileView.tsx:32-175` | yes |
| `promoteCodeFile` | `ui/src/lib/promote-code-file.ts:5-59` | yes |
| `linkFile` dedupe branch | `ui/src/lib/link-file.ts:24-34` | yes |
| `useEditorAutoPromote` branch | `ui/src/hooks/useEditorAutoPromote.ts:38-41` | yes |

No stub sentinels (`TODO`, `throw new Error('Not implemented')`, `NotImplementedError`) in any changed/new file.

---

## Tests

| Test file | Exists? |
|---|---|
| `ui/src/lib/__tests__/link-file.test.ts` | YES |
| `src/routes/__tests__/code-api.test.ts` | YES |
| `ui/src/stores/__tests__/uiStore.test.ts` | YES |
| `ui/src/lib/__tests__/promote-code-file.test.ts` | **MISSING** |
| `ui/src/components/editors/__tests__/CodeFileView.test.tsx` | **MISSING** |
| `ui/src/lib/__tests__/pseudo-api.test.ts` | **MISSING** |

---

## Gaps

### Gap 1: Missing test file — `promote-code-file.test.ts`
- **Specified**: Blueprint Section 1 ("Created") and pr6b-promote-code-file task `tests:` entry — three test cases listed (happy path, dedupe, linkFile rejection).
- **Missing**: `ui/src/lib/__tests__/promote-code-file.test.ts` does not exist.
- **Location**: `ui/src/lib/__tests__/` (file absent).

### Gap 2: Missing test file — `CodeFileView.test.tsx`
- **Specified**: Blueprint Section 1 ("Created") — listed in pr4b and pr7 task `tests:` entries. Covers render, prose toggle mount, binary placeholder, truncation UI, drift badge, Fetch-anyway.
- **Missing**: `ui/src/components/editors/__tests__/CodeFileView.test.tsx` does not exist.
- **Location**: `ui/src/components/editors/__tests__/` (directory likely does not exist).

### Gap 3: Missing test file — `pseudo-api.test.ts`
- **Specified**: Blueprint task `tests:` entries for pr1-hover-prefetch and pr2-peek-and-skeleton — cover `peekPseudoFile` cache reference + `prefetchPseudoFile` cold/warm behavior.
- **Missing**: `ui/src/lib/__tests__/pseudo-api.test.ts` does not exist.
- **Location**: `ui/src/lib/__tests__/`.

### Gap 4 (minor): `perf-bus.test.ts` not present
- **Specified**: pr8-perf-bus `tests: [ui/src/lib/__tests__/perf-bus.test.ts]`.
- **Missing**: file does not exist. Not in the reviewer's checklist of six, but listed in blueprint YAML.

---

## Verdict

**Implementation: 14/14 tasks complete, all functions non-stub.**
**Tests: 3 of 6 (4 of 7 counting perf-bus) specified test files are missing.**
