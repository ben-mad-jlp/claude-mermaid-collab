# mermaid-collab — Native Ubuntu/Linux Architecture

**Epic:** 48ee3871 · **Status:** Design (definitive) · **Anchor:** port-ownership-first (judge winner), grafted per synthesis guidance.

---

## 1. VISION + PACKAGING CHOICE

**The runtime already works on Linux.** tmux, the `ps -axo` subtree liveness (`claudeAliveInSubtree`), `capture-pane`, `pgrep -P`, and git worktrees are all native Linux primitives. There is **no SessionMux/tmux replacement to build** — that was the Windows problem (epic 68affdb7, decision 588c6df1 = require WSL). Linux needs none of it.

So this port is **plumbing + packaging + lifecycle**, and the **one genuinely-novel failure mode Linux adds is N starters racing for `:9002`** (systemd, Electron supervisor, plugin hook, bare CLI) — exactly the class that already burned a session on macOS (a stale plugin-cache `bun run src/server.ts` shadowing the real server, making every deploy cosmetic). Therefore **canonical `:9002` ownership is the spine of this design**, and the take-over-or-refuse handshake lives in the **shared server start path** so the fix hardens macOS too.

### Packaging: `.deb` primary (Ubuntu desktop) + AppImage portable fallback; headless ships a bare compiled sidecar under systemd. Reject Snap & Flatpak.

**The sandbox-vs-host-tools tension — resolved explicitly.** The server's *entire reason to exist* is spawning host `tmux`/`git`/`claude`/`bun` as children, walking their process subtree, and reading/writing the user's real `~/.mermaid-collab`, `~/.claude`, and project worktrees **anywhere on disk**. A confined sandbox is structurally hostile to that:

| Format | Spawns host tmux/claude/git? | Verdict |
|---|---|---|
| **AppImage** | YES — unconfined, inherits user PATH/env, no namespace | **SHIP** (portable/no-root fallback) |
| **.deb (apt)** | YES — unconfined; postinst owns lifecycle; declares `Recommends: git, tmux` | **SHIP** (primary Ubuntu desktop) |
| **Snap** | NO — strict confinement can't exec host binaries; `classic` rejected by Store for non-toolchains | **REJECT** |
| **Flatpak** | NO — bubblewrap forces `flatpak-spawn --host` shims around *every* spawn = rewrite of the session layer the brief forbids | **REJECT** |

Snap/Flatpak are rejected *because their sandboxes block the app's core mechanism*, not on taste. `.deb` is uniquely both **unconfined** (host-tool spawning works verbatim) and **distro-integrated** (apt fleet rollout, dependency declaration, postinst lifecycle).

**Bun bundling:** all targets ship the Bun `--compile --target=bun-linux-x64` single-file `mc-server` (the same artifact `desktop/build:sidecar` already produces for macOS, retargeted) → **zero PATH dependency on a bun runtime**. Host deps reduce to `tmux`/`git`/`claude` (git+tmux as `.deb` `Recommends:`; `claude` is user-installed, noted in postinst). **Confirmed:** Bun (compiled) and the `claude` CLI both run natively on Linux.

**Two-package split (.deb):** `mermaid-collab-server` (sidecar + systemd unit, **zero Electron**) and `mermaid-collab-desktop` (`Depends:` server + Electron). A headless install pulls no GUI bytes.

**Updates:** `.deb` → apt repo (`apt upgrade`) or `electron-updater` deb feed. AppImage → `electron-updater` + zsync delta. Headless → `scripts/deploy-linux.sh` swaps the binary + `systemctl --user restart`, then **asserts `/api/health` `version`+`exePath` == what was just installed** (the anti-cosmetic-deploy check).

---

## 2. DESKTOP + HEADLESS DUAL-TARGET — one codebase, Electron optional over the shared Bun server

**Desktop = headless + a window.** The server (`bin/mermaid-collab.ts start`) knows nothing about Electron; it is the **byte-identical artifact** in both targets. The only difference is *who plays the supervisor role* and *whether a `BrowserWindow` opens*.

```
        mc-server (Bun) — IDENTICAL binary both targets
        :9002 api · :9102 ui · Coordinator · spawns tmux/git/claude (native)
        runs the SAME bind-time ownership handshake (§4) before binding
                 ▲                                  ▲
   started + health-polled by              started + restarted by
   ServerSupervisor (Electron main)        systemd --user unit (no Electron)
   then opens BrowserWindow(:9102)
```

No fork: a `process.platform` branch inside `server-supervisor.ts` + a couple of thin platform helpers (`openExternal`, `binDirs`, `loginShell`) — **NOT** a full DI/AppHost seam (that's more refactor than a plumbing port warrants and risks churning the macOS path it claims to protect). Coordinator, DBs, routes, MCP: shared.

**Headless systemd USER unit** — `~/.config/systemd/user/mermaid-collab.service`:
```ini
[Unit]
Description=Mermaid Collab server
After=network-online.target

[Service]
Type=simple
ExecStartPre=%h/.local/share/mermaid-collab/mc-server preflight   # ownership handshake (§4)
ExecStart=%h/.local/share/mermaid-collab/mc-server start
Restart=on-failure
RestartSec=2
Environment=MERMAID_OWNER=headless
Environment=MERMAID_GUARD_MODE=takeover            # or =refuse on locked-down boxes
# units don't source rc files — pin PATH so tmux/git/claude/bun resolve:
Environment=PATH=%h/.bun/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin
Environment=MERMAID_RESOURCES_PATH=%h/.local/share/mermaid-collab/resources

[Install]
WantedBy=default.target
```
Enable: `systemctl --user enable --now mermaid-collab` + `loginctl enable-linger $USER`.

**Why USER not system unit:** the app touches `~/.mermaid-collab`, `~/.claude`, the user's git identity and `claude` login. A root/service-user unit breaks `claude` auth and HOME-relative paths. It must run **as the real user**.

**Desktop autostart** — `~/.config/autostart/mermaid-collab.desktop` (written by `.deb` postinst / first run):
```ini
[Desktop Entry]
Type=Application
Name=Mermaid Collab
Exec=/opt/mermaid-collab/mermaid-collab %U
X-GNOME-Autostart-enabled=true
```

**Mutual exclusion:** never both on one box (they'd fight for `:9002`). Installer picks one; the desktop install does **not** `enable` the systemd unit. The §4 guard is the runtime safety net if both somehow start.

---

## 3. SIDECAR / SERVICE LIFECYCLE

The seam already exists: `desktop/src/main/server-supervisor.ts` *spawns* the compiled sidecar (prod) or `bun run src/server.ts` (dev) and *health-polls `:9002`*. We keep it and make systemd a second, equivalent supervisor.

| Concern | Desktop (Electron ServerSupervisor) | Headless (systemd user unit) |
|---|---|---|
| **Start (RunAtLoad)** | autostart `.desktop` launches Electron → supervisor spawns sidecar | `enable` + `WantedBy=default.target` |
| **Boot w/o login** | n/a (user logs in) | `loginctl enable-linger $USER` — user manager starts at boot (the trimaxion remote-box case, escalation 4fdc4ad5) |
| **KeepAlive** | existing supervisor respawn/health loop | `Restart=on-failure`, `RestartSec=2` |
| **Stop/Restart** | quit app / supervisor restarts child | `systemctl --user restart mermaid-collab` |
| **Bind-time guard** | supervisor calls shared handshake before spawn | `ExecStartPre=mc-server preflight` |

**PATH starvation (the bite that already happened on macOS Dock launches):** GUI autostart `.desktop` and systemd units both inherit a *minimal* PATH missing `~/.bun/bin`, `~/.local/bin` → `tmux`/`claude` not found, session layer can't spawn. **Fix, both paths:**
- Electron: reuse the existing `resolveLoginPath()` login-shell trick (`server-supervisor.ts:71-106`, already a no-op only on win32 → Linux-safe), defaulting `$SHELL` to **`/bin/bash`** on Linux (not `/bin/zsh`).
- systemd: set `Environment=PATH=` explicitly (units don't source rc files).
- Add Linux bin dirs to `commonBinDirs` (`server-supervisor.ts:40-49`): `~/.bun/bin`, `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, `/snap/bin`.

---

## 4. CANONICAL :9002 OWNERSHIP + SHADOW-SERVER GUARD (the spine)

**Single rule:** exactly one process owns `:9002`, and **every starter must prove it is the rightful owner via a bind-time handshake before binding**. The handshake lives in the **shared server start path** (`bin/mermaid-collab.ts start` / `preflight`), so systemd, the Electron supervisor, and even a stray CLI all obey it — and **macOS gets the identical hardening**.

**(a) Identity in `/api/health`** — extend the existing *unauthenticated* route (`src/routes/api.ts:415`, `src/server.ts:547-549`), which already returns `pid` + `serverVersion`:
```json
{ "ok": true, "version": "5.90.1", "pid": 1234,
  "exePath": "/opt/mermaid-collab/mc-server",   // readlink /proc/self/exe — the thing macOS lacks
  "startedAt": "2026-06-09T...", "owner": "desktop|headless|dev" }
```

**(b) Lockfile** at `$XDG_RUNTIME_DIR/mermaid-collab/server.lock` = `{pid, exePath, version, port, owner}`. `$XDG_RUNTIME_DIR` is tmpfs cleared on logout → stale locks self-evaporate (better than `/tmp`). Written under `open(O_CREAT|O_EXCL)` to act as the take-over mutex (§9 race).

**(c) The take-over-or-refuse handshake** (run before binding, by ExecStartPre AND ServerSupervisor — replaces the **attach-blind hole at `server-supervisor.ts:250-253`**):
1. **`:9002` free?** → bind, write lock, RUN.
2. **Held?** → `GET /api/health`, read identity:
   - **Same `exePath`+`version`, pid matches lock** → correctly owned. **Idempotent no-op** (desktop just opens the window; ExecStartPre exits 0).
   - **Different `exePath`/`version` (THE SHADOW)** → stale/foreign collab server. **`MERMAID_GUARD_MODE`:**
     - `takeover` (default): `SIGTERM`→(timeout)→`SIGKILL` the holder pid, poll `ss -ltnp`/`lsof` until the port frees, bind, rewrite lock. **Log loudly.** Cross-check the holder's real binary via `/proc/<pid>/exe` so `exePath` can't be spoofed.
     - `refuse` (locked-down boxes): exit non-zero so systemd surfaces the conflict instead of killing a possibly-legit process.
   - **Port held but `/api/health` doesn't answer** (zombie / foreign non-collab) → kill by lock pid if it's ours; otherwise refuse + escalate (never kill an unknown process).
   - **NEVER silently coexist** — silent coexistence is exactly what made macOS deploys cosmetic.

**(d) Retrofitting the SessionStart/PreToolUse hook — minimal, per judge correction.** `hooks/server-check.sh` **already refuses** to fall back to a source server when the installed app is present; the remaining spawn (`:58-60`) is only the *"no desktop app installed"* path. So the fix is small: **gate that remaining `bun run src/server.ts &` fallback behind the same health probe** — if *anything* already holds `:9002`, the hook does nothing (never spawns a competitor); it may only spawn if the port is free. The **real structural defense is the bind-time handshake (c) evicting any stale holder regardless of who spawned it** — not disabling the hook. The hook is never a canonical owner; the desktop/systemd starters out-rank a `dev` holder.

**Result:** "who owns :9002?" is answerable at any instant by `curl :9002/api/health` + `cat $XDG_RUNTIME_DIR/mermaid-collab/server.lock`. systemd's single-instance guarantee covers the systemd case for free; the handshake covers every non-systemd stray. The shadow class is structurally dead **on both platforms**.

---

## 5. XDG PATH LAYER + DB MIGRATION DECISION

**New Linux-only artifacts use XDG; the DBs STAY put.**

| Artifact | Location |
|---|---|
| `.deb` code | `/opt/mermaid-collab/` (desktop) · headless binary `~/.local/share/mermaid-collab/` |
| Unit / `.desktop` files | `$XDG_CONFIG_HOME/mermaid-collab` (`~/.config/...`) |
| Sidecar binary + resources (headless) | `$XDG_DATA_HOME/mermaid-collab` (`~/.local/share/...`) |
| Logs / caches | `$XDG_CACHE_HOME/mermaid-collab`; Electron `app.getPath('logs')` auto-maps here — no code change |
| Ownership lock | `$XDG_RUNTIME_DIR/mermaid-collab/server.lock` |

**DB MIGRATION CALL: KEEP `~/.mermaid-collab/` — do NOT move `supervisor.db` / `todos.db` / `session-status.db`.** The root is hard-wired across `src/config.ts`, `src/server.ts:53` (`SCRATCH_PROJECT`), tech-packs, the `MERMAID_SUPERVISOR_PROJECT`/`MERMAID_STEWARD_PROJECT` defaults, MCP setup, IDE routes — and is **cross-platform-shared with macOS**. It's already a hidden dotdir (not `~/Library`), works on Linux unchanged, and every path is env-overridable. (`todos.db`/`session-status.db` are already per-project under `<project>/.collab/`.) Moving it Linux-only forks the path logic; moving it everywhere is a risky migration for **zero user-visible gain** — migration cost > purity. If XDG purity is ever demanded: `~/.local/share/mermaid-collab → symlink → ~/.mermaid-collab`, **never a data move**.

---

## 6. macOS-CALL REPLACEMENTS

| macOS call / asset | Where | Linux replacement |
|---|---|---|
| `open -a` / `open <url>` | various | `xdg-open` (branch on `process.platform` via the `openExternal` helper) |
| `osascript ... to quit` | `deploy.ts` | SIGTERM (no AppleScript server-side — confirmed clean) |
| `/Applications/Mermaid Collab.app` | deploy scripts | `.deb`: `/opt/mermaid-collab/`; AppImage: mount/extract dir; headless: `~/.local/share/mermaid-collab/` |
| `open`/`pkill -f .../MacOS`/relaunch-by-path | `deploy-desktop.sh` | **headless:** `systemctl --user restart`; **desktop:** app relaunch / `electron-updater` |
| `pkill -f "bun run src/server.ts"` (shadow sweep) | deploy | replaced by §4 identity take-over (kill the *specific* health/lock pid — precise, not name-matched) |
| `lsof -iTCP:9002` port-free loop | deploy | keep — `lsof`/`ss -ltnp` both on Linux; pair with the §4 guard |
| `ditto` (bundle swap) | deploy | `install`/`cp`; for `.deb` dpkg does the swap |
| `commonBinDirs` (`/opt/homebrew/bin`) | `server-supervisor.ts:40` | add `~/.bun/bin`, `~/.local/bin`, `/usr/bin`, `/snap/bin` (homebrew dirs harmlessly absent) |
| default login shell `/bin/zsh` | `resolveLoginPath:84` | `/bin/bash` on Linux |
| `mc-server.exe` binary name branch | `index.ts:451` | already falls through to `mc-server` — **no change**, but build it for Linux |

---

## 7. INSTALL LAYOUT + LIFECYCLE + PORT-OWNERSHIP (ASCII)

```
INSTALL LAYOUT
 /opt/mermaid-collab/                  (.deb desktop)  Electron app + bundled mc-server + preflight
 ~/.local/share/mermaid-collab/        (headless)      mc-server (compiled, bun-linux-x64) + resources/
 ~/.config/systemd/user/mermaid-collab.service          headless lifecycle
 ~/.config/autostart/mermaid-collab.desktop             desktop autostart
 ~/.config/mermaid-collab/             config.json (XDG); Electron userData
 ~/.cache/mermaid-collab/              logs/caches (Electron getPath('logs'))
 $XDG_RUNTIME_DIR/mermaid-collab/server.lock   {pid,exePath,version,port,owner}  (tmpfs, self-clearing)
 ~/.mermaid-collab/                    supervisor.db · config.json · registries   (KEPT, shared w/ macOS)
   <project>/.collab/                  todos.db · session-status.db               (per-project, untouched)

LIFECYCLE
 HEADLESS: boot ─(linger)─▶ systemd --user ─▶ ExecStartPre: mc-server preflight (guard)
                                            └▶ ExecStart:  mc-server start  ─▶ :9002/:9102
           crash ─Restart=on-failure(2s)─▶ respawn        (KeepAlive equiv)
           deploy ─▶ swap binary ─▶ systemctl --user restart ─▶ ASSERT /api/health version+exePath
 DESKTOP:  login ─(autostart.desktop)─▶ Electron ─▶ ServerSupervisor ─▶ (same guard) ─▶ mc-server ─▶ BrowserWindow(:9102)

PORT :9002 OWNERSHIP HANDSHAKE  (every starter, before bind)
   start
     │  :9002 free? ──yes──▶ bind + write lock (O_EXCL) ──▶ OWN
     │     │no
     │     ▼
     │  GET /api/health → {exePath,version,pid}
     │     ├─ same exe+ver, pid=lock ───────▶ idempotent no-op (desktop: open window)
     │     ├─ DIFFERENT (shadow) ─ takeover ─▶ TERM→KILL pid ─▶ wait port free ─▶ bind ─▶ OWN
     │     │                       refuse   ─▶ exit≠0 (systemd surfaces conflict)
     │     └─ held but health dead ─────────▶ kill lock pid (if ours) / refuse+escalate
     └─ plugin hook: port held → DO NOTHING; spawns only if port free (never canonical owner)
```

---

## 8. TECHNICAL PLAN

### Changed (reused, platform-branched — macOS path behaviorally untouched)
- **`src/routes/api.ts` (~:415)** + **`src/server.ts` (~:547)** — add `exePath` (`readlink /proc/self/exe`), `startedAt`, `owner` to `/api/health`; write/refresh the `$XDG_RUNTIME_DIR` lockfile on bind.
- **`bin/mermaid-collab.ts`** — add `preflight` subcommand + the shared take-over-or-refuse handshake + lock write/read on `start` (shared by all starters; **macOS benefits too**).
- **`desktop/src/main/server-supervisor.ts`** — (a) replace attach-blind (`:250-253`) with the handshake; (b) `commonBinDirs` (`:40-49`) add Linux dirs; (c) `resolveLoginPath` (`:84`) default `/bin/bash` on Linux; (d) `openExternal`/`binDirs`/`loginShell` thin helpers (NOT a full AppHost interface).
- **`desktop/src/main/index.ts`** — no logic change (sidecar name `:451` already Linux-correct; dock/menu already `darwin`-guarded; `window-all-closed` already quits non-darwin). **Verify only**, build the Linux target.
- **`src/config.ts`** — XDG resolution for *new* lock/resources paths only; **DB roots unchanged**.
- **`hooks/server-check.sh` (`:58-60`)** — gate the remaining no-app source-spawn behind a `/api/health` probe (don't spawn if `:9002` held). Minimal.
- **`scripts/deploy.ts`** — add Linux branch (`systemctl`/SIGTERM instead of `open`/`osascript`).

### New
- `packaging/systemd/mermaid-collab.service`, `packaging/autostart/mermaid-collab.desktop`.
- `packaging/debian/` — `control` (two packages `-server`/`-desktop`), `postinst` (`daemon-reload`, `enable-linger`, write autostart for desktop, "install claude CLI" notice), `prerm`/`postrm`.
- `scripts/deploy-linux.sh` — build sidecar (`--target=bun-linux-x64`) + ui → install → `systemctl --user restart` (or app relaunch) → **poll `/api/health` and assert `version`+`exePath` == just-installed**.
- `scripts/install-linux-headless.sh` — first-time: drop binary, write unit, `enable --now`, `enable-linger`.
- electron-builder `linux` targets (`deb`, `AppImage`) + `electron-updater`.

### Reused (untouched)
Entire session layer — `coordinator-live.ts`, `tmux-*.ts`, `lane-session-register.ts`, `worktree-manager.ts`, `git-ops.ts`; `chrome-manager.ts` (already 3-way platform switch — the precedent); `src/server.ts:70` headless-Chrome detect (already Linux-aware); `session-start-hook.sh` (already BSD/GNU stat fallback).

### Deleted
Nothing. `scripts/deploy-desktop.sh` stays `darwin`-only as-is. No tmux/SessionMux replacement. No DB migration. No Snap/Flatpak.

### Deps
`electron-builder` linux targets (`deb`, `AppImage`); `electron-updater`; `bun build --compile --target=bun-linux-x64`; `.deb` `Recommends: git, tmux`. No new runtime npm deps.

### PHASED PLAN
- **Phase 0 — Port-ownership protocol + server portability (the spine, lands FIRST).** `/api/health` identity fields; `$XDG_RUNTIME_DIR` lockfile; the shared handshake + `preflight` subcommand in `bin/mermaid-collab.ts`; retrofit `hooks/server-check.sh`; `open→xdg-open`; Linux `commonBinDirs` + `/bin/bash`; `bun build --compile --target=bun-linux-x64`. **No Electron, no packaging.** This is load-bearing and hardens macOS immediately, so it ships before everything.
- **Phase 1 — HEADLESS systemd MVP (SHIP FIRST after Phase 0). YES, headless-first.** Ship the **bare compiled sidecar** under the systemd user unit + `enable-linger` + `install-linux-headless.sh` + `deploy-linux.sh`, with the full §4 guard end-to-end + verify `ps -axo` parsing on GNU ps. **Why first:** zero Electron, zero packaging-format risk; it validates the only genuinely-uncertain claim — Bun server + Coordinator + tmux/git/claude session layer runs on a real remote Linux box (the trimaxion case). Fastest path to "collab runs on Linux."
- **Phase 2 — DESKTOP `.deb`.** Wrap the proven server in Electron (Linux-branched ServerSupervisor), `.deb` `-desktop` package (`Depends:` `-server`), `.desktop` autostart via postinst, `Recommends: git, tmux`, apt / `electron-updater` deb feed.
- **Phase 3 — AppImage + auto-update.** Portable no-root artifact, `electron-updater` + zsync delta for users off the apt repo.
- **Phase 4 (defer).** XDG symlink shim; Flatpak only if a distro channel ever demands an unconfined build (not recommended).

---

## 9. WHY-OVER-ALTERNATIVES + TOP RISKS

**Why port-ownership-first over the alternatives:**
- vs **shared-core-two-shells** — that concept's full `AppHost` DI interface is more refactor than a plumbing port warrants and touches the macOS path it claims to protect. We graft only the *discipline* (one shared preflight fn + thin host helpers), not the seam.
- vs **appimage-desktop-first** — running Electron headless as a babysitter on a GTK-less remote server is the wrong default (FUSE, `--no-sandbox`, self-update-under-systemd contradictions); that concept itself walks it back to a bare sidecar. We ship the bare sidecar directly for headless.
- vs **deb-system-package** — we keep its best parts (two-package split, systemd-as-structural-owner, postinst `enable-linger`) but don't make the heavy apt-repo (`reprepro`/`aptly`) lift a prerequisite; AppImage covers off-repo users.

**Top risks + mitigations:**
1. **Take-over race** (two starters at the same instant). → `open(lock, O_CREAT|O_EXCL)` as mutex *before* killing; loser re-runs the handshake (now sees a valid owner → refuses). Bounded TERM→timeout→KILL with `ss -ltnp` port-free poll.
2. **PATH starvation on systemd/autostart launches** (the macOS Dock bite). → explicit `Environment=PATH=` for systemd + reuse `resolveLoginPath()` for Electron + Linux `commonBinDirs`. Guarantee tmux/git/claude/bun resolve.
3. **`ps -axo` parsing on GNU ps** (BSD `-axo` accepted but `comm` truncation differs; `coordinator-live.ts:89`, `fleet-status.ts:78`, `tmux-reaper.ts`). → match on command *substring*, prefer untruncated pid/ppid columns, smoke-test on a real box in Phase 1. The one runtime watch-item — a parse check, not a redesign.
4. **Boot without login on remote boxes.** → `loginctl enable-linger $USER`.
5. **Cosmetic deploys recurring.** → `deploy-linux.sh` asserts `/api/health` `version`+`exePath` post-restart; mismatch fails loudly.

---

## EXECUTIVE SUMMARY

**Vision:** The Linux runtime already works (tmux/ps-subtree/worktrees are native — no SessionMux to build); the port is plumbing + packaging + lifecycle, and the **only novel risk is N starters racing for `:9002`**, so **canonical port ownership is the spine** and its handshake lives in the shared server start path (hardening macOS too).

**Packaging/lifecycle:** Ship the **Bun `--compile` sidecar everywhere** (no bun-on-PATH dep); **`.deb` primary** (two packages: `-server` Electron-free, `-desktop`) + **AppImage** portable fallback; **reject Snap/Flatpak** (confinement structurally blocks spawning host tmux/git/claude). **Headless = systemd user unit** (`Restart=on-failure` + `loginctl enable-linger`); **desktop = the same server + an Electron window** via the existing ServerSupervisor + autostart `.desktop`. Keep DBs at `~/.mermaid-collab` (no migration); XDG only for new artifacts + the `$XDG_RUNTIME_DIR` lock.

**Phase-0 first move:** the **port-ownership protocol** — `/api/health` identity (`pid`/`version`/`exePath` via `/proc/self/exe`/`owner`), the `$XDG_RUNTIME_DIR` lockfile, and the **take-over-or-refuse handshake** in `bin/mermaid-collab.ts` (shared by systemd `ExecStartPre`, the Electron supervisor, and the gated hook) — plus the small portability fixes. Then **Phase 1 = headless systemd MVP shipped first**, validating the server on a real remote Linux box with zero Electron/packaging risk.

**Single biggest risk:** the **take-over race** — two starters reaching the handshake simultaneously could double-kill/double-bind. Mitigated by an `O_EXCL` lockfile mutex acquired *before* any kill, with the loser re-running the handshake and refusing once a valid owner is present.
