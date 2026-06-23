# Wave 1 Implementation — Code Browser Revamp

## Tasks (7 total)

Already implemented in the codebase prior to this wave (analyze agents confirmed and verified line-by-line):
- `pr1-preview-slot` — ArtifactTree PseudoTreeBody.onNavigate already uses `openPreview` (ArtifactTree.tsx:1182).
- `pr1-hover-prefetch` — `prefetchPseudoFile` exported at pseudo-api.ts:153-158; PseudoFileTree wires `onMouseEnter` via an `onPrefetch` prop (functionally equivalent to direct call).
- `pr1-memoize-pseudoblock` — `export default React.memo(PseudoBlock)` already in place (PseudoBlock.tsx:209).
- `pr2-peek-and-skeleton` — `peekPseudoFile` exported; PseudoViewer seeds from cache, skips `loading=true` on cache hit, and renders a skeleton (breadcrumb + 3 ghost method cards, `animate-pulse`) instead of full-pane spinner.
- `pr3-code-file-endpoint` — `GET /api/code/file` handler at `src/routes/code-api.ts:318-465`; vitest suite at `src/routes/__tests__/code-api.test.ts:591-676` covering 200 text, 200 binary, 200 truncated, 404, 400. Backend suite 37/37 passing.

Implemented this wave:
- `pr4a-ui-store-view-mode` — Added `CodeFileViewMode = 'code' | 'prose'` type; added `codeFileViewMode` + `setCodeFileViewMode` to `UIState`; initial default `'code'`; included in `reset`. No persist version bump (new field defaults to `'code'` for existing hydrated state).
- `pr6a-link-file-dedupe` — `linkFile` now scans `useSessionStore.getState().snippets` and returns an existing snippet id when `JSON.parse(content).filePath === path`; try/catch skips non-JSON content. Falls through to original `createSnippet` + `syncCodeFromDisk` on no match. New test file `ui/src/lib/__tests__/link-file.test.ts` with dedupe-hit and no-match tests (2/2 passing).

## Verification

- Unit: `ui/src/lib/__tests__/link-file.test.ts` — 2/2 passing.
- Server: `src/routes/__tests__/code-api.test.ts` — 37/37 passing.
- TypeScript: only pre-existing errors in unrelated files; no new errors in the changed files.
- Initial fix: test file had wrong relative path (`../stores/sessionStore` → `../../stores/sessionStore`); corrected.

## Next

Wave 2: `pr4b-code-file-view`, `pr6b-promote-code-file`.
