# Running mermaid-collab Server on a Different Machine than the Project Code

Topology under investigation:
- **Machine A**: hosts the collab server (API + UI + MCP backend)
- **Machine B**: project machine — holds source repos, runs Claude Code
- Claude Code on B talks to the collab MCP server on A across the network

## TL;DR Assessment

The MCP transport is **already HTTP** (`.mcp.json` → `http://localhost:9002/mcp`), so pointing Claude Code on Machine B at a server on Machine A is *almost* a config-only change for the **protocol layer**. The hard blocker is **filesystem coupling**: the server stores all artifacts under `join(project, '.collab', 'sessions', <session>)` on **its own local disk**, and the `project` arg is an absolute path that must exist on the *server's* filesystem. If the server runs on A but the repo lives on B, every artifact read/write targets a path that does not exist on A (or is the wrong directory).

**Most viable approach: run the server on Machine B (co-located with the code) and tunnel the API/MCP/WS ports to Machine A** — which is exactly what the existing VS Code Remote-SSH "workspace-half / ui-half" architecture already does. The reverse (server on A, code on B) requires a shared/mounted filesystem or a new abstraction layer over artifact storage that does not exist today.

---

## 1. MCP Transport

**Already HTTP, not stdio-only.**

- `.mcp.json` (repo root) registers the MCP server as:
  ```json
  { "mcpServers": { "mermaid": { "type": "http", "url": "http://localhost:9002/mcp" } } }
  ```
- The HTTP MCP endpoint is served by the main API server: `src/server.ts` line 218 routes `url.pathname === '/mcp'` to `handleMCPRequest` (`src/mcp/http-handler.ts`).
- `src/mcp/http-transport.ts` implements `StreamableHttpTransport` (MCP protocol 2025-03-26, POST+SSE on a single endpoint). It also already contains a **client-side `RemoteMcpTransport`** class (line 416+) with full OAuth-PKCE / api-key / SSE support for connecting *outward* to remote MCP servers.
- `src/mcp/server.ts` is the **legacy stdio** transport, explicitly marked legacy. Notably it is itself a *thin client*: it just verifies the HTTP API is up (`fetch(${API_BASE_URL}/api/health)`) then bridges stdio. The real logic lives behind HTTP.
- `src/mcp/setup.ts` (the actual tool implementations) is **also an HTTP client**: every tool calls `fetch(buildUrl('/api/...', project, session))` where `API_BASE_URL = http://${API_HOST}:${API_PORT}` (`setup.ts:215-217`, `buildUrl` at `setup.ts:244`).

**Implication:** the MCP layer is uniformly "talk to an HTTP API." Changing the URL in `.mcp.json` from `localhost:9002` to a remote host (or a tunneled local port) is sufficient for Claude Code on B to *reach* a server on A at the protocol level. No stdio same-machine assumption in the transport itself.

## 2. Filesystem Coupling (the real blocker)

The `project` argument is **not an opaque key** — it is an absolute filesystem path the server dereferences locally:

- `src/services/session-registry.ts:271` — `const sessionPath = join(project, '.collab', 'sessions', session)` then `mkdir(...)` for `diagrams/ documents/ designs/ spreadsheets/ snippets/ images/ code-files/`.
- `src/routes/api.ts` constructs managers from project-rooted paths:
  - `:162-163` `new DiagramManager(diagramsDir)`, `new DocumentManager(documentsDir)` (dirs derived from `project`)
  - `:336` `join(projectPath, '.collab', 'sessions')`
  - `:396/:431/:471` `join(params.project, '.collab', 'sessions', params.session, 'collab-state.json')`
  - `:1112/:1195` design files under `join(params.project, '.collab', 'sessions', ...)`
- `src/config.ts:78` `MERMAID_PROJECT = process.env.MERMAID_PROJECT ?? process.cwd()` — the server advertises and defaults to its **own cwd**.
- Server also reads/writes other project-local state: `.collab/agent-sessions`, `.collab/agent-checkpoints.db` (`src/server.ts:156-159` using `process.cwd()`), pseudo-db, etc.

**What breaks if server on A, code on B:**
- The server `mkdir`/reads/writes `<project>/.collab/...` on **Machine A's** filesystem. If `/Users/.../repo` doesn't exist on A, artifacts land in a bogus path or fail.
- Artifacts (diagrams, docs, designs) would be stored on A, decoupled from the repo on B — they would not appear in the developer's working tree, breaking the "artifacts live next to the code, committed with the repo" model.
- Server-side features that shell out to git / read source files (agent dispatcher `resolvedCwd: process.cwd()` at `src/server.ts:165`, pseudo indexing, worktree-diff/worktree-files routes, file-content API) all assume the repo is on the same host as the server.

The server **fundamentally needs direct filesystem access to the project directory.** `project` is a real path, not a namespace.

## 3. Existing Remote / Multi-Instance Support

There is substantial recent work, but it solves the **inverse** topology (server co-located with code; UI/clients remote) — which is the recommended direction here.

- **Instance registry** (`src/services/instance-discovery.ts`): every server writes `~/.mermaid-collab/instances/<sessionId>.json` containing `{ port, project, session, pid, serverVersion }`. `sessionId = sha1(project + '\0' + session).slice(0,12)` (`deriveSessionId`). Discovery is **filesystem-based** under `$HOME/.mermaid-collab/instances` — it assumes the discovering process shares a filesystem with the server (same host, or a Remote-SSH workspace host).
- **PORT=0 ephemeral binding** (`src/config.ts:70 PORT_REQUEST`, `src/server.ts:380-422`): server binds an OS-assigned port and advertises the actual port in the instance file. This exists precisely to support many servers + dynamic port forwarding.
- **VS Code two-half architecture** (the cross-machine precedent):
  - `extensions/vscode/src/workspace-half.ts` runs on the **workspace host** (same machine as the code), spawns the collab server there (`startServer` command), watches `~/.mermaid-collab/instances`, and RPCs `mermaidCollab.ui.onInstanceUp` to the UI half.
  - `extensions/vscode/src/ui-half.ts:558` the **UI host** half calls `vscode.workspace.openTunnel({ remoteAddress: { host:'127.0.0.1', port: inst.port }, localAddressPort })` to port-forward the remote server port to a local port, then writes `mermaidCollab.serverUrl = ws://127.0.0.1:<localPort>/ws` into workspace config (`ui-half.ts:578-580`).
  - `extensions/vscode/src/ui-half.ts:507` chooses `startCollabServerRemote` vs `startCollabServerLocal` based on `vscode.env.remoteName`.
  - `server-resolver.ts` resolves the plugin source + bun on **whichever host the half runs on** (env `MERMAID_COLLAB_ROOT` / `CLAUDE_PLUGIN_ROOT`, else plugin cache glob).

**Conclusion:** the existing design's answer to "server and project on a different machine than my editor/UI" is: **run the server next to the code, forward its port to the client.** There is no support for the opposite (server remote, code local) — the instance registry, agent dispatcher, pseudo, and artifact storage all assume server == code host.

## 4. Browser Tools — SSH Tunnel Precedent

`extensions/vscode/src/ui-half.ts:353-451`: the Chrome-debug feature spawns Chrome with `--remote-debugging-port=<port>` (default 9333) and, if `mermaidCollab.sshTunnelTarget` is configured, runs `spawn('ssh', [ ... '-L' ... sshTarget ...])` to forward the CDP port across machines (with stderr capture and disconnect handling at `:436-444`). `src/services/cdp-session.ts` connects over that tunneled port. This is a working, in-tree pattern for **plain `ssh -L` port forwarding between machines** and is directly reusable for forwarding the collab API/MCP port (9002) instead of (or in addition to) the VS Code `openTunnel` mechanism.

## 5. Config / Env Vars Controlling Host/Port/URL

- **Server bind**: `src/config.ts` — `PORT` (default 9002, `0` ⇒ ephemeral via `PORT_REQUEST`), `HOST` (default `0.0.0.0`, so it already binds all interfaces — reachable across the network without code changes). `MERMAID_PROJECT`, `MERMAID_SESSION` control what the instance advertises.
- **MCP/stdio client → API base**: `src/mcp/setup.ts:215-217` and `src/mcp/server.ts:20-22` build `API_BASE_URL` from `process.env.PORT` and `process.env.HOST` (default `localhost`). **There is no dedicated `API_BASE`/`MERMAID_COLLAB_URL` env var** — host/port are reused from the same `HOST`/`PORT` vars the server uses. Setting `HOST`/`PORT` in Claude Code's MCP env *would* repoint the stdio bridge, but the canonical path is `.mcp.json`'s `url` field for the HTTP transport.
- **VS Code extension**: `MERMAID_COLLAB_ROOT`, `CLAUDE_PLUGIN_ROOT`, `BUN_PATH` (`server-resolver.ts`); workspace setting `mermaidCollab.serverUrl`; `mermaidCollab.sshTunnelTarget`, `mermaidCollab.chromeDebugPort` (`ui-half.ts`).

**Can the MCP client be pointed at a remote host by config alone?** For the **protocol/transport layer: yes** — edit `.mcp.json` `url` to the remote/tunneled address (server binds `0.0.0.0` already). But this does **not** solve filesystem coupling (Section 2); the remote server still resolves `project` against its own disk.

---

## Synthesis

### (a) What already works for this topology
- HTTP MCP transport end-to-end; client and stdio bridge are HTTP clients. Repointing the URL is config-only.
- Server binds `0.0.0.0`, so it is network-reachable as-is.
- A complete, in-tree cross-machine pattern exists: VS Code `workspace-half`/`ui-half` with `vscode.workspace.openTunnel`, plus a raw `ssh -L` tunnel pattern for the Chrome CDP port.
- Filesystem instance registry + PORT=0 dynamic ports designed for forwarded-port scenarios.

### (b) Fundamentally coupled to co-location (server must be on the code host)
- Artifact storage: `join(project, '.collab', 'sessions', session)` written to the **server's** local fs (`session-registry.ts:271`, `routes/api.ts`). `project` is a real absolute path, not a namespace.
- Agent dispatcher / git-ops / checkpoints use `process.cwd()` (`server.ts:156-165`).
- Pseudo-db indexing, worktree-diff, worktree-files, file-content routes read the repo's source files locally.
- Instance discovery is `$HOME/.mermaid-collab/instances` on a shared filesystem.

These mean "server on A, code on B" is **not** achievable by config alone and not how the system is designed.

### (c) Recommended approach

**Primary (works today, zero code changes): Run the server on Machine B (the code machine), tunnel ports to Machine A.**
1. On B, start the server in the repo (`bun run src/server.ts`, optionally `PORT=0`). It writes `.collab/...` next to the code — correct by construction. Git/pseudo/agent features work because the repo is local to the server.
2. Forward B→A (or A→B, depending on which way Claude Code/UI connect) the API port: e.g. `ssh -L 9002:127.0.0.1:<serverPort> userB@machineB` from A — exactly the pattern in `ui-half.ts` for the Chrome port, or VS Code Remote-SSH's `openTunnel` if using the extension.
3. On the client side, point `.mcp.json` `url` at `http://127.0.0.1:9002/mcp` (the local end of the tunnel). The UI is reachable the same way (HTTP + `/ws`).
4. If Claude Code itself runs on B (per the stated topology), this is even simpler: Claude Code + server + code are all on B and talk over localhost; only the **UI/human** on A needs a forwarded port. This is the already-supported, well-trodden path.

**If the constraint truly requires the server process on Machine A while code stays on B**, the only viable options, in order of effort:
- **Shared/mounted filesystem**: mount B's repo onto A at the identical absolute path so `join(project, '.collab', ...)` resolves to the real repo (NFS/SSHFS). Fragile (path must match exactly, latency on git/pseudo, lockfile semantics over network fs are risky given `proper-lockfile` usage in `instance-discovery.ts`). Not recommended.
- **New storage abstraction**: introduce a remote-fs/RPC layer behind the artifact managers (`DiagramManager`/`DocumentManager`/session-registry) and the git/pseudo/agent paths so `project` becomes a handle resolved against Machine B. This is a substantial refactor touching `routes/api.ts`, `services/session-registry.ts`, agent dispatcher, pseudo, and worktree routes — effectively a new networked storage backend. Only justified if "server must be on A" is a hard requirement.

**Recommendation:** keep the server co-located with the code (Machine B) and forward ports to Machine A using the existing `ssh -L` / VS Code `openTunnel` precedent. Do not put the server on A unless a shared filesystem or a new storage-abstraction layer is in scope.
