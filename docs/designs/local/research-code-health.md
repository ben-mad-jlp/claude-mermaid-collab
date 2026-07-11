# Code-Health Audit — mermaid-collab @ 5.73.1

Fresh-eyes audit after the native-app / one-server-per-machine burst. Read-only. Evidence is `file:line`; effort is S(<1h) / M(half-day) / L(1+ day).

## Top 5 things I'd do

1. **Delete the orphaned `browser_*` WS receiver path** in `src/websocket/handler.ts:174-189` + the dead browser-request machinery in `src/services/ide-state.ts`. The only sender of `browser_ready/response/debug/cdp_tunnel/error` was the now-deleted VSCode extension. These branches are also the source of the 5 `TS2367` "no overlap" errors. (S)
2. **Decide the fate of the IDE bridge.** `ide_open_diff / ide_reattach / ide_focus_terminal / ide_open_terminal` are broadcast by the server but have **zero receivers** in `ui/` or `desktop/` — only the deleted extension consumed them. The IDE feature is now half-live (status/tmux/create-terminal still used by the UI). Either re-home the receivers into the desktop app or strip the dead broadcasts. (M)
3. **Remove the superseded `createBrowserPane`** (`desktop/src/main/browser-pane.ts:148`) — exported, zero callers; `BrowserPaneManager` (class `ln`) replaced it. (S)
4. **De-dup the 3 copies of tmux-naming + the marker + the Instance type.** (S–M)
5. **Fix the build/typecheck story + gitignore the new artifacts.** 69 `tsc` errors in `src/`, 48 in `ui/`; `build:ui` is vite-only (no tsc gate); `.collab/*.db`, `scratch/`, `*.vsix`, `docs/designs/` are untracked and ungitignored. (M)

---

## 1. Refactor opportunities

### 1a. `tmuxBaseName` duplicated in 3 places (server + UI)  — effort S
- Canonical: `src/services/tmux-naming.ts` `tmuxBaseName(project, session)` (exported `n`).
- UI re-implements byte-for-byte: `ui/src/components/layout/SubscriptionsPanel.tsx:119-121` (`slug` + `mc-${slug(basename)}-${slug(session)}`). Server/UI drift here = tmux session mismatch.
- Server itself imports it correctly in `src/routes/ide-routes.ts`, `src/routes/api.ts`, `src/services/ide-state.ts`.
- **Rec:** extract a shared, tested helper that the UI imports (or ship the derived name from the server so the UI never recomputes). The caveat in the doc comment (same-basename collision) is worth a follow-up but is pre-existing.

### 1b. `Instance` type replicated in the desktop package — effort S (low value)
- `src/services/instance-discovery.ts:9-18` vs `desktop/src/main/connection-store.ts:7-16` (an explicit comment acknowledges the copy: "replicated, not imported — separate package").
- **Rec:** acceptable as-is given the package boundary; if you want a single source, publish a tiny shared `@mermaid-collab/instance-schema` types module. Low priority — flagging for awareness, not action.

### 1c. `ELECTRON_VIEW_MARKER = 'mc-browser-pane'` defined twice — effort S
- `src/services/cdp-session.ts` and `desktop/src/main/browser-pane.ts`. The string is the contract that keeps CDP target-selection and pane creation in sync; a silent drift breaks embedded-browser control.
- **Rec:** same package-boundary tradeoff as 1b. At minimum add a cross-reference comment in both (cdp-session already has a good doc comment; browser-pane should point back to it).

### 1d. `ide-state.ts` mixes two unrelated responsibilities — effort M
- It owns (a) the still-live IDE reattach/diff/terminal binding logic AND (b) the now-dead browser-request promise registry (`browserPending`, `waitForBrowserResponse`, `cdpTunnels`, `setCdpTunnel/getCdpTunnel`, `resolveBrowserRequest`). See `src/services/ide-state.ts:6-9, 16-17, 176-205`.
- **Rec:** once finding 1 lands, the whole browser half deletes cleanly, leaving a focused IdeState.

## 2. Dead / orphaned code

### 2a. `browser_*` WS receivers — fully orphaned — effort S
- `src/websocket/handler.ts:174-189` handles `browser_ready / browser_response / browser_debug / browser_cdp_tunnel / browser_error`. A repo-wide grep finds **no sender** of any of these in `src/`, `ui/`, `desktop/`, or `extensions/` (the deleted extension was the only sender).
- Knock-on: these branches cause `TS2367` because the inbound message union (`handler.ts:80-91`) no longer contains those types.
- Orphaned support code they reach: `ide-state.ts` `resolveBrowserRequest`, `setCdpTunnel`, plus `waitForBrowserResponse`/`getCdpTunnel` which have **no callers at all**.
- **Rec:** delete the 5 branches + the browser-request registry. Server-owned Chrome is now driven via `cdp-session.ts` (`setElectronTarget` / `selectElectronViewTarget`) — a separate, live path. (S)

### 2b. Dangling IDE broadcasts — no receiver — effort M
- Server still sends `ide_open_diff` (`ide-routes.ts` open-diff + `ide-state.ts:147`), `ide_reattach` (`ide-state.ts:79`), `ide_focus_terminal` (`ide-routes.ts:43`), `ide_open_terminal` (`ide-routes.ts:72`). No `ui/` or `desktop/` code subscribes to / handles these (only `ide_status` is handled, `ui/src/App.tsx:972`).
- Still-live IDE surface the UI uses: `/api/ide/status` (`App.tsx:424`), `/api/ide/tmux-sessions` + `/api/ide/create-terminal` (`SubscriptionsPanel.tsx:130,184,258,395`).
- **Rec:** this is the murkiest area. Confirm intent: if the desktop terminal column is meant to replace the extension's terminal/diff handling, port the receivers; otherwise strip the four dead broadcasts and the `diffOpened`/`refireOpenDiffs`/binding-reattach machinery. Don't delete blindly — `create-terminal`/`tmux-sessions` are genuinely used.

### 2c. `createBrowserPane` superseded — effort S
- `desktop/src/main/browser-pane.ts:148` — exported single-pane factory, zero callers. `BrowserPaneManager` (class `ln`) is what `index.ts` and `desktop-control.ts` use.
- **Rec:** delete `createBrowserPane`.

### 2d. `discoveryImpl` supervisor seam — declared, never wired in prod — effort S
- `desktop/src/main/server-supervisor.ts:17` declares the `discoveryImpl` opt "Seam for the supervisor-instance-dedup task," but `start()` never calls it — only the tests pass it (`__tests__/server-supervisor.test.ts:94+`). The instance-dedup logic the seam was for is not present in `start()`.
- **Rec:** either implement the dedup (attach to an existing instance for the *same project/session* on a non-canonical port) or remove the unused opt + its tests so the API doesn't imply behavior that isn't there.

## 3. Out of place / inconsistencies

### 3a. Pre-existing `tsc` failures, both packages — effort M
- `src/` (`tsc -p tsconfig.json --noEmit`): **69 errors**. Two classes: (i) `TS5097` `.ts`-extension imports in `src/agent/__tests__/*` and `src/websocket/handler.ts:3` (`allowImportingTsExtensions` not enabled for this tsconfig — it runs fine under Bun but `tsc` rejects it); (ii) the 5 `handler.ts` `TS2367` from finding 2a; plus test-fixture type drift (`projector.*`, `permission-socket`).
- `ui/` (`tsc -p ui/tsconfig.json`): **48 errors** — Onboarding (`OnboardingDashboard/BrowseDashboard/TeamDashboard` reference `getTopics`/`getCategories`/`Category.topicCount` that don't exist on the API type), `RefObject<T|null>` mismatches (`DocumentEditor.legacy.tsx`, `useDesignCanvas.ts`), `allowtransparency` casing in `SubscriptionsPanel.tsx:49,67`, `SplitPane.tsx:117` layout-callback type.
- **Rec:** (i) flip the test tsconfig to `allowImportingTsExtensions`/`noEmit` so the `.ts`-import noise disappears; (ii) the `TS2367` clears with 2a; (iii) the UI Onboarding errors look like a real API/type drift — worth a focused pass. These are pre-existing, not introduced by this branch, but they mean **typecheck is not a usable gate right now.**

### 3b. `build:ui` is vite-only — no typecheck gate — effort S
- `desktop/package.json:12` `"build:ui": "cd ../ui && bunx vite build"`; root `package.json:14` `"build": "cd ui && bun run build"`. Neither runs `tsc`, so the 48 UI errors never block a build (this was an intentional unblock per commit `6d475e9`, but it's now load-bearing tech debt).
- **Rec:** restore a `tsc --noEmit` step (or `vite build` + separate `typecheck` CI job) once 3a is cleaned, so the type errors can't keep accumulating.

### 3c. Mixed module-extension import styles — effort S
- Same files mix `.ts`/`.js`/extensionless specifiers, e.g. `ide-routes.ts` imports `'../websocket/handler.ts'` and `'../services/ide-state.ts'` (`.ts`) but `'../services/tmux-naming.js'` (`.js`) in adjacent lines. `handler.ts:3` uses `.ts`.
- **Rec:** pick one convention (`.js` specifiers for NodeNext, or enable `allowImportingTsExtensions` everywhere) and lint it.

### 3d. Untracked repo-root clutter — effort S
- Untracked & **not gitignored**: `.collab/agent-checkpoints.db{,-shm,-wal}`, `.collab/agent-receipts.db`, `.collab/agent-sessions/`, `.collab/kodex/`, `.collab/pseudo/prose/`, `.collab/pseudo/.migrated*`, `.collab/todos.db{,-shm,-wal}`, `.collab/todos.json`; `scratch/`; `docs/designs/{e2e-test,snippet-enhancement,storybook-blend}/`; three `extensions/vscode/*.vsix` (1.0.15/1.0.16/1.0.22).
- `.gitignore` only covers `/.collab/sessions/`, `/.collab/pseudo/{cache,*.db-wal,*.db-shm}` — it misses all the above.
- **Rec:** add `.collab/*.db*`, `.collab/agent-sessions/`, `.collab/kodex/`, `.collab/pseudo/prose/`, `.collab/todos.*`, `scratch/`, `*.vsix`, and decide whether `docs/designs/` is meant to be tracked (if generated, ignore it). Stray `.vsix` build artifacts especially shouldn't sit in the tree.

## 4. Tech-debt / risk

### 4a. Idle self-shutdown can kill an MCP-only / hook-started server — effort M (risk: medium)
- `src/server.ts:469-474`: when `MERMAID_IDLE_SHUTDOWN_MS > 0` (default **600000ms**, `config.ts:127-128`), the server arms an idle timer immediately at startup ("cover startup gap before any client connects") and re-arms whenever WS connections hit 0 (`handler.ts setOnConnectionsChanged`). On timeout it `removeInstance()` + `process.exit(0)` (`server.ts:420-427`).
- Risk: a server started by Claude's SessionStart **hook** for MCP tool calls only (no browser WS client) has no WS connection, so it self-exits after 10 min mid-session. The supervisor's attach-or-start (`server-supervisor.ts:67-72`) re-spawns on next launch, but an in-flight MCP session loses its server. Idle is keyed purely on **WS** connections, not MCP/HTTP activity.
- **Rec:** either (a) count MCP/HTTP activity toward "not idle," or (b) have the plugin hook set `MERMAID_IDLE_SHUTDOWN_MS=0`, or (c) only arm idle when the server was app-spawned. Verify the hook's env today.

### 4b. attach-or-start races on the canonical port — effort S (risk: low-medium)
- `server-supervisor.ts:67-72` probes `/api/health` then falls through to spawn on the same fixed port. Two app launches (or app + hook) in the health-probe window both try to bind `:9002`; the loser dies in `waitForHealth` after 25s (`server.ts` exit on bind failure / `HEALTH_TIMEOUT_MS`). No lockfile guards the spawn.
- **Rec:** a short advisory lock around probe+spawn, or treat EADDRINUSE as "someone else won, re-probe and attach."

### 4c. Deferred / missing tests — effort M
- No `browser-pane` test in `desktop/src/main/__tests__/` (only connection-store, desktop-control, server-proxy, server-supervisor, watch-aggregator) — `BrowserPaneManager` (the load-bearing multi-tab WebContentsView class) is **untested**.
- `SubscriptionsPanel.drive` and the multi-tab pane manager were called out as deferred in the task brief.
- **Rec:** add coverage for `BrowserPaneManager` tab lifecycle (create/switch/close/marker-title) since `cdp-session.selectElectronViewTarget` depends on the marker contract it produces.

### 4d. `forgotten` guard — actually live (not dormant) — note only
- Contrary to the brief, `connection-store.ts` `forgotten` is wired end-to-end: persisted (`:74,76,218`), populated on forget (`:123`), and enforced in `refreshLocal` (`:170` skips re-adding forgotten local servers). No action — flagging that it's working as intended.
