# Design — One Collab Server Per Machine (plugin + app share)

_Branch target: `feat/native-app-foundation`. Status: design. Source: user directive 2026-05-27 — "make the plugin and app share one server. we will distribute a new plugin and update." (So the plugin ships the repo's current server code — no version-skew concern.)_

## Context
Two independent things launch a collab server on this machine:
1. **The Claude Code plugin** — `hooks/server-check.sh` (a PreToolUse hook for `mcp__mermaid__*`) checks `http://localhost:9002/api/health` and, if nothing answers, runs `bun run src/server.ts` on **port 9002** (the canonical default). Single-instance via the health check. `.mcp.json` points the MCP tools at `localhost:9002/mcp`.
2. **The desktop app** — `ServerSupervisor` spawns its **own** `bun run src/server.ts` (dev) / compiled `mc-server` (prod) on an **ephemeral free port**, and supervises it.

→ Two servers, two codebases, no awareness of each other. The plugin already implements the desired "one canonical server, attach-if-up-else-start." The fix is to make the **app adopt the same convention** instead of spawning its own.

## Goal
**One collab server per machine on the canonical port (9002).** Whoever needs it first starts it; the other attaches. Both the plugin's MCP and the desktop app's UI talk to the same server.

## Current state (grounded)
| Piece | Today | File |
|------|-------|------|
| Plugin server lifecycle | health-check :9002 → start `bun run src/server.ts` if down (cwd = plugin root); 9002 default | `hooks/server-check.sh` |
| Canonical port | `PORT`/`PORT_REQUEST` default **9002** | `src/config.ts:25,76` |
| App supervisor | `getFreePort()` → spawn own sidecar; `checkExistingInstance` exists but **discoveryImpl is never wired** + it matches on project+session (won't match the plugin server) | `desktop/src/main/server-supervisor.ts`, `desktop/src/main/index.ts` |
| Instance registry | `~/.mermaid-collab/instances/*.json` (writeInstance/readInstances), keyed by sessionId(project,session) | `src/services/instance-discovery.ts`, `src/server.ts:412,436` |
| Embedded browser control | App spawns the sidecar with `CDP_PORT` + `MC_BROWSER_TARGET=electron-view` **as startup env** (server-supervisor.ts:111-114); `cdp-session` reads `MC_BROWSER_TARGET` to target the WebContentsView | `desktop/src/main/server-supervisor.ts`, `src/services/cdp-session.ts` |
| Desktop control | token-guarded loopback server in the app's main (`POST /panes/ensure`) | `desktop/src/main/desktop-control.ts` |

## Target model

### 1. App: attach-or-start on the canonical port (replaces ephemeral spawn)
`ServerSupervisor.start()` becomes:
1. `port = canonical (9002)` (configurable via `MERMAID_PORT`).
2. Health-check `http://127.0.0.1:9002/api/health`. **If healthy → attach** (`attached:true`, return 9002, spawn nothing).
3. Else **spawn on 9002** (`PORT=9002`), wait for health. (The plugin's hook will then find/attach to it too.)
4. **Lifecycle: idle self-shutdown (not persistent).** Neither launcher manages shutdown — the **server reaps itself when nothing is using it**. It tracks consumers (it already has the WS `connections` Set in `handler.ts`); when consumer count hits zero, it starts a grace timer (~10 min, `MERMAID_IDLE_SHUTDOWN_MS`, `0`/unset to disable). If still zero at expiry → clean exit (`removeInstance` + close). Any new WS connection cancels the timer. Safe because the plugin's `server-check.sh` PreToolUse hook **restarts it on the next MCP call**, and all state is on disk (`.collab/`, sqlite; tmux sessions persist independently and re-attach). So the app/plugin just "attach-or-start"; the server self-reaps.

This makes the app and the plugin symmetric: both = "use :9002 if up, else start it"; and the server is up **only while a UI / app / watcher is connected** (or briefly between tool calls), down otherwise.

### Idle-shutdown — what counts as a consumer
- **WS connections** (web UI tabs, the desktop app's renderer, terminal sockets, the watch-aggregator) — the keep-alive signal. Zero WS = idle candidate.
- Not gated on registered Claude sessions: there's no `SessionEnd` hook, so registrations would linger forever; instead rely on WS presence + hook-restart. A session active with **no** UI may let the server bounce between tool calls — harmless (hook restarts, disk state intact, no UI to miss broadcasts).
- Hysteresis: only the zero→nonzero→zero transition (re)arms the timer; avoid flapping with the ~10 min window.
- Edge: a watcher's WS keeps a watched server alive — acceptable (you're actively watching it).

### 2. Browser control: startup-env → RUNTIME registration (the hard part)
Problem: embedded-browser targeting depends on `MC_BROWSER_TARGET=electron-view`+`CDP_PORT` being set **when the server starts**. When the app **attaches** to a server the plugin started, those weren't set, so `browser_*` won't drive the WebContentsView.

Fix: let the app register its CDP target with the running server **at runtime**, instead of only via startup env.
- New server endpoint: `POST /api/browser/electron-target { cdpPort: number }` (loopback) → sets a process-level override that `cdp-session` consults (same precedence as the `MC_BROWSER_TARGET=electron-view` env, but settable at runtime). Clearing it (DELETE / app disconnect) reverts to default chrome mode.
- App calls it right after attach/spawn, passing its `cdpPort`.
- `cdp-session`: resolve target mode from `runtimeElectronTarget ?? env(MC_BROWSER_TARGET)` so both paths work.
- When the app spawns the server itself, it can still set the env (belt-and-suspenders) OR just always use the runtime call (single path — preferred).

### 3. Plugin update (out-of-repo coordination, but tracked here)
- `server-check.sh` is already correct (attach-or-start on 9002) — **no change needed**.
- The redistributed plugin bundles the repo's **current** `src/server.ts` (with the new `/api/browser/electron-target` endpoint), so plugin-started and app-started servers are identical code.
- Version bump + marketplace/plugin.json sync via `npm version` (per CLAUDE.md).

### 4. Identity / discovery
- The shared server registers ONE instance (its own project/session = whatever started it). The app no longer needs project/session-matched discovery — it just targets the canonical port + health check. (Discovery registry stays for the server-switcher's remote/multi list.)

## Waves (for blueprint)
- **W1:** `supervisor-attach-canonical` — ServerSupervisor: canonical-port attach-or-start, drop ephemeral spawn + before-quit stop of the shared server (desktop/src/main/server-supervisor.ts, index.ts). _Independent._
- **W1:** `server-electron-target-endpoint` — `POST/DELETE /api/browser/electron-target` + a runtime override module read by cdp-session (src/routes + src/services/cdp-session.ts). _Independent (server side)._
- **W1:** `server-idle-shutdown` — track WS consumer count (reuse handler.ts `connections`); arm a grace timer on zero, clean-exit (`removeInstance`+close) at expiry, cancel on new connection. Gated by `MERMAID_IDLE_SHUTDOWN_MS` (default ~10min; `0`=disabled). _Independent (server side)._
- **W2:** `cdp-session-runtime-target` — cdp-session resolves electron-view mode from runtime override ∪ env (←server-electron-target-endpoint).
- **W2:** `app-register-cdp-target` — app calls `POST /api/browser/electron-target {cdpPort}` after supervisor.start() (←supervisor-attach-canonical, server-electron-target-endpoint).
- **W3:** `version-bump-plugin-sync` — `npm version` bump so plugin.json/marketplace.json/server.ts SERVER_VERSION sync for redistribution.

## Risks / open details
- **Lifecycle:** server self-reaps on idle (above). Risks: flapping (mitigated by the ~10min grace + zero→nonzero hysteresis); a session active with no UI bouncing between tool calls (harmless — hook restarts, disk state intact); make idle-shutdown opt-out via `MERMAID_IDLE_SHUTDOWN_MS=0` for users who want a long-lived server.
- **Browser-target race:** the app must register its CDP target before any `browser_*` call drives the pane; ensure ordering (register in bootstrap after `app.whenReady` + cdpPort known, before loading UI). The control call is idempotent.
- **Multiple machines (remote):** unchanged — remote servers are still separate; the server-switcher + watch aggregator handle those.
- **Port conflict:** if something else holds 9002, attach-or-start fails — surface a clear error (configurable `MERMAID_PORT`).
- **In-flight this session:** the app currently has the embedded-pane + DesktopControl built around the spawn path; the runtime-registration must coexist with the existing `/panes/ensure` control server (they're complementary: DesktopControl = pane lifecycle; the new endpoint = CDP target mode).

## Verification
- Launch order A: plugin starts :9002 first → launch app → app attaches (logs "attached"), only ONE `bun src/server.ts` running; `browser_*` drives the pane (runtime target registered).
- Launch order B: app starts first → spawns :9002 → plugin hook finds it (health passes, doesn't start a second).
- Quit app → :9002 stays up (plugin still works).
- `scripts/debug-app.sh` + registry check: exactly one local instance on 9002.
