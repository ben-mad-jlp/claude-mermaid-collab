# Windows installer — build plan & handoff

**Goal:** a one-step Windows experience — download `MermaidCollab-Setup.exe`, run it, it
provisions WSL + stages a prebuilt sidecar, then double-click to launch with **zero config**.

**Read this first if you're a Claude picking this up on the Windows box.** It carries the full
context of the bring-up that got us here (epic `68affdb7`, the Windows port). Everything upstream
of the installer is already on `master`; your job is Phases A→C below. Build/test the installer
LOCALLY on Windows — that's why this work moved here.

---

## Why this is on the Windows box — and which checkout
The NSIS installer can only be built + validated on native Windows (`electron-builder` win target),
and the whole loop is Windows-local: build `.exe` → install → launch → watch it drive WSL → debug.
Doing it from the Mac meant a push/pull/build/report round-trip per iteration.

**Work in the WINDOWS checkout, with Claude running natively on Windows (PowerShell).** That's the
tightest loop: edit `desktop/` code → build the Linux sidecar (`bun build --compile
--target=bun-linux-x64` runs on Windows) → `electron-builder` → install → test, all local, no sync.
The **WSL checkout becomes vestigial for installer work** — its only role is the *runtime* sidecar,
and Phase A replaces even that with a staged prebuilt binary, so you won't edit it. **Pick ONE source
of truth (the Windows checkout) and don't edit both** — they'll diverge. Keep the Windows checkout's
deps installed (`bun install --ignore-scripts` at root + `bun install` in `desktop/`; the native
`better-sqlite3` is irrelevant here since the sidecar is a prebuilt Linux binary).

## The architecture (decided + proven)
- **Decision `588c6df1`: Windows requires WSL2.** The sidecar runs INSIDE WSL2 as a native Linux
  process (real tmux, `ps`-subtree liveness, git worktrees, `claude` workers). Inside WSL
  `process.platform === 'linux'`, so the **proven mac/linux code path** runs unchanged
  (`TmuxSessionMux`, no wrapping).
- **Only the Electron shell is native Windows.** It renders the UI crisply (WSLg looks bad — don't
  ship that) and *spawns the sidecar into WSL* via `wsl.exe`.
- **The big simplifier for the installer: ship PREBUILT artifacts.** A self-contained
  `mc-server-linux-x64` (bun `--compile`) + a prebuilt `ui/dist`. With these staged into WSL, WSL
  needs **NO repo clone, NO bun, NO node_modules, NO build toolchain** — only `tmux`, `git`, and
  `claude` (for workers). This eliminates the worst failures we hit (node-gyp/`build-essential`,
  the OOM-prone UI build, the disk blowup).

## Current state on `master` (all shipped, v5.101.18→24)
- **Seam:** `src/services/session-mux/` — `mux.cmd(argv)` routes every tmux/ps spawn; identity on
  mac/linux, `WslTmuxSessionMux` wraps in `wsl.exe -d <distro> --` on win32. `mux.shellWrap` for the
  shell-string surfaces. `mux.list()` for restart-reconcile.
- **P6 launch logic (works in dev):** `src/services/wsl/sidecar-launch.ts` `buildWslSidecarCommand`
  → `wsl.exe -d <distro> -- bash -lc 'export PATH=…; <crossed env>; cd <repo>; exec <runtime>'`.
  Crosses only `MERMAID_*/MC_*/XAI_*` + `PORT/HOST/CDP_PORT` (not the Windows PATH); translates path
  env vars (`C:\…` → `/mnt/c/…`); prepends `~/.bun/bin:~/.local/bin:/usr/local/bin` to PATH (the
  login-shell PATH fix — bash -lc skips ~/.bashrc).
- **Wiring:** `desktop/src/main/server-supervisor.ts` `wrapSidecarForWsl` + a `spawnChild` branch
  GATED by `process.platform === 'win32' && process.env.MC_SIDECAR_IN_WSL === '1'`. Knobs:
  `MC_WSL_DISTRO` (default `Ubuntu`), `MC_WSL_REPO` (else `/mnt/c` translation of repoRoot),
  `MC_WSL_SERVER_BIN` (a Linux-native binary instead of `bun run src/server.ts`).
- **Detection/provisioning:** `src/services/wsl/wsl-detect.ts` (`detectWslState` → next step),
  `src/services/wsl/wslconfig.ts` (`setVmIdleTimeout`), `scripts/setup-wsl.ps1` (provision WSL +
  toolchain). `scripts/build-sidecar-linux.ts` → `dist/mc-server-linux-x64`.
- **PROVEN END TO END (dev mode):** Windows Electron (`cd desktop; $env:MC_SIDECAR_IN_WSL='1'; …; bun
  run dev`) spawns the sidecar in WSL and renders a native window. This is the baseline the installer
  must reproduce without a Windows source checkout or manual env vars.

## Build/packaging facts (already in the repo)
- `desktop/package.json` `"build"`: win target = `nsis`; `extraResources` already bundles
  `../ui/dist → ui/dist`, `../public → public`, and `resources/{mc-server,mc-server.exe,ffmpeg…}`.
- `desktop/scripts/build-sidecar.ts` builds the **host-target** sidecar into `desktop/resources/`
  (`mc-server.exe` on Windows). `MC_SIDECAR_TARGET` overrides the bun `--compile` target triple.
- `desktop/scripts/build-sidecar.ts` is run by `npm run dist` (`build:ui && build && build:sidecar &&
  electron-builder`).
- Prod resolution in `desktop/src/main/index.ts`: `serverBinaryPath = join(process.resourcesPath,
  win32 ? 'mc-server.exe' : 'mc-server')`; `resourcesPath = process.resourcesPath` when
  `app.isPackaged`.

---

## PHASE A — packaged app runs from the bundled prebuilt LINUX sidecar
Testable on this box NOW (you already have WSL + tmux + claude). Make `npm run dist` produce an
installer that, once installed, stages the bundled Linux sidecar into WSL and launches it — no
Windows source checkout, no WSL build.

1. **Bundle the Linux sidecar + ui/dist for the win build.** The win `extraResources` currently only
   ships `mc-server.exe` (a *Windows* binary that can't run in WSL). Add `mc-server-linux-x64`
   (built via `bun run scripts/build-sidecar-linux.ts` → `dist/mc-server-linux-x64`) as a win
   extraResource (e.g. copy to `desktop/resources/mc-server-linux` and add to the filter). `ui/dist`
   is already bundled. Decide whether the win build skips the Windows `mc-server.exe` entirely (it's
   dead weight on win since we always go to WSL).
2. **Default sidecar-in-WSL on win32 in PROD.** Today the WSL branch needs `MC_SIDECAR_IN_WSL=1`.
   For the packaged app, make it the default on win32 (still overridable). Edit the `spawnChild`
   gate in `server-supervisor.ts`, and have `index.ts` pass the WSL options (distro, server bin,
   staged repo/resources) instead of the Windows `serverBinaryPath`.
3. **Stage the prebuilt artifacts into WSL on launch.** Copy `mc-server-linux-x64` + `ui/dist` from
   `process.resourcesPath` (a Windows path) into a WSL dir (e.g.
   `~/.local/share/mermaid-collab/`), `chmod +x` the binary. Do it via `wsl.exe -d <distro> -- cp
   /mnt/c/…`  (translate the resources path with `winToWslPath`) or stream over stdin. Then set
   `MC_WSL_SERVER_BIN` = the staged binary and `MERMAID_RESOURCES_PATH` = the staged `ui/dist`
   (a WSL path), so `wrapSidecarForWsl` runs the binary (no bun, no repo).
4. **Verify the compiled Linux sidecar is self-sufficient.** `bun --compile` bundles the runtime; CONFIRM
   it carries `better-sqlite3` (native) or falls back to `bun:sqlite` — the Ubuntu headless installer
   (`scripts/install-linux-headless.sh`) uses `mc-server-linux-x64` successfully, so it should, but
   verify on a clean WSL. If it needs a sidecar `.node`, bundle + stage it too.
5. **Health + lifecycle:** the Windows supervisor health-checks `:9002` (WSL forwards localhost). On
   quit, kill the WSL sidecar cleanly (`wsl.exe -d <distro> -- pkill -f mc-server`, or track the pid).

**Phase A acceptance:** `cd desktop && npm run dist` (Windows) → install the `.exe` → it stages the
Linux sidecar into WSL, launches, health 200, native window shows the UI — on a box that has WSL +
tmux + claude but NO repo checkout / NO bun in WSL.

## PHASE B — first-run provisioning (fresh machine)
Make it work on a box with nothing set up:
1. On first launch, `detectWslState` (wsl-detect.ts). If WSL2/distro missing → run `setup-wsl.ps1`
   logic (or a bundled copy) with a progress dialog. Handle the reboot-needed case + the
   nested-virt wall (`HCS_E_HYPERV_NOT_INSTALLED`) with a clear message.
2. Ensure `tmux` + `git` in WSL (apt). Ensure `claude` installed + **logged in** (interactive — guide
   the user through `claude` login; workers can't run without it). Install the collab plugin so
   `/collab` + `/worker` + the `mcp__mermaid__*` tools exist (`.mcp.json` → `localhost:9002/mcp`).
3. Write `.wslconfig vmIdleTimeout=-1` (wslconfig.ts) so detached workers survive idle-shutdown.

## PHASE C — polish
- **Cross-boundary port-ownership bug (KNOWN, still open):** the Windows supervisor's port-ownership
  handshake reads a lockfile under Windows `$XDG_RUNTIME_DIR`, but the WSL sidecar writes its lock in
  WSL's filesystem — so on a RESTART the supervisor sees the live WSL sidecar as
  "held-by-unknown-process" and refuses. Fix: make the supervisor recognize a WSL-side sidecar
  (probe `/api/health` identity instead of the lockfile when sidecar-in-WSL), or have the WSL sidecar
  publish a lock the Windows side can read. (Workaround today: free `:9002` before launch.)
- Clean kill on quit; uninstall removes staged WSL artifacts; restart-reconcile (P3 `mux.list()`)
  across the boundary so workers re-attach after an app restart.

---

## Landmines we already hit (don't rediscover these)
- **WSL2 needs real nested virt.** Apple-Silicon Parallels Windows-ARM can't (`HCS_E_HYPERV_NOT_INSTALLED`);
  a normal PC / proper VM is fine. `wsl --version` + `wsl -l -v` (look for VERSION 2).
- **A broken/empty distro** (`getpwuid(0) failed`, `execvp(/bin/sh)`): `wsl --unregister <D>` +
  `wsl --install -d Ubuntu-24.04` (let first-run create the user — don't `--no-launch` for a manual install).
- **Clone in the WSL Linux home, NOT `/mnt/c`** (slow 9p + case-insensitive → breaks git worktrees).
- **`npm`/`node` leak from the Windows PATH into WSL** → `npm` resolves to Windows npm, spawns cmd,
  fails on UNC. Use `bun`. Silence + stop the leak: `/etc/wsl.conf` `[interop] appendWindowsPath=false`
  then `wsl --shutdown`.
- **`better-sqlite3` native build** needs `build-essential` in WSL (if building from source — the
  prebuilt binary path avoids this entirely; prefer it).
- **The UI production build is memory-heavy** (canvaskit + ~5MB chunk) → OOM-kills WSL. The prebuilt
  `ui/dist` (built on a build machine/CI) avoids it. If you must build in WSL: `NODE_OPTIONS=--max-old-space-size=6144`
  + give WSL RAM via `.wslconfig` `[wsl2] memory=8GB swap=8GB`.
- **WSL vhdx fills `C:` and doesn't auto-shrink** → compact with `diskpart` `compact vdisk` or
  `wsl --manage <D> --set-sparse true` after cleanup.
- **bun isn't on the `bash -lc` login PATH** (Ubuntu ~/.bashrc returns early non-interactive) →
  already fixed in `sidecar-launch.ts` (PATH prefix); the symlink fallback is
  `sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun`.
- **bun skips Electron's postinstall** (untrusted) → `node node_modules/electron/install.js`, or add
  `"trustedDependencies": ["electron"]` to `desktop/package.json`.
- **Port `:9002` conflicts** from a stale sidecar (WSL forwards localhost) → `pkill -f server.ts` /
  `pkill -f mc-server` in WSL, or check `Get-NetTCPConnection -LocalPort 9002` on Windows.

## Proven dev launch recipe (the baseline to reproduce)
```powershell
cd <windows-checkout>\desktop
$env:MC_SIDECAR_IN_WSL='1'; $env:MC_WSL_DISTRO='Ubuntu-24.04'; $env:MC_WSL_REPO='/home/<you>/code/claude-mermaid-collab'; bun run dev
```
Full user-facing guide: `docs/windows-install.md`. Validation findings:
`docs/../winport-wsl-validation` (collab session doc). Epic + LAND leaf: `68affdb7`.

## Key files
- `desktop/src/main/server-supervisor.ts` — `wrapSidecarForWsl`, `spawnChild` (the win32 gate to make default).
- `desktop/src/main/index.ts` — prod resource resolution (`serverBinaryPath`/`resourcesPath`); pass WSL opts here.
- `desktop/package.json` `"build"` — extraResources (add the Linux sidecar); `scripts/build-sidecar*.ts`.
- `src/services/wsl/sidecar-launch.ts` · `wsl-detect.ts` · `wslconfig.ts` · `scripts/setup-wsl.ps1`.
- `src/services/session-mux/` — the seam (`WslTmuxSessionMux`, `mux.cmd/shellWrap/list`).
