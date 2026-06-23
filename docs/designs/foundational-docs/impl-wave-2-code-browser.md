# Wave 2 Implementation — Code Browser Revamp

## Tasks
- **pr4b-code-file-view** — Added `CodeFileResponse` type + `fetchCodeFile` client + `CodeFileNotFoundError`/`CodeFilePathError` classes to `ui/src/lib/pseudo-api.ts`. Created `ui/src/components/editors/CodeFileView.tsx` with CodeMirror code view, lazy-mounted `PseudoViewer` prose toggle, breadcrumb+toggle toolbar, truncation/binary/image handlers, retry UI.
- **pr6b-promote-code-file** — Created `ui/src/lib/promote-code-file.ts`: thunk that scans `sessionStore.snippets` for envelope with matching `filePath`, falls back to `linkFile`, then `closeTab` + `openPermanent` to swap preview for permanent snippet tab. Non-`code-file` tabs delegate to `tabsStore.promoteToPermanent`.

## Verification
- `tsc --noEmit`: 0 errors in changed files. Pre-existing unrelated errors only.
- Imports resolve, no dangling unused imports, exports confirmed.
- Both tasks marked completed.

## Next
Wave 3: `pr4c-pane-content-dispatch`, `pr6c-rewire-promotion`.
