# Wave 4 Implementation — Code Browser Revamp

## Tasks
- **pr5-remove-link-button** — Deleted chain-link button JSX, `handleLinkAndOpen` handler, and now-unused imports (`useSessionStore`, `useTabsStore`, `linkFile`) from `PseudoFileTree.tsx`. Hover prefetch preserved.
- **pr7-edge-cases** — `fetchCodeFile` accepts `allowLarge?: boolean` (appends `&allowLarge=1`). `CodeFileView` adds: `allowLarge` state + "Fetch anyway" button on truncated text; drift badge ("stale") on Prose toggle when `mtimeMs > syncedAt + 1d`.
- **pr8-perf-bus** — New `ui/src/lib/perf-bus.ts` exports `PerfMark` union + `mark()` + `measureBetween()` with safe `performance.mark` guards. Wired into `CodeFileView` (`code-fetch-start/end`, `code-first-paint` via useLayoutEffect+rAF, `prose-toggle`, `prose-mounted` beacon) and `PseudoFileTree` (`code-click`).

## Verification
- `tsc --noEmit`: 0 errors from changed files.
- All expected markers confirmed via grep.
- All 3 tasks marked completed.

## Blueprint Status
All 14 tasks across 4 waves complete. Run /vibe-review next.
