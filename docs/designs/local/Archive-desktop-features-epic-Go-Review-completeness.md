# Completeness Review — Desktop Feature Epic

Reviewed the uncommitted working tree against blueprint `Implementing-desktop-features-epic` and the three wave summaries.

**Verdict: Implementation is complete (all 8 tasks, all files, all function blueprints non-stub). The only gaps are MISSING TEST FILES — 7 of the 8 blueprint-listed test files were never created.**

## Tasks — all 8 implemented
| Task | Status |
|------|--------|
| text-size | DONE — App.tsx effect (fontSize + setZoomFactor), Header −/%/+ control |
| pty-tmux | DONE — PTYManager tmux branch + api.ts terminal endpoint plumbing |
| browser-pane-manager | DONE — BrowserPaneManager + preload mc.browser bridge |
| desktop-control-server | DONE — DesktopControl + supervisor env + index.ts wiring |
| terminal-column | DONE — terminalStore multi-tab + TerminalDrawer tab strip |
| browser-panel | DONE — browserStore + BrowserPanel (ResizeObserver→setBounds) |
| cdp-session-select | DONE — selectElectronViewTarget + ensureTab control call |
| watching-drive | DONE — SubscriptionsPanel row onClick drives browser+terminal |

## Files — all present, real implementations
All blueprint files exist and are non-stub, including the three NEW files:
- `desktop/src/main/desktop-control.ts` — real loopback http.Server, token-guarded POST /panes/ensure.
- `ui/src/stores/browserStore.ts` — real zustand mirror + activateSession.
- `ui/src/components/browser/BrowserPanel.tsx` — real tab strip + address bar + ResizeObserver bounds.

Note on WS plumbing: blueprint listed `src/routes/websocket.ts` for pty-tmux, but the tmux opts are actually threaded through `POST /api/terminal/sessions` in `src/routes/api.ts` (lines 3000-3058) via `ptyManager.create(id, { cwd, tmux:{base,grouped} })`. websocket.ts needs no change. This matches the Wave 1 summary's research note. Not a gap.

## Function Blueprints — all present & non-stub
- `BrowserPaneManager.ensureSessionTab/openUserTab/closeTab/activateTab/setBounds/navigate/listTabs` — all implemented (browser-pane.ts:51-126). ensureSessionTab is idempotent via sessionIndex + inFlight map.
- `DesktopControl POST /panes/ensure` — 401/400/404/500 paths, loopback bind (desktop-control.ts).
- `selectElectronViewTarget(tabs, session?)` — per-session marker match with exact bare-marker fallback (cdp-session.ts:29-55).
- `cdp-session.ensureTab` electron-view branch — POSTs /panes/ensure with Bearer token before CDP.List, try/catch surfaces actionable error (cdp-session.ts:239-268).
- `PTYManager.create` tmux mode — spawns `/bin/sh -c "(tmux has-session || new-session -d -t base) && attach"`, raw path untouched (PTYManager.ts:115-159).
- `terminalStore.openFor` — dedups by title===session, else POSTs and pushes tab (terminalStore.ts:46-65).
- `browserStore.activateSession` — refresh + find by session + activateTab (browserStore.ts:67-72).
- `BrowserPanel ResizeObserver→setBounds` — implemented, zeroes bounds on hide/unmount (BrowserPanel.tsx:40-68).
- text-size effect — App.tsx:1205-1208.
- SubscriptionsPanel click-to-drive — row onClick calls `activateSession` + `openFor` (SubscriptionsPanel.tsx:194-195).

## Tests — PRIMARY GAP
Ran `bunx vitest run src/services/__tests__/cdp-session.target.test.ts` → **7/7 pass.**

Of the 8 test files in the blueprint task graph, only 1 exists. **7 are missing:**
| Test file (specified) | Status |
|---|---|
| src/services/__tests__/cdp-session.target.test.ts | PRESENT (7/7 pass) |
| ui/src/stores/__tests__/uiStore.zoom.test.ts | MISSING |
| src/terminal/__tests__/PTYManager.tmux.test.ts | MISSING |
| desktop/src/main/__tests__/browser-pane.test.ts | MISSING |
| desktop/src/main/__tests__/desktop-control.test.ts | MISSING |
| ui/src/stores/__tests__/terminalStore.test.ts | MISSING |
| ui/src/stores/__tests__/browserStore.test.ts | MISSING |
| ui/src/components/layout/__tests__/SubscriptionsPanel.drive.test.ts | MISSING |

The blueprint specified explicit unit-test cases for nearly every function (idempotency, marker selection, tmux command string, openFor dedup, setBounds single-active, 401-on-wrong-token, click-drives-both). None of these are covered except cdp-session target selection. This is the substantive completeness gap.

## Stubs — none found
Grep for TODO / Not implemented / throw stub across all epic implementation files returned nothing relevant. (The only TODO is a pre-existing undo/redo placeholder in App.tsx, unrelated to this epic.)

## Acceptance — all 4 features satisfied by the implementation
1. Multi-tab browser with dedicated session tab — YES (BrowserPaneManager session/user tabs, marker `mc-browser-pane:<session>`, BrowserPanel UI, ensureSessionTab).
2. Tabbed tmux terminal — YES (PTYManager grouped-session attach, terminalStore multi-tab, TerminalDrawer strip).
3. Watching live-update + click-to-drive — YES (SubscriptionsPanel onClick → activateSession + openFor; WS live updates wired in App.tsx).
4. Global text size — YES (uiStore zoomLevel → App effect fontSize + electron setZoomFactor; Header control).

## Minor observations (not gaps)
- UI `tmuxBaseName` in SubscriptionsPanel.tsx (`mc-<base>-<session>`) is used only for the tmux-active green/red indicator, and differs from the server's `vscode-collab-<base>` grouped name. The click-to-drive `openFor` flow relies on the server-returned `tmuxSession`, so this does not break driving — but the indicator and the actual created session use different naming schemes, which could make the indicator inaccurate. Worth a glance but outside epic scope.
