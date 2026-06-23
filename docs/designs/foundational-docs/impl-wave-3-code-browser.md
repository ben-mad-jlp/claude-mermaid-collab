# Wave 3 Implementation — Code Browser Revamp

## Tasks
- **pr4c-pane-content-dispatch** — Added `codeFirstView: true` flag + `setCodeFirstView`/`toggleCodeFirstView` to `uiStore.ts` (persisted). `PaneContent.tsx` now dispatches `'code-file'` kind tabs to `CodeFileView` when flag is on; `PseudoViewer` remains fallback.
- **pr6c-rewire-promotion** — Added `promoteCodeFile` branch at three call-sites: `useEditorAutoPromote.ts` (auto-promote on edit), `TabBar.tsx` (2 onPromote sites), `PinnedTabBar.tsx` (onReveal).

## Verification
- `tsc --noEmit`: no new errors.
- Grep confirms all expected markers and imports.
- Both tasks marked completed.

## Next
Wave 4: `pr5-remove-link-button`, `pr7-edge-cases`, `pr8-perf-bus`.
