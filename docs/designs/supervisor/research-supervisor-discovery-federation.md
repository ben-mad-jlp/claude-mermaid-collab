# Global Supervisor via Discovery-Based Federation — Design & Gap Memo

Option C: the supervisor's OWN server is the federation coordinator. It discovers peer servers via mDNS, opens WS client connections to each (like the desktop's watch-aggregator), and routes the supervisor's cross-machine ops. No hub, no desktop dependency, dynamic peer set.

---

## 0. Current state (what's HOST-LOCAL today — the gap)

- **Discovery is filesystem-only.** `src/services/instance-discovery.ts` writes/reads `~/.mermaid-collab/instances/<sessionId>.json` with `proper-lockfile` (instance-discovery.ts:35-44, :101-181). `sessionId = sha1(project+'\0'+session).slice(0,12)` (:47-49). Record = `{version, sessionId, port, project, session, pid, startedAt, serverVersion}` (:9-18). **No `serverId`, no host** — only works for same-machine servers sharing one home dir. The desktop replicates this notion to auto-discover *local* servers (connection-store.ts:6, :76); remote servers are **manually added** with a token (connection-store.ts:160-167).
- **Supervisor state is global but NOT serverId-keyed.** `supervisor.db` tables `supervised_session`, `attended_lock`, `escalation`, `supervisor_identity` are all keyed by `(project, session)` only (supervisor-store.ts:51-82). Collides across machines if two peers share a project path.
- **reconcile is local.** `supervisor_reconcile` iterates `supervisorStore.listWatchedProjects()` → `getStatuses(project)` from the LOCAL per-project session-status-store (setup.ts:3442-3452). Sees only this host's sessions.
- **read_last_assistant_turn is MCP-only + local.** `lastAssistantTurn(claudeSessionId)` reads a local transcript (setup.ts:3454-3457). No REST route.
- **nudge route exists, local.** `POST /api/ide/tmux-send-keys {project,session,text}` → `sendTmuxKeys` (ide-routes.ts:95-113).
- **push is local.** `POST /api/session-notify`: on a SUPERVISED worker transition to waiting/permission, it reads the LOCAL `getSupervisorIdentity()` and `sendTmuxKeys` into the supervisor's tmux on THE SAME host (api.ts:2441-2461). Cross-host workers never reach the supervisor.
- **Auth.** `src/auth.ts checkAuth`: if `MERMAID_AUTH_TOKEN` env is set, every HTTP+WS request needs `Authorization: Bearer <token>`; `/api/health` and `/mcp*` exempt; **if unset, fully open** (auth.ts:12-19, config.ts:109). The WS handler itself does NO auth (handler.ts) — the gate is purely the `checkAuth` call before `server.upgrade` (server.ts:231-243). Desktop passes the token via header on REST (index.ts:68, :95) and WS (watch-aggregator.ts:33). Per-server tokens are user-entered in the desktop and stored encrypted via Electron safeStorage (connection-store.ts:69-167). The desktop spawns its local sidecar with `MERMAID_AUTH_TOKEN` (server-supervisor.ts:88-90).

---

## 1. mDNS/Bonjour from Bun — recommendation

**No mDNS dependency exists today** (`bonjour`/`mdns`/`dns-sd` appear nowhere; the `publishDiscovery` in desktop index.ts:278 is the electron-agent-bridge CDP bridge, unrelated). Runtime deps are tiny (ulid, chokidar, mermaid, proper-lockfile, etc.) — no native addons in the server beyond the dev-only better-sqlite3 (server uses `bun:sqlite`).

**Recommendation: `bonjour-service` (pure-JS mDNS/DNS-SD over UDP multicast).**
- Pure JS → no node-gyp/native build; works under Bun (Bun supports `dgram`/UDP multicast, which is all bonjour-service needs). Avoid `mdns`/`mdns-js` (native/abandoned). Avoid shelling to `dns-sd` (macOS-only, fragile parsing, no clean browse-stop).
- **Advertise:** `bonjour.publish({ name: serverId, type: 'mermaid-collab', protocol: 'tcp', port, txt: { serverId, host, project, session, ver } })` → service `_mermaid-collab._tcp`.
- **Browse:** `bonjour.find({ type: 'mermaid-collab' })` → `up`/`down` events give `{ host, port, txt }`. Feed `up` into the peer-WS connect path; `down`/timeout into disconnect.
- Keep the existing filesystem instance-discovery for same-host servers (it's robust, handles stale PIDs); mDNS is the **cross-host** layer. A peer set = union(local FS instances, mDNS-discovered remote instances), deduped by serverId.

**Limitation to flag loudly:** mDNS multicast is **single-subnet only**. It will NOT cross routed subnets or most VPNs (no multicast forwarding). The user's two machines (`127.0.0.1:9002` local, `trimaxion 192.168.1.123:9002`) are same-LAN → fine. For future cross-subnet/VPN, need a fallback: a static peer list in config/env (`MC_FEDERATION_PEERS=host:port,...`) OR a unicast DNS-SD registry. Build mDNS now, but make the peer source pluggable so a static list can be added without rework.

---

## 2. Server-as-WS-client to peers — recommendation

The desktop's `WatchAggregator` (watch-aggregator.ts) is the exact pattern to port server-side: `setWatched(servers[])` diffs the desired peer set against live connections, connects new ones, disconnects removed ones (:16-20); per-conn exponential backoff reconnect capped at 15s (:43-49), resets on `open` (:37); forwards only `claude_session_registered|claude_session_status|claude_context_update` events, tagging each with `serverId` (:6, :38). It connects with `new WebSocket('ws://host:port/ws', {headers:{authorization:'Bearer '+token}})` (:33).

- **WS client in Bun:** Bun ships a WHATWG `WebSocket` global (`new WebSocket(url)`). **But it does NOT support a custom-headers option** the way the `ws` npm lib does (the desktop's `{headers:{...}}` arg is a `ws`-ism). Two clean options on the server: (a) add `ws` as a server dependency and reuse the aggregator near-verbatim (simplest, headers work), or (b) use Bun's global `WebSocket` and pass the token another way (see §3 — query param or Sec-WebSocket-Protocol). **Recommend (a): add `ws` to the server's deps and port `WatchAggregator` into `src/services/peer-watch-aggregator.ts`** — least friction, battle-tested reconnect logic, header auth already matches `checkAuth`.
- **Protocol confirmed:** client connects to `/ws`; to receive Claude status it must send `{type:'subscribe', channel:'updates', project:'<path>'}` (handler.ts:128-154) — note replay of last-known statuses requires a `project` in the subscribe (handler.ts:144). The supervisor's server doesn't know peer project paths a priori, so either (i) subscribe per watched-project path, or (ii) **add a project-less `channel:'updates'` subscribe that streams all live statuses** (small handler change; today it only replays when `project` is supplied). Events arrive as `{type:'claude_session_status', project, session, status, lastUpdate, claudeSessionId}` (handler.ts:57, api.ts:2432-2439).
- **Lifecycle:** on mDNS `up` → add to aggregator `setWatched`; on `down` → remove; aggregator handles resubscribe-on-reconnect (re-send subscribe in the `open` handler — the desktop doesn't resubscribe because it subscribes elsewhere; the server port MUST send the subscribe frame in `ws.on('open')`).

---

## 3. Cross-server AUTH — the crux — recommendation

Today auth is a single shared bearer token per server (`MERMAID_AUTH_TOKEN`), enforced uniformly by `checkAuth` on all REST+WS (auth.ts:12-19). There is no per-peer identity, no pairing, no token endpoint. The desktop holds each server's token (user-entered, encrypted).

**Options assessed:**
1. **Shared federation secret (env/config) — RECOMMEND.** All peers in the federation run with the same `MC_FEDERATION_SECRET` (separate from the per-server UI token, or reuse `MERMAID_AUTH_TOKEN` if all peers already share one). A peer authenticates to another peer's `/ws` and federation REST routes by presenting `Authorization: Bearer <secret>`. Pragmatic, zero new protocol, matches the existing `checkAuth` mechanism exactly. Trust model = "same shared secret = trusted peer," appropriate for a personal multi-machine LAN setup. Downside: a single secret, no per-peer revocation — acceptable here.
2. **mDNS-advertised ephemeral token (TXT record).** Each server advertises a per-boot token in its TXT; peers read it and present it. Rejected: mDNS TXT is **plaintext on the multicast LAN** — anyone on the LAN can read the token and impersonate. No better than a shared secret, and more moving parts.
3. **Explicit pairing / token endpoint.** A `/api/federation/pair` handshake exchanging keys. Rejected for now: heaviest; overkill for a personal LAN; defer until cross-subnet/multi-user.

**Recommendation:** ship **Option 1 (shared `MC_FEDERATION_SECRET`)**. Concretely: (a) all federated servers boot with the same secret; (b) `checkAuth` accepts EITHER the per-server UI token OR the federation secret (so the desktop's existing tokens keep working independently) — small change in auth.ts to check both; (c) the peer-watch-aggregator and peer-callable REST calls send `Bearer <MC_FEDERATION_SECRET>`. Since Bun's global WebSocket can't set headers, if using Bun-native WS instead of `ws`, fall back to `ws://host/ws?fedToken=<secret>` and have `checkAuth` also accept a query param for `/ws` only — but §2's recommendation (use `ws` lib) keeps it header-based and uniform. **Flag:** mDNS being plaintext means the secret must NOT travel in TXT; it lives in env/config on each host only.

---

## 4. Per-op federation plan

| Op | Today | Federated design |
|---|---|---|
| **reconcile** | local `getStatuses` per watched project (setup.ts:3442-3452) | **Maintain an in-memory aggregate fed by peer WS** (recommended over on-demand REST fan-out — lower latency, already needed for push). The peer-watch-aggregator keeps `Map<serverId, Map<(project,session), {status, updatedAt}>>` updated live. reconcile reads local statuses + the aggregate, joined against the supervised set / locks (now serverId-keyed). For open-todo counts, todos live on the worker's host → either fan-out REST per supervised waiting-session on demand (cheap, only for sessions of interest) or accept count=0 for remote until a `GET /api/session-todos` peer route is added. **Recommend: WS aggregate for status + lazy REST for todo counts.** |
| **read_last_assistant_turn** | MCP-only, local transcript (setup.ts:3454-3457) | Transcript lives on the WORKER's host. **Add a peer-callable REST route** `GET /api/transcript/last-turn?claudeSessionId=...` wrapping `lastAssistantTurn`. The supervisor's MCP handler, when the target session's serverId != self, calls that peer's route (Bearer fed secret) instead of reading locally. |
| **nudge** | `POST /api/ide/tmux-send-keys` local (ide-routes.ts:95-113) | Route to the worker's owning peer's same endpoint via federation REST. Already exists — just dispatch by serverId. |
| **push** (worker waiting → supervisor) | per-host session-notify reads local supervisor identity + tmux (api.ts:2441-2461) | **Move push to the supervisor's-server peer-WS handler.** Because the supervisor's server now subscribes to every peer's `claude_session_status`, it sees all transitions. On a supervised worker → waiting/permission (from local OR peer WS), the supervisor's server runs the tmux push **LOCALLY** into the supervisor's own tmux (supervisor is a Claude on this host). Remove/disable the cross-host push attempt in per-worker session-notify (keep it only for the genuinely-local supervisor case as a fast path, or centralize entirely in the coordinator). |
| **escalations / locks** | `(project,session)` keyed (supervisor-store.ts:51-82) | Re-key by `(serverId, project, session)` — see §5. |

---

## 5. serverId model — "this worker is on peer X"

**Problem:** `(project, session)` is not globally unique across machines (same repo path on two hosts collides), and instance records have no serverId today.

**Recommendation:**
- **Introduce a stable per-server `serverId`** = a persisted UUID/ULID written once into `~/.mermaid-collab/server-id` (or into supervisor identity / config) and reused across restarts. Advertise it in the instance record (add `serverId` field to `Instance`, instance-discovery.ts:9-18) AND in the mDNS TXT (§1). The local server learns its own serverId at boot; peers learn each other's from mDNS TXT / the WS event tag.
- **Tag every status at ingestion with serverId** — exactly as the aggregator already does (`{...m, serverId: s.id}`, watch-aggregator.ts:38). Local events get `serverId = self`.
- **Re-key supervisor state by `(serverId, project, session)`:** add a `serverId TEXT` column to `supervised_session`, `attended_lock`, `escalation`; widen the PRIMARY KEYs. Migration: default existing rows to the local serverId. `supervisor_identity` stays single-row (the supervisor is one Claude on one host) but gains its serverId for the self-check.
- The aggregate map is therefore keyed by `(serverId, project, session)`; reconcile/nudge/read-last-turn dispatch by looking up the owning peer's `{host, port, token}` (from the mDNS/instance record) for that serverId.

---

## 6. KEEP (reuse) vs BUILD (new)

**KEEP / reuse as-is:**
- `POST /api/ide/tmux-send-keys` nudge route + `sendTmuxKeys` (ide-routes.ts:95, tmux-send.ts).
- Per-project `session-status-store` + `GET /api/session-status` (api.ts:2467).
- WS broadcast/subscribe protocol + `claude_session_status` event shape (handler.ts).
- The `WatchAggregator` connect/diff/backoff/tag pattern (watch-aggregator.ts) — ported, not rewritten.
- `checkAuth` bearer mechanism (auth.ts) — extended to accept a second token.
- supervisor.db tables + identity API (supervisor-store.ts) — schema-migrated, not replaced.

**BUILD (new):**
1. mDNS advertise + browse module (`bonjour-service`), peer source pluggable (mDNS + static-list fallback).
2. Stable `serverId` (persisted) + add to `Instance` record and mDNS TXT.
3. Server-side `peer-watch-aggregator.ts` (port of the desktop aggregator; add `ws` dep; send `subscribe` on open).
4. In-memory federated status aggregate keyed by `(serverId, project, session)`.
5. Federation auth: `MC_FEDERATION_SECRET`, `checkAuth` accepts UI-token OR fed-secret.
6. Peer-callable REST: `GET /api/transcript/last-turn` (wrap `lastAssistantTurn`); optionally `GET /api/session-todos` for remote todo counts.
7. serverId columns + migration on supervisor.db tables.
8. Move/centralize the push from per-worker session-notify (api.ts:2441-2461) into the coordinator's peer-WS handler; dispatch nudge/read-last-turn by serverId.
9. Project-less `channel:'updates'` subscribe (or per-project subscribe loop) so the coordinator streams all peer statuses (handler.ts:144 change).

---

## 7. Top risks / unknowns

1. **mDNS = single-subnet only.** Works for the user's same-LAN pair; silently fails across subnets/VPN. Mitigation: pluggable static-peer fallback from day one. Also: Bun + `bonjour-service` UDP-multicast compatibility should be smoke-tested (low risk — pure dgram — but unverified here).
2. **Auth blast radius.** A single shared `MC_FEDERATION_SECRET` on a plaintext-discoverable LAN means any LAN host with the secret is fully trusted; the secret must never ride in mDNS TXT. No per-peer revocation. Acceptable for personal use; revisit for multi-user.
3. **Identity & migration correctness.** Introducing `serverId` and re-keying three tables risks collisions/migration bugs, and the supervisor must reliably resolve serverId → {host,port,token} at dispatch time. If mDNS and the FS registry disagree (e.g., a host advertises but its WS is unreachable), reconcile could show stale/duplicate sessions; need dedup-by-serverId and liveness from the WS connection state, not just discovery.
