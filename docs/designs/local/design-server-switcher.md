# Design: Server Switcher UI

Sub-design of [[design-native-app]]. Lets one native-app window connect to multiple co-located server+code+Claude units (one per machine) — switching between them, or eventually viewing them side by side.

## UI sketch

### A. Switcher in the title/sidebar (single active server)

```
┌──────────────────────────────────────────────────────────────┐
│  mermaid-collab        [ ▾ machine-1 : project-a ]    ● ⚙︎    │  ← active server pill (dropdown)
├────────────┬─────────────────────────────────────────────────┤
│ SERVERS    │                                                  │
│            │                                                  │
│ ● This Mac │     (collab UI for the ACTIVE server:            │
│   project-a│      diagrams / docs / designs / terminal /      │
│            │      browser pane — unchanged)                   │
│ ● machine-1│                                                  │
│   project-b│                                                  │
│            │                                                  │
│ ○ vps-box  │                                                  │
│   (offline)│                                                  │
│            │                                                  │
│ + Add ...  │                                                  │
└────────────┴─────────────────────────────────────────────────┘
   ● online   ○ offline   ◌ connecting
```

### B. Active-server dropdown (expanded)

```
┌─ machine-1 : project-b ──────────────┐
│ ● This Mac        localhost:9002      │  ← bundled server, auto
│ ● machine-1       192.168.1.20:9002   │  ← active (check)  ✓
│ ◌ machine-1       192.168.1.20:9003   │     project-c (connecting)
│ ○ vps-box         10.0.0.5:9002       │     (offline — Retry)
│ ──────────────────────────────────── │
│ + Add server…                         │
│ ⚙ Manage servers…                     │
└───────────────────────────────────────┘
```

### C. Add / edit server dialog

```
┌─ Add server ───────────────────────────────┐
│ Label     [ machine-1                     ] │
│ Host      [ 192.168.1.20                  ] │
│ Port      [ 9002                          ] │
│ Token     [ •••••••••••••           ] (opt) │  ← auth (new; none today)
│ ──────────────────────────────────────────  │
│ Status:   ● reachable — project-b, 3 sessions│  ← live probe on type
│                                              │
│              [ Cancel ]   [ Save & Connect ] │
└──────────────────────────────────────────────┘
```

### D. Optional: tabbed multi-server (side-by-side / federation — later)

```
┌────────────────────────────────────────────────────────┐
│ [ This Mac ✕ ] [ machine-1 ✕ ] [ + ]                    │  ← one tab per server
├────────────────────────────────────────────────────────┤
│   collab UI for the selected tab's server                │
└────────────────────────────────────────────────────────┘
```

## What it needs (technical requirements)

### 1. Origin becomes a runtime value (the core change)
Today the origin is hardcoded as single-origin in every API module. All of these must read from one **`ServerContext`** (active `{ baseUrl, wsUrl, token }`) instead:
- `ui/src/lib/pseudo-api.ts` — `API_BASE = ''`
- `ui/src/lib/projects-api.ts` — `API_BASE = ''`
- `ui/src/lib/onboarding-api.ts` — `new URL(path, window.location.origin)`
- `ui/src/lib/websocket.ts` — URL from `window.location.host`; **singleton `sharedClient`** must tear down + rebuild on switch
- any other `fetch('/api/...')` call sites (audit needed)

A small `fetch` wrapper + WS factory that inject the active server's base/token is the clean shape.

### 2. Connection store (persisted)
List of saved servers: `{ id, label, host, port, token?, status, lastProject, lastSession }`. Persist in app config (Electron `userData`) or `localStorage`. Tracks `online | offline | connecting` via health probe.

### 3. Switch lifecycle
On switch: close the active WS, swap `ServerContext`, reconnect WS, refetch session/project list, remount the collab views. Must be clean — no stale subscriptions leaking from the previous server.

### 4. Auth (new work — none exists today)
Remote servers over `0.0.0.0` need a per-server token/PIN (sent as header or query param). Ties to the auth item already flagged in [[design-native-app]]. The bundled "This Mac" server can stay token-less on `127.0.0.1`.

### 5. Cross-origin reachability
Talking to a remote server is cross-origin. Two options:
- **Server sends CORS headers** (`Access-Control-Allow-Origin`) + WS accepts the app origin. Simplest server-side change.
- **Electron main proxies** all server traffic via a custom `app://` protocol → no CORS, avoids macOS loopback consent popups (the renderer↔server boundary item in [[design-native-app]]). Preferred for the native app.

### 6. Discovery (auto vs manual)
- **Local**: read the instance registry (`~/.mermaid-collab/instances/*.json`) to auto-populate servers running on this machine → "This Mac" entries appear automatically.
- **Remote**: manual host:port entry. There is **no cross-machine discovery** today (instance records have no host field — see [[design-native-app]]). Auto-discovery across machines would be a separate feature (mDNS / a registry service).

### 7. Health probe
Reuse `GET /api/health` per saved server to drive the status dots; poll on an interval + on-demand "Retry".

## Scope ladder

| Level | Capability | New work |
|-------|-----------|----------|
| 0 (today) | One window = one server (single origin) | — |
| 1 | **Switch** active server (one at a time) | ServerContext + connection store + auth + CORS/proxy |
| 2 | Saved servers + auto-list local instances | discovery from registry |
| 3 | **Tabs** (multiple servers, switch instantly, state kept warm) | per-tab ServerContext + WS multiplexing |
| 4 | **Federation** (aggregate multiple servers in one view) | server-side host-aware model — the not-yet-built piece |

Level 1 is the minimum that delivers "connect to any machine's collab." Levels 3–4 are progressive enhancements.
