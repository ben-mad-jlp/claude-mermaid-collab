# Wave 2 — Milkdown Parity Implementation

## Tasks completed
- **g1-typography-theme** — Already present: `@milkdown/theme-nord` installed, `milkdown-prose.css` imports theme + dark-mode wrapper, host wraps content in `.milkdown-host`. No edits.
- **g2-code-prism** — Rewrote `plugins/codeBlockPrism.ts` to use `prism` export directly (dropped broken `refractor/lib/common` import + invalid `prismConfig.configure` call). Built-in refractor languages apply.
- **g5-image-resolver** — Already present: `imageResolver.tsx`, `resolveImageSrc.ts`, and `ProjectSessionContext` all wired. Fixed only the `NodeViewFactory` type import (it isn't exported; use `ReturnType<typeof useNodeViewFactory>`).
- **g8-diff-branch** — Moved the `if (diff)` branch above the `!document` empty-state in `DocumentEditor.wysiwyg.tsx` so diffs render even without a selected document (parity with legacy behaviour).
- **g10-history-modal** — Already present: History button, modal state, open handler, and `handleHistoryVersionSelect` all match legacy.
- **g12-deferred-bugs** — M2 (rawPositions ±2 window), M4 (no stray bulletMarkerRemark), and M6 (orderedListMarker schema) were already in place. Added I4 fix: capture `autosaveDelay` in `MilkdownInner` via `useRef(...).current` at mount; removed from `plugins` useMemo deps so changing the prop no longer recreates the editor.

## Files changed
- `ui/src/components/editors/milkdown/plugins/codeBlockPrism.ts` (rewrite)
- `ui/src/components/editors/milkdown/plugins/imageResolver.tsx` (type fix)
- `ui/src/components/editors/milkdown/MilkdownEditor.tsx` (I4 autosaveDelay ref)
- `ui/src/components/editors/DocumentEditor.wysiwyg.tsx` (diff-branch ordering)

## Verification
- `tsc --noEmit`: zero errors in Wave 2 scope (remaining 28 errors are pre-existing onboarding-page failures).
- Tests: 56 passed / 1 skipped / 1 todo across `src/components/editors/milkdown` (roundtrip fixture N=14 M=14 K=0).
