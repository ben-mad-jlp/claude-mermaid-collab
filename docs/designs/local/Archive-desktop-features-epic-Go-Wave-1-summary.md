# Wave 1 Implementation

## Tasks
- **text-size** — `ui/src/App.tsx`: new `useEffect([zoomLevel])` sets `documentElement.style.fontSize = (16*zoomLevel/100)px` + guarded `(window.mc as any)?.setZoomFactor?.(zoomLevel/100)`, after the theme effect; reuses existing zoomLevel destructure. `ui/src/components/layout/Header.tsx`: imported `useUIStore`; added −/`{zoomLevel}%`/+ control group (zoomOut/zoomIn) before the theme toggle; HeaderProps unchanged.
- **pty-tmux** — `src/terminal/PTYManager.ts`: `CreateOptions.tmux?: {base,grouped}`; `create()` tmux branch spawns `/bin/sh -c "(tmux has-session -t '<grouped>' || tmux new-session -d -s '<grouped>' -t '<base>') && tmux attach-session -t '<grouped>'"` with identical terminal-callback wiring; raw-shell else-path + `attach()` untouched. `src/routes/api.ts`: `POST /api/terminal/sessions` now derives `base=tmuxBaseName(project,session)`, `grouped=vscode-collab-<base>`, passes `tmux:{base,grouped}` to create(), returns `tmuxSession: grouped`. (Research found `websocket.ts` needs no change — opts thread through the create endpoint.)
- **browser-pane-manager** — `desktop/src/main/browser-pane.ts`: added `BrowserPaneManager` (Rect/TabKind/PaneTab/TabInfo, `markerPage()`, methods ensureSessionTab[idempotent via sessionIndex+inFlight]/openUserTab/closeTab/activateTab/setBounds/navigate/listTabs), `crypto.randomUUID()` (no uuid dep), per-session marker `mc-browser-pane:<session>` + user marker `mc-browser-pane:user:<uuid>`; existing exports intact. `desktop/src/preload/index.ts`: `mc.setZoomFactor` + `mc.browser.*` bridge.

## Verification
All 6 files: semantic review PASS + scoped tsc clean.
- App.tsx, Header.tsx — no errors referencing the file (ui package has known pre-existing unrelated errors elsewhere).
- PTYManager.ts — clean; tmux command string + callback wiring confirmed identical to raw path.
- api.ts — clean except the KNOWN pre-existing line ~693 (pair_mode_changed), unrelated.
- browser-pane.ts, preload/index.ts — clean (new desktop code).

## Wave TSC
Wave-1 files clean. Remaining repo tsc errors are pre-existing/unrelated: `../src/agent/__tests__/*` (`.ts` import-extension TS5097 + permission-socket mock typings) and api.ts:693 — all predate this wave.
