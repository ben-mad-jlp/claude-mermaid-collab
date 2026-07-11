# Vibe: bugfixes

## Goal
macOS CDP/session-watching fixes, one-click-collab-launch, archive_by_prefix correctness, VS Code collab-button + open-diff UX, todo↔blueprint linking, and tmux session project-scoping.

## Pair Mode
Disabled

## Status
- one-click-collab-launch merged to master (5.70.0).
- todos↔blueprint linking: executed + committed (df5ac1d).
- tmux session project-scoping: executed, reviewed (0 gaps, 0 new bugs), archived (Archive/tmux-project-scoping).

## Currently Doing
- FIX (uncommitted): "console fails after computer restart". Root cause = GUI/login-item relaunch of Mermaid Collab.app gives the sidecar a minimal PATH (no /opt/homebrew/bin), so `mc-server` can't find the Homebrew-only `tmux` binary → terminal opens dead, while the API still returned fake success.
  - desktop/src/main/server-supervisor.ts: added resolveLoginPath() (runs `$SHELL -ilc` to source the real login PATH, merges common bin dirs as backstop; win32 no-op; memoized) and set env.PATH on sidecar spawn. + tests desktop/src/main/__tests__/resolve-login-path.test.ts (pass).
  - src/services/tmux-availability.ts (new): isTmuxAvailable() + TMUX_UNAVAILABLE_MESSAGE.
  - src/routes/api.ts POST /api/terminal/sessions: returns 503 {code:'tmux-unavailable'} when tmux missing (was silent fake-success).
  - src/routes/ide-routes.ts: use shared isTmuxAvailable().
  - ui/src/stores/terminalStore.ts openFor: checks res.ok/data.id, shows error toast (tmux-unavailable → "Terminal unavailable"). Test mock updated to include ok/status.
  - Verified: root+ui tsc clean, desktop electron-vite build clean, terminalStore tests pass. Pre-existing unrelated failures remain in server-supervisor.test.ts (5), sessionStore/agentStore (4).
  - SHIPPED v5.74.3 (commit pushed), unsigned local desktop build installed to /Applications, verified end-to-end on GUI-launched app: /api/ide/create-terminal → {"tmux":true}, real tmux session created.
- FOLLOW-ON FIX v5.74.4 (23a2ea5, pushed): session terminal opened in the server's cwd (app Resources dir), not the project — because /api/ide/create-terminal ran `tmux new-session` with no working dir and won the race vs /api/terminal/sessions (which only attached). Fix: pass project dir to `tmux new-session -c` in BOTH paths (src/routes/ide-routes.ts + buildTmuxAttachCommand in src/terminal/PTYManager.ts, cwd param threaded from create()). + tests src/terminal/__tests__/PTYManager.tmux.test.ts.
  - Rebuilt sidecar + repackaged + reinstalled to /Applications. Verified on live GUI app: pane_current_path = project dir, `command -v claude` → ~/.local/bin/claude, pwd = project. Sessions now open in the right folder with claude/git on PATH.
  - Build cmd used: `cd desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:sidecar && npx electron-builder --dir`, then rsync dist/mac-arm64/*.app over /Applications. Unsigned local build (fine for self-use; full `npm run dist` w/ Apple creds needed to distribute).
