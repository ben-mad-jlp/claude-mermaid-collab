# Fix Wave Summary

## Issues Fixed
- **bug-important-single-instance-guard** (`desktop/src/main/index.ts`) — The single-instance lock called `app.quit()` but did not stop module execution, so `bootstrap()` ran on a losing second instance (appending the CDP switch and spawning a second sidecar/window before the async quit landed). Fix: wrapped `void bootstrap()` + the `before-quit` and `window-all-closed` registrations in `if (gotLock) { ... }` so only the primary instance boots and owns the sidecar.
- **bug-minor-webcontentsview-leak** (`desktop/src/main/index.ts`) — The embedded pane's `WebContentsView` was never released and `browserPane` was write-only. Fix: in `mainWindow`'s `closed` handler, `browserPane.view.webContents.close()` and null it out.

## Files Changed
- `desktop/src/main/index.ts` — both fixes (single-file). Verified by re-build + re-test.

## Verification
- `electron-vite build`: clean.
- Tests: 18/18 pass (server-supervisor 11, cdp-session.target 4, cdp-session.config 3).

## Note
Fixes applied inline rather than via the full research→implement→verify agent chain — both were small, single-file, and within full context. No completeness gaps to fix (review found 0). GUI runtime behavior remains a recommended manual check (`cd desktop && npm run dev`).

## Final TSC
clean (no errors in touched files)
