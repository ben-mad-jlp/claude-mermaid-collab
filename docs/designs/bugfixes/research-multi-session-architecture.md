# REVISED — multi-machine port forwarding (2026-05-15)

The original analysis (kept below for reference, marked **superseded**) assumed
multiple collab servers on the same Mac. The real constraint is different:

> Two or more **different remote machines** (e.g. dev-box-A, dev-box-B, plus
> sometimes the local Mac), each running its own collab server bound to its
> own local `9002` (API/UI/WS), `9102` (UI dev), and `9333` (CDP). The user
> opens a VS Code window on the Mac per remote via Remote-SSH. Remote-SSH's
> auto-forwarder maps each remote's `9002` back to the Mac's `localhost:9002`
> — and only the first one wins. Second window's forward silently remaps to
> a random local port (e.g. `4123`), which the extension and any browser
> pointed at `http://127.0.0.1:9002` no longer find.

Re-read of the code confirms what *isn't* in conflict:

- **Extension** **`extensionKind: ["ui"]`** (`extensions/vscode/package.json:17`).
  The extension runs on the **Mac** (the UI host), not on the remote. So
  every Chrome process — both the per-tool browsers (`nextCdpPort = 9230`,
  `extension.ts:344`) and the status-bar CDP Chrome on `9333`
  (`extension.ts:788`) — is spawned on the Mac. Chrome ports *do not* travel
  over the SSH tunnel. They're only ever local to the Mac.
- **`sshTunnelTarget`** (`extension.ts:796`, `:865`) is a *reverse* tunnel
  used to push the Mac's local Chrome `9333` *out to* a remote so a server
  there can reach back via CDP. It's optional and orthogonal to the inbound
  forwarding problem.
- **What actually collides** is the inbound side: each remote's collab
  server listening on its own `127.0.0.1:9002` (`src/config.ts:19`,
  `src/server.ts`), forwarded down to the Mac. The extension's
  `serverUrl` defaults to `ws://127.0.0.1:9002/ws`
  (`extension.ts:91`, `:59`) and so does the browser tab the user opens.

So the **only** thing that needs disambiguation per-remote is the
`{API, UI-dev, CDP-on-remote-if-any}` triple as it appears on the Mac's
`localhost`. Per-tool browser CDP ports stay Mac-local — Option 3 from the
old menu still applies for *those* and is unchanged.

## Revised option menu

Ordered from "smallest user diff" to "biggest infra change". Every option
must answer the same three questions:

1. How does **the Mac** disambiguate which remote a request belongs to?
2. How does **the extension** know which URL to dial for *its* window?
3. How does **the user's browser** (the Mac-side UI) know its base URL?

---

### R1 — VS Code Remote-SSH "labelled forward" with explicit per-host localPort (smallest)

**How it works.** Stop relying on auto-forwarding. In each remote workspace's
`.vscode/settings.json` (committed per-checkout, since each remote has its
own project clone), pin:

```json
"remote.SSH.defaultForwardedPorts": [
  { "name": "collab",  "remotePort": 9002, "localPort": 9012 },
  { "name": "collabUI","remotePort": 9102, "localPort": 9112 }
]
```

Box-A's checkout uses `9012`; Box-B's uses `9022`; etc. Each VS Code window
sees its own forwarded mapping; the user opens
`http://localhost:9012` (Box-A) or `:9022` (Box-B) in distinct browser tabs.

**Mac-side disambiguation.** Different local ports per remote — the
classic UNIX answer.
**Extension knows its URL.** Read the same workspace setting:
`mermaidCollab.serverUrl` becomes `ws://127.0.0.1:9012/ws` in Box-A's
checkout, `9022` in Box-B's. Already fully supported (`extension.ts:91`).
**Browser knows.** User remembers (or bookmarks) the per-remote URL.

**Changes needed.**

- *Repo:* document the convention; add a `.vscode/settings.json.example`.
  Optionally extend the `mermaid-collab` CLI with `bun run server --port 9002 --advertised-local-port 9012` so the launch script also writes a small README banner with the local URL.
- *Server:* nothing.
- *Extension:* nothing (already reads `serverUrl` from config). Maybe surface
  the resolved URL in the status-bar tooltip.
- *User setup:* one settings.json edit per remote. Pick a port-allocation
  convention (e.g. `9000 + 10*remoteIndex + offset`).

**Pros.** Zero new infra. Works today. Survives reconnects (Remote-SSH
honours `defaultForwardedPorts` on every connect). Each forward is named
in the **Ports** panel so it's visible.
**Cons.** Manual port bookkeeping across machines. If the user adds a 4th
remote they have to pick a new port. Per-remote `.vscode/settings.json`
must be set on the **remote** side because Remote-SSH workspace settings
live with the workspace folder.
**Show-stopper risk.** Low. Two known caveats:

- `remote.SSH.defaultForwardedPorts` has had bugs honouring workspace-level
  config historically ([microsoft/vscode-remote-release#3406](https://github.com/microsoft/vscode-remote-release/issues/3406)).
  As of 2025 it does work; user-level overrides take precedence.
- Forwards containing a different `remoteHost` (e.g. forwarding from a
  service container on the remote) still don't work
  ([#3225](https://github.com/microsoft/vscode-remote-release/issues/3225)).
  Not relevant here since collab listens on `127.0.0.1` of the remote.

---

### R2 — Server self-allocates port + writes discovery file (lockfile-on-remote)

**How it works.** Same idea as old Option 2, but the discovery file lives
on the **remote** at `~/.mermaid-collab/instance.json` written by the
collab server when it starts (`PORT=0`, kernel picks). The extension on
the Mac, after connecting via Remote-SSH, reads that file *through the SSH
session* — easiest path is a tiny `mermaid-collab whereami` CLI on the
remote (`bun whereami` → prints JSON), invoked by the extension via
`vscode.workspace.fs` on the remote workspace folder, or via a shell task.
The extension then asks Remote-SSH to forward exactly that port using
`vscode.commands.executeCommand('remote.tunnel.forwardCommandPalette', ...)`
or programmatic `vscode.workspace.openTunnel({ remoteAddress: { port: N }, localAddressPort: M })` (added in VS Code 1.72+).

**Mac-side disambiguation.** Each window programmatically opens its own
tunnel and remembers the local port it received.
**Extension knows.** It just allocated it.
**Browser knows.** Extension exposes a command "Open collab UI" that opens
the local URL — user clicks it; no manual port memorising.

**Changes needed.**

- *Server:* `PORT=0` support, write/clean discovery file at known path,
  accept `--project` env, log "listening on `:N`, advertise via `~/.mermaid-collab/instance.json`".
- *Extension:* on activation, run discovery + `openTunnel()`; replace
  hard-coded `serverUrl` config with the dynamically allocated localAddress.
  Add a "Open Collab in Browser" command.
- *User setup:* none beyond installing the extension.

**Pros.** Fully automatic. Add a 4th remote — just works. Same pattern as
Jupyter runtime files. Eliminates the static `9002` everywhere.
**Cons.** Needs the `vscode.workspace.openTunnel` API (stable since 1.72,
fine for `^1.85.0` engine). The "open in browser" command becomes the
primary way users get to the UI — losing the bookmarkable URL.
**Show-stopper.** The browser tab on the Mac dies if the tunnel local port
changes (e.g. on reconnect). Mitigation: persist the localPort across
sessions in the extension's `globalState` so reconnects re-open the same
local port if free.

---

### R3 — Single multiplexing reverse-proxy on the Mac (one local port, host routing)

**How it works.** Run a small Bun/Caddy proxy on the Mac that listens on
`127.0.0.1:9002` and routes by **Host header** to the right backing tunnel:

```
box-a.collab.localhost  →  127.0.0.1:9012  (forwarded from box-a:9002)
box-b.collab.localhost  →  127.0.0.1:9022  (forwarded from box-b:9002)
mac.collab.localhost    →  127.0.0.1:9032  (local server)
```

`*.localhost` resolves to `127.0.0.1` on macOS by default (no `/etc/hosts`
edit needed; `localhost` is a TLD reserved by RFC 6761). Each remote still
auto-forwards its own port (Remote-SSH picks whatever it picks, doesn't
matter — proxy reads it from a discovery sidecar). User opens
`http://box-a.collab.localhost:9002` in their browser; the WS upgrade
follows the same Host-routing.

**Mac-side disambiguation.** Hostname.
**Extension knows.** Workspace setting: `mermaidCollab.serverUrl =
ws://box-a.collab.localhost:9002/ws` per checkout. Or the proxy itself
exposes `/whoami` so extensions can ask.
**Browser knows.** User bookmarks `box-a.collab.localhost:9002` once.

**Changes needed.**

- *New:* small Bun proxy daemon (~150 lines). Config file lists hostname →
  upstream port; updates when extensions register on connect.
- *Server:* nothing.
- *Extension:* set `serverUrl` to the host alias; register with the proxy
  on activation (POST `/register {host, upstreamPort}`).
- *User setup:* run the proxy daemon (launchd plist). One-time install.

**Pros.** One stable URL per remote forever. Survives Remote-SSH port
reshuffling. Browser tabs don't break on reconnect. Extends to non-VSCode
clients trivially. Hostnames are human-readable.
**Cons.** New daemon to install/maintain. WS upgrade routing is doable but
fiddly. CORS / cookie scoping changes when host changes.
**Show-stopper.** None functional. Adoption cost is the real cost.

---

### R4 — Tailscale (or any overlay) — give every machine a unique address

**How it works.** Install Tailscale on the Mac and every dev box. Each gets
a stable MagicDNS name (`box-a.tail-net.ts.net`). Hit the collab server
*directly* on the remote at `http://box-a:9002` — no SSH forward at all.
Same conceptual fix as R3 but the routing happens at the network layer
instead of an HTTP proxy on the Mac.

**Mac-side disambiguation.** IP address / DNS name.
**Extension knows.** Workspace setting `mermaidCollab.serverUrl =
ws://box-a:9002/ws` per checkout. Same as R1 but with hostnames instead of
ports.
**Browser knows.** Bookmark `http://box-a:9002`.

**Changes needed.**

- *Repo:* nothing structural, just docs.
- *Server:* bind to `0.0.0.0` (already does, `config.ts:46`) — but **stop
  binding to** **`0.0.0.0`** without an ACL would expose the server to anyone
  on the tailnet. Add a Tailscale ACL or bind to the `tailscale0`
  interface IP only.
- *Extension/User setup:* install Tailscale; sign in; that's it.

**Pros.** Zero VS Code involvement. URLs are stable across reboots,
reconnects, IP changes. Works from phones, other Macs, CI. The cleanest
long-term answer.
**Cons.** Third-party dependency (or self-hosted Headscale). Org policy may
forbid. Slightly more lag than a same-host loopback.
**Show-stopper.** Org/security review. If the user is solo or already
using Tailscale, this is the easiest answer of all.

---

### R5 — Microsoft Dev Tunnels / `code tunnel`

**How it works.** Each remote runs `code tunnel --name box-a` once (or
`devtunnel host -p 9002`). Microsoft hands out a stable HTTPS URL
(`https://box-a-9002.usw2.devtunnels.ms`). The Mac's browser hits that URL
directly; no SSH involvement.

**Mac-side disambiguation.** URL.
**Extension knows.** `mermaidCollab.serverUrl = wss://box-a-9002.devtunnels.ms/ws`.
**Browser knows.** Bookmark.

**Pros.** Zero infra; works through corporate firewalls; HTTPS for free.
**Cons.** Requires GitHub/MS auth on every box. Adds Microsoft-controlled
hop into the data path (latency + dependency). Free tier has rate limits.
**Show-stopper.** Trust/data-residency. Probably fine for hobby work,
risky for client code.

---

### R6 — Per-host SSH `LocalForward` with loopback aliases (`127.0.0.2`, etc.)

**How it works.** Skip Remote-SSH's auto-forward entirely. In `~/.ssh/config`:

```
Host box-a
  LocalForward 127.0.0.2:9002 127.0.0.1:9002
  LocalForward 127.0.0.2:9102 127.0.0.1:9102
Host box-b
  LocalForward 127.0.0.3:9002 127.0.0.1:9002
  LocalForward 127.0.0.3:9102 127.0.0.1:9102
```

Each remote answers on a unique loopback alias. URL becomes
`http://127.0.0.2:9002` etc.

**macOS gotcha:** loopback aliases other than `127.0.0.1` are **not** up
by default. You must `sudo ifconfig lo0 alias 127.0.0.2 up` and persist via
launchd (see [the dangling pointer guide](https://aaron.blog/2011/02/04/mac-os-x-adding-a-loopback-alias/)).
Annoying but one-time.

**Mac-side disambiguation.** IP.
**Extension knows.** Workspace setting `serverUrl=ws://127.0.0.2:9002/ws`.
**Browser knows.** Bookmark.

**Pros.** No new daemon, no overlay network. Pure SSH+loopback. Works for
any TCP service, not just HTTP, so it generalises if you add more ports.
**Cons.** macOS loopback-alias persistence is fragile across upgrades.
Remote-SSH's own auto-forward will *also* fire and may shadow these — you
have to disable auto-forward (`remote.autoForwardPorts: false`) per
workspace.
**Show-stopper.** Coexistence with Remote-SSH auto-forward needs care.

---

### R7 — Push the SSH tunnel into a "collab-tunnel" Mac daemon (control plane)

**How it works.** A tiny Mac daemon (`collab-tunneld`) reads
`~/.mermaid-collab/remotes.toml`:

```toml
[box-a]
ssh = "user@box-a"
remotePort = 9002
localPort = 9012
[box-b]
ssh = "user@box-b"
remotePort = 9002
localPort = 9022
```

Maintains an `autossh`-style persistent tunnel per remote. Exposes an HTTP
API on `127.0.0.1:9001/instances` so the VS Code extension can ask
"give me the local port for the workspace I'm in" and get back
`{ port: 9012 }`. Extension then sets its `serverUrl` accordingly and
exposes a "Open Collab UI" command that opens `localhost:9012` in the
browser.

**Mac-side disambiguation.** Daemon owns it.
**Extension knows.** Daemon tells it.
**Browser knows.** Extension command opens it.

**Pros.** Hides all the port bookkeeping from both user and extension.
Survives VS Code reload, network blips. Works for non-VSCode editors too.
**Cons.** New daemon to ship/maintain/notarise. Duplicates what Remote-SSH
already does (slightly better).
**Show-stopper.** Effort vs. payoff is marginal compared to R1+R2 hybrid.

---

### R8 — `mermaid-collab` ships a "discovery proxy" subcommand baked in

**How it works.** Combine R2 + R3: the existing `mermaid-collab` binary
gets two new subcommands:

- `mermaid-collab serve --project PATH --port 0` — what every remote runs.
  Picks free port. Writes discovery file at `~/.mermaid-collab/instance.json`
  on the remote.
- `mermaid-collab proxy` — what the Mac runs (launchd). Discovers all
  forwarded local ports by scanning for them via SSH (`ssh box-a cat ~/.mermaid-collab/instance.json`), opens VS Code's `openTunnel()` (or
  invokes `ssh -L`), routes hostname `*.collab.localhost:9002` to the right
  backing port.

**Pros.** Single repo, single install, single mental model. End user does
`brew install mermaid-collab && mermaid-collab proxy --launchd-install` and
forgets it.
**Cons.** Most code to write of any option here.

---

## Recommendation under the new framing

**Ship R1 now, pursue R2 next, evaluate R4 (Tailscale) as the long-term
default for users who can adopt it.**

- **R1 (per-host** **`localPort`** **in workspace settings) is a 5-minute fix** that
  unblocks the user today. It needs zero code changes — just a documented
  port-allocation convention and per-checkout `.vscode/settings.json`. The
  extension already reads `mermaidCollab.serverUrl`. Add an
  `examples/.vscode/settings.json` and a paragraph in the README.
- **R2 (server self-allocates + extension** **`openTunnel`)** is the
  ergonomically right answer because users add/remove remotes without
  touching config. Needs `PORT=0` support in `src/config.ts`, a discovery
  file in `src/server.ts`, and ~80 lines in `extensions/vscode/src/extension.ts`
  for the `openTunnel` flow + an "Open Collab UI" command.
- **R4 (Tailscale)** is the cleanest answer for users with org permission;
  document it as the recommended path for solo/small-team setups. Server
  needs a bind-interface flag so it doesn't accidentally expose to the
  whole tailnet.

**Avoid** R3/R7/R8 unless R1+R2 prove insufficient — they're more daemon
than the problem demands. **Avoid** R5 unless you already trust MS Dev
Tunnels with the data. **Use R6** only if SSH config purism is a value;
the loopback-alias persistence story on macOS isn't worth it.

Per-tool browser CDP (`nextCdpPort = 9230`) and the status-bar CDP `9333`
remain Mac-local concerns and the **Option 3** advice from the original
analysis still applies unchanged: stable per-window port via workspace-hash

- free-port probe, unique `--user-data-dir`. That work is independent of
  which of R1–R8 you pick.

## Sources (revised)

- [VS Code: Remote Development Tips and Tricks (port forwarding)](https://code.visualstudio.com/docs/remote/troubleshooting)
- [VS Code: Remote Development using SSH](https://code.visualstudio.com/docs/remote/ssh)
- [vscode-remote-release #3406 — defaultForwardedPorts in workspace config](https://github.com/microsoft/vscode-remote-release/issues/3406)
- [vscode-remote-release #3225 — remoteHost in defaultForwardedPorts](https://github.com/microsoft/vscode-remote-release/issues/3225)
- [vscode-remote-release #2318 — RemoteForward in Forwarded Ports view](https://github.com/microsoft/vscode-remote-release/issues/2318)
- [VS Code API: workspace.openTunnel (Tunnel API)](https://code.visualstudio.com/api/references/vscode-api#TunnelDescription)
- [Tailscale MagicDNS](https://tailscale.com/kb/1081/magicdns)
- [Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview)
- [macOS loopback aliases — the dangling pointer](https://aaron.blog/2011/02/04/mac-os-x-adding-a-loopback-alias/)
- [How I Fixed Binding 127.0.0.2 on Mac (Medium)](https://medium.com/@YagelSh/how-i-fixed-a-strange-error-binding-127-0-0-2-1234-on-my-mac-696e98adbe5c)

---

## Multi-user-per-host extension (added 2026-05-15)

A new constraint: two **different users** SSH into the **same** remote box and
each run their own collab server, each forwarded back to their own laptop.
This stacks with the original multi-machine framing. Full concurrency matrix
the design must now handle:

| # | Users | Hosts | Sessions per (user,host) | Status |
|---|-------|-------|--------------------------|--------|
| 1 | 1     | 1     | 1                        | Today's happy path |
| 2 | 1     | N     | 1                        | Original revised problem |
| 3 | N     | 1     | 1                        | New problem |
| 4 | 1     | 1     | M                        | Should not be foreclosed |

The combined worst case is N users × M sessions on the same Linux box.

### Key facts (verified)

- **Loopback is per-netns, not per-user.** On Linux, `127.0.0.0/8` is a
  property of the network namespace, which is shared by all UIDs unless
  someone has set up user-namespacing (Remote-SSH does not). Two users
  doing `bind(127.0.0.1, 9002)` race; the second gets `EADDRINUSE`.
  `SO_REUSEADDR` doesn't help (it controls TIME-WAIT, not concurrent live
  binds), `SO_REUSEPORT` would let them share but then connections get
  load-balanced randomly between the two servers — wrong semantics.
  `::1` (IPv6 loopback) has the same single-binder rule. Conclusion:
  **the static `9002` everywhere convention is fundamentally incompatible
  with case 3.**
- **`PORT=0` (kernel-allocated ephemeral)** completely solves the bind
  collision: each server gets a different free port from the ephemeral
  range. This is the only sane primitive for cases 3 and 4.
- **Unix domain sockets** are per-path, so two users with sockets under
  their own `~/.mermaid-collab/sock/` can never collide. They give true
  per-user FS-permission isolation (a TCP `127.0.0.1:9002` server is
  reachable by *any* local user via `curl`). Remote-SSH **does** support
  UDS forwarding via the OpenSSH `LocalForward /local.sock /remote.sock`
  mechanism, but only if the remote sshd has
  `AllowStreamLocalForwarding yes` (default on most distros, but not
  guaranteed) and only via explicit `~/.ssh/config` — VS Code's
  auto-forwarder and `vscode.workspace.openTunnel()` API only speak TCP.
  See [microsoft/vscode-remote-release#8950](https://github.com/microsoft/vscode-remote-release/issues/8950).
  **Conclusion: UDS is correct for true isolation but loses the painless
  Remote-SSH auto-forwarding story.** Fallback path is "TCP on
  127.0.0.1 + ephemeral port + per-user discovery file scoped by `$HOME`".
- **Remote-SSH port forwarding tables are per-connection.** Each VS Code
  Remote-SSH window opens its own SSH multiplexed session and maintains
  an independent forwarding table; User-A's `9012→remote:9002` and
  User-B's `9013→remote:9047` do not collide on either end. Confirmed
  empirically and per the Remote-SSH docs. So case 3 works
  fine *as long as* the two remote servers are on different remote ports.

### Per-recommendation re-walk

#### R1 — pinned `localPort` in workspace settings

- Case 1: works.
- Case 2: works (the original use case).
- **Case 3: BREAKS.** Both users' workspace `.vscode/settings.json` would
  pin `remotePort: 9002`, and the *second* user's collab server can't even
  start (EADDRINUSE on the remote side). Even if you sidestep that by
  picking different `remotePort` per user (`9002` for A, `9003` for B),
  you've now forced cross-user coordination — every user must know which
  ports the other users have claimed. Doesn't scale.
- **Case 4: BREAKS** for the same reason (one user's two sessions both
  try to bind 9002 on the remote).
- **Verdict:** R1 is a single-user-per-host shortcut only. Demote.

#### R2 — `PORT=0` + discovery file + extension `openTunnel()`

- Case 1: works.
- Case 2: works.
- **Case 3: works** if discovery files are scoped under each user's
  `$HOME` (which they naturally are). User-A's server writes to
  `/home/alice/.mermaid-collab/...`, User-B's to `/home/bob/...`. They
  never see each other's files. Each user's Remote-SSH session reads from
  its own `$HOME` over its own SSH connection.
- **Case 4: works** *iff* discovery file path is per-session, not the
  single `instance.json`. See "discovery file layout" below.
- **Bind address question.** For case 3, binding `127.0.0.1` means
  User-B can in principle `curl` User-A's API. Not catastrophic on a
  trusted dev box (no secrets in the API beyond project paths and the
  user's own designs/diagrams), but real. UDS under
  `~/.mermaid-collab/sock/<session>.sock` (mode 0600) gives true
  isolation. Tradeoff: Remote-SSH auto-forward and `openTunnel()` only
  do TCP. Pragmatic answer: **default to TCP+ephemeral; expose a
  `MERMAID_COLLAB_BIND=uds` opt-in** for users who care, with manual
  `~/.ssh/config` `LocalForward` setup documented.
- **Extension flow walkthrough.** The discovery file lives on the
  *remote*, so the Mac-side extension must read it remotely. Cleanest
  mechanisms (in order of preference):
  1. **`vscode.workspace.fs.readFile(vscode.Uri.parse('vscode-remote://ssh-remote+host/home/alice/.mermaid-collab/instances/<session>.json'))`** — when the extension runs in `extensionKind: "ui"` on the Mac, the Remote-SSH extension exposes the remote FS via `vscode-remote://` URIs. This is the supported path. Caveat: a `"ui"` extension doesn't have direct access to the remote filesystem; it has to use `vscode.commands.executeCommand` to ask the Remote-SSH extension, OR ship a small `"workspace"`-kind helper extension that runs on the remote and POSTs the discovery JSON back over a webview/IPC channel.
  2. **Run a `mermaid-collab whereami` shell command remotely** via `vscode.tasks` or by spawning `ssh host mermaid-collab whereami`. Extension parses stdout. Simpler, no extension-kind gymnastics, and works even when the workspace folder is on the remote.
  3. After getting `{port: N, project: P}`, call `vscode.workspace.openTunnel({ remoteAddress: { host: '127.0.0.1', port: N } })` → returns `{ localAddress: 'localhost:M' }`. Set `mermaidCollab.serverUrl` to `ws://localhost:M/ws` for that window's extension instance and expose an "Open Collab UI" command that opens `http://localhost:M`.
- **Where it could break:**
  - The `"ui"`/`"workspace"` extension-kind boundary is the trickiest
    bit; current extension is `"ui"`-only. Likely answer is to publish
    *both* — UI side talks to the user, workspace side reads
    `~/.mermaid-collab` and pipes it back. VS Code's recommended pattern
    for exactly this case.
  - Multiple workspace folders in one window (rare for collab use) →
    discovery file lookup is ambiguous. Just pick the first.
  - Reconnect: the local tunnel port may differ. Persist the
    `(workspaceHash → desiredLocalPort)` mapping in the extension's
    `globalState` and pass `localAddressPort: M` to `openTunnel()` so
    the same local port is reused when free.
- **Verdict:** R2 is the only option that satisfies all four cases
  without coordination between users. **Promote to primary.**

#### R4 — Tailscale

- Case 1: works (overkill).
- Case 2: works (the cleanest answer).
- **Case 3: PARTIAL.** Tailscale identity is per-machine, not per-user.
  A shared dev box gets one MagicDNS name (`devbox.tail-net.ts.net`).
  Both users' servers still need different ports on that one host, and
  the discovery-file-or-equivalent problem reappears. Tailscale removes
  the SSH-forwarding hop; it does not remove the multi-server-on-one-host
  problem. You'd still need R2's `PORT=0` + discovery underneath.
- **Case 4: same** — multiple sessions per user → still need per-session
  ports on the host.
- **Verdict:** R4 is orthogonal infrastructure that complements R2
  rather than replacing it. Recommend it for users with a tailnet, but
  always paired with R2's per-user/per-session port discipline.

#### Other options briefly

- R3 (Mac-side reverse proxy with `*.collab.localhost` host routing):
  cases 3 and 4 require the proxy to also key off user identity (`alice`
  vs `bob` subdomains) and to manage independent SSH forwards per user.
  Doable but the proxy now needs a credential model. Defer.
- R6 (loopback-alias `127.0.0.2` etc.): macOS-side aliases don't help
  on the *remote* shared host where the actual collision happens. No.
- R7/R8 (Mac-side daemons): same caveat as R3 — fine for one user, need
  multi-user awareness in case 3.

### Proposed discovery-file layout

Lives under `$HOME/.mermaid-collab/`, so per-user separation is automatic:

```
~/.mermaid-collab/
  instances/
    <session-id>.json            # one file per running server
    <session-id>.json.lock       # flock'd while server is alive
  sock/                          # only present if BIND=uds
    <session-id>.sock            # mode 0600
  index.json                     # cache: { <session-id>: {pid, port, project, startedAt, bind} }
```

- `<session-id>` is `sha1(project_abs_path)[:12]` if one-session-per-project,
  or `sha1(project + '\0' + session_name)[:12]` if the user has named
  parallel sessions on the same project (case 4).
- Each server, on startup: pick `PORT=0`, write `instances/<id>.json`
  atomically (write `.tmp` then rename), `flock` the `.lock` file
  exclusive for the lifetime of the process, update `index.json`.
- On startup *and* on every read, sweep for stale entries:
  `flock` the `.lock` file with `LOCK_EX | LOCK_NB`; if it succeeds,
  the previous owner is dead → unlink and skip. (Fall back to
  `kill(pid, 0)` for portability.)
- `mermaid-collab whereami [--session <id>]` reads `index.json` (or
  walks `instances/`) and prints JSON for the matching session, or all
  live sessions if no `--session` given.
- The extension calls `whereami` over SSH and picks the session whose
  `project` field matches the workspace folder. If multiple match
  (case 4), it shows a quickpick.

This handles cases 3 and 4 cleanly and degrades gracefully for cases 1
and 2 (single entry in `instances/`).

### Show-stoppers and open questions

1. **Extension-kind split.** Current extension is `extensionKind: ["ui"]`.
   Reading remote `~/.mermaid-collab/` cleanly requires either a
   companion `"workspace"`-kind extension or shelling out via
   `child_process.exec("ssh host mermaid-collab whereami")`. Pick one;
   the latter is faster to ship but couples to the user's `ssh` config
   for the host alias. **Open question — biggest one.**
2. **`AllowStreamLocalForwarding`** for the UDS opt-in path — not
   guaranteed enabled on every remote sshd. Document, fall back to TCP.
3. **Stale `index.json`** under crash-loop conditions. `flock` semantics
   on NFS-homed `$HOME` (some shared-dev setups) are not reliable. Add a
   `--no-flock` mode that uses pidfile + heartbeat timestamp instead.
4. **Cross-user discovery** is intentionally *not* supported. If a user
   ever needs to connect to another user's server, that's an explicit
   "share my session URL" UX, not an automatic discovery feature.

### Updated top-level recommendation (all 4 cases)

**Make R2 the primary path. Drop R1 as a recommended option (it's a
single-user shortcut). Keep R4 as a complementary deployment choice.**

Concretely:

1. **Server (`src/server.ts`, `src/config.ts`):** support `PORT=0`,
   write per-session discovery files under `~/.mermaid-collab/instances/`,
   `flock` the lock file, take `MERMAID_PROJECT` and `MERMAID_SESSION`
   env vars (no more CWD-rooted paths). Optional `MERMAID_COLLAB_BIND=uds`
   for the isolation-conscious.
2. **CLI:** add `mermaid-collab whereami [--session <id>]` and
   `mermaid-collab serve --project PATH [--session NAME]`.
3. **Extension (`extensions/vscode/src/extension.ts`):** on activation,
   shell out to remote `mermaid-collab whereami`, pick the matching
   session, call `vscode.workspace.openTunnel()`, persist the chosen
   local port in `globalState`, set `serverUrl` for that window only,
   expose "Open Collab UI" command.
4. **Docs:** Tailscale (R4) recommended for users on a tailnet; covers
   multi-machine cases without SSH forwarding overhead. Always paired
   with the per-session discovery underneath.

This satisfies all four concurrency cases and removes every static port
assumption from the codebase.

### Sources (multi-user extension)

- [microsoft/vscode-remote-release#8950 — UDS forwarding](https://github.com/microsoft/vscode-remote-release/issues/8950)
- [VS Code: Remote Development Tips and Tricks — UDS section](https://code.visualstudio.com/docs/remote/troubleshooting)
- [OpenSSH `AllowStreamLocalForwarding` — sshd_config(5)](https://man.openbsd.org/sshd_config#AllowStreamLocalForwarding)
- [Linux `bind(2)` and EADDRINUSE semantics on loopback](https://man7.org/linux/man-pages/man2/bind.2.html)
- [VS Code API: `workspace.openTunnel` and `Tunnel.localAddress`](https://code.visualstudio.com/api/references/vscode-api#TunnelDescription)
- [VS Code extension kinds — UI vs Workspace](https://code.visualstudio.com/api/advanced-topics/remote-extensions#architecture-and-extension-kinds)

---

# Multi-session architecture for mermaid-collab (superseded — see revised section above)

Goal: run **two (or N) concurrent collab sessions** on the same Mac — different projects, different VSCode windows, different Chrome instances driven over CDP — without them stomping on each other.

## Today's coupling points (single-instance assumptions)

From reading the code:

1. **API/UI server port: hardcoded to** **`9002`** (`src/config.ts:19` `PORT` env default, `src/server.ts:180`). One Bun process, one port, one set of `.collab/` storage rooted at `process.cwd()` (`src/server.ts:154,156`). Two `bun src/server.ts` invocations on the same Mac will EADDRINUSE.
2. **UI dev port: hardcoded** **`9102`** (mentioned in task brief; the served prod UI is just whatever serves `ui/dist` from the same `9002`).
3. **VSCode extension WS URL: hardcoded** **`ws://127.0.0.1:9002/ws`** (`extensions/vscode/src/extension.ts:91`, `:59`). All extension hosts on the box dial the same singleton.
4. **CDP "status-bar button" Chrome port: hardcoded** **`9333`** (`extension.ts:788`) with a single `chromeDebugProcess` global (`:12`) and a single user-data-dir (`Library/Application Support/ChromeDebug`, `:790`). Toggling on a second VSCode window either fights for port 9333 or no-ops.
5. **Per-tool browser sessions: a counter starting at 9230** (`extension.ts:344` `nextCdpPort = 9230`). This is *per extension-host*, not coordinated across windows — two windows would both start at 9230 and collide.
6. **Server-side CDP client: hardcoded** **`CDP_PORT = 9333`** (`src/services/cdp-session.ts:8`) and `closePersistedTabs(CDP_PORT)` runs at server boot (`src/server.ts:48`) — server expects exactly one Chrome on 9333.
7. **Scratch session at fixed path** `~/.mermaid-collab` (`src/server.ts:43`). Two server processes will both try to register.
8. **MCP HTTP transport** is at `http://HOST:9002/mcp` — every Claude Code instance points at the one server.

(See the original analysis in repo history for the full Option 1–8 menu;
the multi-user extension above supersedes the recommendation.)
