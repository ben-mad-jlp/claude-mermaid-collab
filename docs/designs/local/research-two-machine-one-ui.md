# Two Machines, One Collab UI / One VSCodium Window

Goal: projects on the **local machine** AND a separate **dev machine**, both visible in the **same collab UI** and usable inside the **same VSCodium window**. Target topology: one server per machine (co-located with that machine's code), one aggregating UI/editor.

## TL;DR

The co-location model from the prior research (`research-remote-collab-topology`) is correct and unchanged: each machine must run its own server next to its own code. The new question is **aggregation across two such servers in one UI**. The honest answer:

- **The plumbing for "many servers, one VS Code window" largely exists** — instance discovery, PORT=0, the workspace/ui split, and `vscode.workspace.openTunnel` already support **N instances → N tunnels** from a single UI host.
- **But two hard single-instance bindings block "one UI showing both machines":**
  1. **The instance registry is filesystem-local** (`~/.mermaid-collab/instances` on each machine). The UI host only ever sees instances from machines that share its `$HOME` (itself + Remote-SSH workspace hosts it's attached to). A truly separate dev machine's instances are invisible.
  2. **The web UI is hard-bound to a single origin.** It derives the WebSocket URL from `window.location.host` and uses relative `/api/...` paths (`API_BASE = ''`). It opens **one** browser tab against **one** server. There is no in-app server switcher or session federation. So even with two tunnels, you get two separate browser tabs/origins, not one aggregated list.

`list_sessions` / `/api/sessions` and `/api/projects` are each scoped to a **single server's** `~/.mermaid-collab/sessions.json` and `projects.json` (`src/services/session-registry.ts:16-17`, `src/services/project-registry.ts:16-17`). One server cannot see the other's sessions.

---

## 1. Instance registry & discovery

`src/services/instance-discovery.ts`:

- `interface Instance` (lines 9-18): `{ version, sessionId, port, project, session, pid, startedAt, serverVersion }`. **No host field** — `port` only, implicitly `127.0.0.1` on whatever machine reads the file.
- `getDiscoveryPaths()` (35-44): root is `join(homedir(), '.mermaid-collab')`, instances under `<root>/instances/<sessionId>.json`. **Strictly per-machine / per-$HOME filesystem.**
- `deriveSessionId()` (47-49): `sha1(project + '\0' + session).slice(0,12)`.
- `writeInstance` / `readInstances` / `findInstance` (52-191): pure local-fs operations with `proper-lockfile`. `readInstances` GCs records whose `pid` is dead via `process.kill(pid, 0)` — **only meaningful on the same machine as the server** (a remote pid would always appear "dead" or collide).

There is **no host/address in the record and no concept of a remote registry**. Discovery assumes "the discovering process shares a filesystem with the server." That holds for: same machine, or a VS Code Remote-SSH workspace host the UI half is attached to (the workspace half forwards instance events over RPC). It does **not** hold for an independent second machine.

## 2. Can the UI show multiple instances at once?

No — the web UI is single-origin:

- `ui/src/lib/websocket.ts:395-404` `getDefaultWebSocketURL()` → `${protocol}//${window.location.host}/ws`. The socket origin is whatever host served the page.
- `ui/src/lib/api.ts` — all calls are relative: `fetch('/api/sessions')`, `/api/projects`, etc.
- `ui/src/lib/projects-api.ts:11` and `ui/src/lib/pseudo-api.ts:18`: `const API_BASE = ''; // Use relative URLs (same host)`.
- `ui/src/lib/onboarding-api.ts:101`: `new URL('/api/onboarding'+path, window.location.origin)`.

There is **no serverUrl/base-URL switcher, no multi-instance list, no session-aggregation layer** anywhere in `ui/`. The UI is one SPA talking to one backend that served it. "Switching machines" today means opening a different URL/tab.

The only multi-instance awareness lives in the **VS Code extension**, not the web app.

## 3. VS Code extension multi-instance

`extensions/vscode/src/ui-half.ts` + `workspace-half.ts`:

- **The UI half can manage MANY tunnels.** `tunnelsBySessionId = new Map<string, …>()` (ui-half.ts:74). `mermaidCollab.ui.onInstanceUp` (532-592) opens **one `vscode.workspace.openTunnel` per sessionId** and tracks them in that map; `onInstanceDown` (596-608) disposes per sessionId. The local rescan loop (629-686) iterates **all** instances from `readLocalInstances()` and calls `onInstanceUp` for each. So N servers on the reachable filesystem ⇒ N tunnels. This is genuinely multi-instance.
- **But it collapses to a single `serverUrl`.** On every `onInstanceUp` it overwrites the workspace setting `mermaidCollab.serverUrl` = `ws://127.0.0.1:<localPort>/ws` (579-580). With multiple instances the **last writer wins** — there is no per-instance UI state, no picker. `mermaidCollab.openUi` (612-626) opens `http://127.0.0.1:<localPort>` for a single port. So the editor can *tunnel* many but only *surface* one in the browser at a time.
- **Local vs remote split** (ui-half.ts:507): `vscode.env.remoteName` ⇒ `startCollabServerRemote` (RPC to workspace half) else `startCollabServerLocal` (spawns locally). `workspace-half.ts` watches `~/.mermaid-collab/instances` **on the workspace host** and RPCs `mermaidCollab.ui.onInstanceUp` to the UI half — this is the existing cross-machine bridge, but **only for the one Remote-SSH host the window is attached to**.
- **Can one VSCodium window tunnel to local + remote-dev server simultaneously?** Mechanically the tunnel map supports it, **but the discovery feeding it is the blocker**: the UI half only scans its own `$HOME` (629-686); the workspace half only scans the attached Remote-SSH host's `$HOME`. A standalone second dev machine that the window is *not* Remote-SSH-attached to never produces `onInstanceUp` events. And even if it did, `serverUrl`/`openUi` are single-valued.

What's hard-bound to a single instance: `mermaidCollab.serverUrl` (one string), `openUi` (one port), and discovery being `$HOME`-local per host.

## 4. Cross-machine registry sync

Nothing in-tree syncs or federates the registry across independent machines:

- `instance-discovery.ts`, `workspace-half.ts:19` (`INSTANCES_DIR`), and `ui-half.ts:38` (`readLocalInstances`) all hardcode `path.join(os.homedir(), '.mermaid-collab', 'instances')`.
- No record carries a host; `openTunnel`/`process.kill(pid,0)` assume `127.0.0.1` + local pids.
- **Reusable precedent:** `ui-half.ts:351-452` `startChromeDebug()` spawns a raw `ssh` tunnel for the Chrome CDP port (`spawn('ssh', ['-R', `${port}:127.0.0.1:${port}`, '-N', …, sshTarget])`, config `mermaidCollab.sshTunnelTarget`), with stderr capture + disconnect handling (438-446). This is the in-tree pattern to copy for forwarding a remote collab server's port.

To make a remote machine's instance visible you must **manually bridge it**: forward the remote server's port to a local port, then make a local instance record (or a UI server entry) point at it. No code does this today.

## 5. Session list aggregation

`/api/sessions` (`src/routes/api.ts:200-211`) → `sessionRegistry.list()`, reading **this server's** `~/.mermaid-collab/sessions.json` (`session-registry.ts:16-17`). `/api/projects` (api.ts:300) → `~/.mermaid-collab/projects.json` (`project-registry.ts:16-17`). Each server reports only the sessions/projects registered against **its own** machine. To show both machines' sessions in one list you need **one of**:

- a **federation/proxy** server that fans `list_sessions`/`/api/projects`/artifact reads out to both backends and merges results (and proxies WS), or
- the **UI querying multiple base URLs** and merging client-side (today it's single-origin), or
- a **shared/synced registry** plus port reachability for every advertised instance.

---

## Assessment

### (a) What already works toward "two machines, one UI/VSCodium"
- Co-location model is sound: each machine runs its own server next to its own code (git/pseudo/agents/artifacts all work locally).
- Server binds `0.0.0.0` (prior research) — network-reachable as-is.
- Instance discovery + PORT=0 + the ui-half tunnel **Map** already support **N instances → N tunnels from one VS Code window**.
- A working `ssh` port-forward pattern exists in-tree (`startChromeDebug`, `mermaidCollab.sshTunnelTarget`).
- The workspace/ui split already bridges instance events from **one** Remote-SSH host into the UI window.

### (b) Specific gaps (single-instance/origin/registry bindings)
1. **Web UI single-origin**: `websocket.ts:395-404` (`window.location.host`), `api.ts` relative paths, `API_BASE=''` (`projects-api.ts:11`, `pseudo-api.ts:18`). No server switcher / no client-side federation.
2. **Extension collapses to one server**: `mermaidCollab.serverUrl` and `openUi` are single-valued (ui-half.ts:579-580, 612-626) despite the multi-tunnel map.
3. **Registry is $HOME-local, host-less**: `Instance` has no host field; discovery dirs hardcoded to local `~/.mermaid-collab/instances`; pid-liveness assumes local pids. No remote/federated registry.
4. **API scoped to one server's registries**: `/api/sessions`, `/api/projects` read this machine's `sessions.json`/`projects.json` only — no cross-server merge.

### (c) Viable approaches

**Approach 1 — SSH-forward the remote server + register a synthetic local instance (lowest effort, leverages existing multi-tunnel UI).**
- On the dev machine: run a server in its repo (`PORT=0`), note its port.
- From the local machine: `ssh -L <Lport>:127.0.0.1:<remotePort> devhost` (mirror `startChromeDebug`'s ssh spawn).
- Write a **synthetic instance JSON** into the local `~/.mermaid-collab/instances/` describing the remote project/session but with `port=<Lport>` (and a sentinel pid that won't be GC'd).
- Tradeoffs: reuses ui-half's existing N-tunnel + rescan path with near-zero new logic. **But** still doesn't merge two servers into one list — you'd get two tabs/contexts. The `readInstances` pid-liveness GC (`instance-discovery.ts:130-143`) and `ui-half.ts:55-57` will delete a record whose pid isn't a live local process — needs a "remote/no-gc" flag on the `Instance` schema. Changes: `src/services/instance-discovery.ts` (host + remote/no-gc fields, skip pid GC for remote), `extensions/vscode/src/ui-half.ts` (an ssh-forward command + synthetic-instance writer, analogous to `startChromeDebug`), `workspace-half.ts` (optional symmetry).

**Approach 2 — Federation/aggregator server (best UX: genuinely one UI, one list).**
- Stand up a thin aggregator that holds a list of backend base URLs (local + dev, the dev one via `ssh -L`). It fans out `/api/sessions`, `/api/projects`, and artifact reads to each backend, tags results with an origin, merges, and proxies the per-artifact calls + `/ws` to the owning backend.
- The web UI stays single-origin (it talks to the aggregator), so **no UI rewrite for base URL** — only optional origin badges. The aggregator owns routing by `project` (each `project` path is unique to a machine).
- Tradeoffs: most work, but the only approach that yields a true single aggregated UI and one VSCodium tab. Changes: a new `src/routes/federation.ts` (or standalone proxy) + a registry of remote base URLs; WS proxying; UI optionally tags sessions by origin in `ui/src/lib/api.ts`. The dev backend still reached via the existing `ssh -L` pattern.

**Approach 3 — In-UI multi-server switcher (medium effort, no aggregation).**
- Introduce a runtime-configurable server base URL in the UI: replace `API_BASE=''` / relative fetches with a `getApiBase()` + parameterized WS URL (`websocket.ts:getDefaultWebSocketURL`), backed by a server-list dropdown persisted in localStorage; each entry is a tunneled base URL.
- Tradeoffs: lets one browser/VSCodium webview switch between the two machines without re-tunneling, but it's **switch, not merge** (one list at a time). Touches many files: `ui/src/lib/api.ts`, `projects-api.ts`, `pseudo-api.ts`, `onboarding-api.ts`, `websocket.ts`, plus a server-picker component and the extension to register both tunnels' URLs instead of overwriting `serverUrl`.

### Recommendation
- **Fastest usable result:** Approach 1 (ssh -L + synthetic instance with a `host`/`noGc` flag on the `Instance` schema) — reuses the already-multi-tunnel ui-half with minimal change. Accept that it's two contexts, not a merged list.
- **Best end state for "both machines in the SAME UI list":** Approach 2 (federation/aggregator), because the UI's hard single-origin binding then becomes a feature (UI talks only to the aggregator) instead of a blocker, avoiding a sweeping `ui/` refactor.
- Either way, the **`Instance` schema needs a `host` field and a remote/no-GC marker** (`src/services/instance-discovery.ts`), and the remote server is reached via the existing in-tree `ssh -L` precedent in `extensions/vscode/src/ui-half.ts`.
