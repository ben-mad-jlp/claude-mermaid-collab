# Installing mermaid-collab on Windows (WSL2)

The Windows port runs the collab **sidecar inside WSL2** (a real Linux environment),
so the worker-session layer (tmux, `ps`-subtree liveness, git worktrees, `claude`
workers) runs natively and unchanged. Only the optional desktop shell stays on
Windows. The whole worker substrate IS Linux — which is why the existing Linux
tooling "just works" inside WSL.

There are three ways to run it. **Do Path A first** — it's the fastest proof and
needs no installer. Paths B and C build on the same WSL setup.

---

## 0. Prerequisites — a genuinely WSL2-capable host

WSL2 needs working CPU virtualization. This is the one hard gate.

- A native Windows 10 (22H2+) / 11 PC with virtualization enabled in firmware → fine.
- A bare-metal or cloud Windows VM that exposes **nested virtualization** → fine.
- An Apple-Silicon Parallels VM running Windows-on-ARM → **does NOT work**
  (`HCS_E_HYPERV_NOT_INSTALLED`); nested Hyper-V isn't exposed to the guest.

Quick check (PowerShell): `systeminfo` → the "Hyper-V Requirements" / virtualization
line should be Yes (or "a hypervisor has been detected"). If `wsl --set-version … 2`
later fails with `HCS_E_HYPERV_NOT_INSTALLED`, the host can't do WSL2 — use another machine.

> The compiled sidecar binary (`mc-server-linux-x64`, Path B) targets **x64**. On an
> **ARM64** Windows host, run from source (`bun`, Path A) instead — bun is cross-arch.

---

## 1. Provision WSL2 + the toolchain (once, on the Windows side)

From a checkout of this repo (you can clone it on Windows just to get the script, or
copy `scripts/setup-wsl.ps1` over), in an **Administrator PowerShell**:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-wsl.ps1 -Distro Ubuntu-24.04
```

This idempotent script:
1. enables the **Virtual Machine Platform** + **WSL** Windows features,
2. installs/updates the WSL engine and sets default version 2,
3. installs **Ubuntu-24.04** on WSL2,
4. disables WSL2 idle-shutdown (`%USERPROFILE%\.wslconfig` → `[wsl2] vmIdleTimeout=-1`,
   so detached worker sessions survive the fleet going quiet),
5. installs the in-WSL toolchain: **tmux, git, bun**.

If it just enabled the Windows features, **reboot and re-run it**. If it stops at the
nested-virt error, see §0.

Create your Linux user on first entry (if not already): `wsl -d Ubuntu-24.04` and follow
the prompt (or it runs as root with `--no-launch` installs — `sudo adduser <you>` then
`wsl -d Ubuntu-24.04 -u <you>`).

---

## 2. Get the repo + dependencies INSIDE WSL

Work in your **Linux home** (ext4) — NOT under `/mnt/c` (the 9p bridge is slow and
case-insensitive, which breaks git worktrees):

```bash
# inside WSL (wsl -d Ubuntu-24.04)
cd ~
git clone <your-repo-url> mermaid-collab
cd mermaid-collab
bun install
( cd ui && bun install )
```

---

## 3. Install + authenticate the `claude` CLI inside WSL

Workers ARE `claude` running in tmux, so Claude Code must be installed and logged in
**inside WSL** (not the Windows-side claude):

```bash
# inside WSL — install Claude Code per Anthropic's current instructions, e.g.:
curl -fsSL https://claude.ai/install.sh | bash      # or: npm install -g @anthropic-ai/claude-code
claude        # run once, complete the browser login / auth, then exit
```

Without this the orchestrator will create lanes but the workers can't start.

---

## 4. Make the collab skills + MCP available to workers

A worker's `claude` is sent `/collab <session>` then `/worker <id>`, and uses the
`mcp__mermaid__*` tools. Both come from the mermaid-collab plugin + the project's
`.mcp.json` (which points the `mermaid` MCP server at `http://localhost:9002/mcp`).

Inside WSL, in any `claude` session, install the plugin from this repo's marketplace:

```
/plugin marketplace add ~/mermaid-collab
/plugin install mermaid-collab
```

The repo already ships `.mcp.json` (→ `localhost:9002/mcp`), so a `claude` launched
with the repo (or any project containing that `.mcp.json`) gets the tools once the
sidecar is up. Restart `claude` after installing the plugin so the skills/MCP load.

---

## 5. Run the sidecar — pick a path

### Path A — Quick (dev, from source). Recommended first.

```bash
# inside WSL, in the repo
bun run src/server.ts          # binds http://localhost:9002
```

On **Windows**, open **http://localhost:9002** in a browser — WSL2 forwards `localhost`
automatically. That's the full collab UI. (Add the UI hot-reload with `bun run dev` if
you're developing.)

### Path B — Headless service (survives logout/reboot). Recommended to "leave it running".

WSL is Linux, so the repo's headless installer works — it stages a self-contained
sidecar binary under a **systemd user service**. First enable systemd in WSL2:

```bash
# inside WSL, once:
printf '[boot]\nsystemd=true\n' | sudo tee /etc/wsl.conf
```
```powershell
# on Windows, to apply:
wsl --shutdown
```
Then inside WSL:
```bash
cd ~/mermaid-collab
bash scripts/install-linux-headless.sh        # builds mc-server-linux-x64, installs + starts the user unit on :9002
#   --rebuild    force a fresh sidecar compile
#   --uninstall  stop + remove the unit and staged files
```
It enables `loginctl enable-linger` so the service survives logout. Verify with
`systemctl --user status mermaid-collab` and `curl localhost:9002/api/health`.

> The compiled binary still needs the UI bundle; the installer stages it. On ARM64
> Windows, skip Path B (x64 binary) and use Path A.

### Path C — Electron desktop app on Windows

The repo's electron-builder config already has a Windows **NSIS** target. Two options:

Run from source (fastest to try):
```powershell
# on Windows, in desktop/ with its deps installed
$env:MC_SIDECAR_IN_WSL = '1'
$env:MC_WSL_DISTRO      = 'Ubuntu-24.04'
$env:MC_WSL_REPO        = '/home/<you>/mermaid-collab'   # the WSL-side repo path
cd desktop ; npm run dev
```
The Electron shell stays native Windows and launches the sidecar inside WSL via
`wsl.exe -d <distro> -- bash -lc 'cd <repo>; exec bun run src/server.ts'`, talking to it
over `localhost:9002`.

Build the installer:
```powershell
cd desktop ; npm run dist        # produces an NSIS .exe under desktop/release/
```
⚠ The packaged app's default prod path expects a bundled **Windows** sidecar binary; the
sidecar-in-WSL lifecycle for the *packaged* app is the one remaining unfinished piece of
P6 (the launch logic exists via `MC_SIDECAR_IN_WSL`, but the installer doesn't yet stage
the WSL repo/bun or wire the WSL lifecycle by default). For a reliable bring-up today,
prefer Path A or B and use the browser UI; treat the desktop installer as experimental.

---

## 6. Verify it actually works

```bash
# inside WSL
curl -s localhost:9002/api/health        # → {"healthy":true,...}
```
Then in the UI (http://localhost:9002):
1. Open/create a project + session.
2. Set the project's orchestrator level (e.g. `build`) and give it a `ready` todo.
3. A worker spawns → confirm a `mc-*` tmux session exists in WSL: `tmux ls`.
4. The fleet view shows the worker live (liveness via the real-kernel `ps` subtree).
5. Restart the sidecar → the worker (detached tmux) survives and is re-attached by the
   restart-reconcile; the WSL VM doesn't idle-kill it (`vmIdleTimeout=-1`).

---

## 7. Configuration knobs (env)

| Var | Meaning |
|---|---|
| `MC_SIDECAR_IN_WSL=1` | (desktop) launch the sidecar inside WSL from the Windows Electron shell |
| `MC_WSL_DISTRO` | WSL distro name (default `Ubuntu`) |
| `MC_WSL_REPO` | WSL-side repo path (else a `/mnt/c` translation of the Windows repo path) |
| `MC_WSL_SERVER_BIN` | run a Linux-native `mc-server` binary instead of `bun run src/server.ts` |
| `PORT` | sidecar port (default `9002`) |

Backend selection is automatic: inside WSL `process.platform === 'linux'` → the native
`TmuxSessionMux` (no wrapping); a Windows-native sidecar → `WslTmuxSessionMux` (wraps each
tmux/ps call in `wsl.exe -d <distro> --`).

---

## 8. Troubleshooting

- **`HCS_E_HYPERV_NOT_INSTALLED` / "virtualization is not enabled"** — the host can't run
  WSL2 (§0). Enable virtualization in firmware, or use a host with nested virt.
- **UI not reachable from Windows** — confirm the sidecar bound (`curl localhost:9002/api/health`
  inside WSL); WSL2 forwards `localhost`, but a corporate VPN/firewall can interfere.
- **Worker spawns but does nothing** — `claude` isn't installed/authed in WSL (§3) or the
  plugin/MCP isn't loaded (§4). Run `claude` manually in WSL and try `/collab` + an
  `mcp__mermaid__*` tool to confirm.
- **Worker dies immediately** — usually a missing in-WSL tool (tmux/git/bun) or node_modules;
  re-run `bun install` (root + `ui/`) inside WSL.
- **Slow git / weird file casing** — the repo is under `/mnt/c`; move it to the Linux home (§2).
- **Service didn't survive reboot (Path B)** — systemd not enabled in WSL (`/etc/wsl.conf`
  `[boot] systemd=true` then `wsl --shutdown`), or linger not set (`loginctl enable-linger`).
