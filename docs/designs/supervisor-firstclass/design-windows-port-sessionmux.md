# Windows Port of the Worker-Session Layer — `SessionMux` Architecture

Status: design-final · Local-first single-user Bun + Electron · No regression to the proven mac/linux tmux path

---

## 1. VISION & the chosen Windows backend

**The problem in one sentence:** tmux's only irreplaceable property is that it is a *separate, long-lived process that owns a worker's PTY by name and outlives whoever talks to it*. Capture, send-keys, kill, and liveness are thin readouts of that ownership. Windows has no tmux, so we must reproduce that one property.

**Chosen end-state backend: an out-of-process session daemon (`mc-sessiond`).** Electron launches one long-lived daemon, detached and broken out of the sidecar's job object. The daemon owns every worker's ConPTY (via the already-vendored `node-pty`) in its own memory. `mc-server` (the sidecar on `:9002`) becomes a **stateless RPC client** of the daemon over a named pipe. On mac/linux the "daemon" *is* the tmux server — unchanged. On Windows it is our ~300-line binary.

**Why a daemon over the per-lane-host / log-journal / WSL-primary alternatives:**

- **Persistence becomes structural, not reconstructed.** A worker survives a sidecar restart because *its parent (the daemon) never restarted*. On reconnect the sidecar calls `list()` and the daemon answers authoritatively from live PTY handles — no PID-recycle re-adoption race, no liveness-probe guesswork to rebuild the in-memory `worker-pool` registry (today's `Map` at `worker-pool.ts:148` with no disk persistence — the core gap this fixes).
- **Attach/capture work immediately after restart.** The PTY handle never left the daemon's memory, so there is no "re-attach to a dead ConPTY" problem (the Achilles heel of every per-lane detached-process design).
- **One footgun, not N.** The `CREATE_BREAKAWAY_FROM_JOB` + start-time-validation complexity lives in exactly **one** spawn (the daemon launch), not in every worker lane.
- **Zero install footprint.** No WSL distro, no `\\wsl$` path translation threading through `worktree-manager`, no `/mnt/c` 9p tax. Repo, PTY, and process-probe all stay native on one filesystem — the right call for a local-first single-user desktop app.

**Grafts taken from the field (per judge):**

1. **WSL2 IS Phase 0** (contra the daemon concept's "WSL for free as config" hand-wave). A Windows user with WSL selecting `TmuxSessionMux`-inside-WSL is the cheapest way to prove the `SessionMux` seam + pool-wiring + `list()`-restart-reconcile against **real running `claude` workers with zero claude-on-native-Windows risk** — and it de-risks the single biggest unknown both daemon concepts wave past: *does claude's TUI even render/drive correctly via raw ConPTY on native Windows?*
2. **Breakaway + GetProcessTimes start-time validation on the daemon launch** (from seam-first / native-conpty). Bun/Node `detached` does **NOT** set `CREATE_BREAKAWAY_FROM_JOB` — this needs `bun:ffi`/Koffi `CreateProcessW`. A startup self-test ("spawn daemon, kill spawner, confirm daemon survives") gates backend availability.
3. **Per-session log tee** (from detached-logjournal). The daemon mtimes every PTY write to `%LOCALAPPDATA%\mc\logs\<name>.log` as a **cheap restart-proof secondary stall signal** and a graceful "these lanes were lost" surface if the daemon ever dies — but **NOT** as the primary capture model.

**Honesty:** the daemon is a new single point of failure — if it dies, all workers die. That is exactly why grafts (1) the WSL fallback, (3) the log-tee "lanes lost" surface, and a restart-on-failure scheduled task all matter. We do not claim daemon I/O is "strictly better"; we claim it is the cleanest *persistence* story given the real constraints.

---

## 2. The `SessionMux` interface (+ how tmux satisfies it unchanged)

Derived strictly from the 8 tmux verbs the 42 call-sites actually use. Pure helpers (`claudeAliveInSubtree`, the pane regexes) stay **outside** the interface — they are already pure and port verbatim.

```typescript
// src/services/session-mux/SessionMux.ts
export interface ProcNode { pid: number; ppid: number; comm: string; cmd: string }
export type ProcSnapshot = Map<number, { children: number[]; comm: string; cmd: string }>;

export interface SessionInfo {
  name: string;       // always tmuxBaseName(project, session) = mc-<repo>-<lane>
  cwd: string;
  hostPid: number;    // PTY-owning shell pid — the tmux pane_pid equivalent, BFS root
  startedAt: number;  // epoch ms — restart-robust clock + PID-recycle guard
  startPath: string;  // pane_start_path equivalent (heal probe)
}

export interface SessionMux {
  /** tmux new-session -d -s <name> -c <cwd>. Idempotent: no-op if exists. */
  ensure(name: string, cwd: string): Promise<{ exists: boolean; created: boolean }>;

  /** tmux has-session -t <name>. The restart-survivable re-discovery primitive. */
  exists(name: string): Promise<boolean>;

  /** tmux send-keys -t <name> -l <text>; 150ms; send-keys Enter. The split is load-bearing. */
  sendKeys(name: string, text: string): Promise<void>;

  /** tmux capture-pane -t <name> -p [-S -<scrollback>]. */
  capture(name: string, scrollback?: number): Promise<string>;

  /** tmux list-panes -t <name> -F '#{pane_pid}' → BFS root for liveness. */
  panePid(name: string): Promise<number | null>;

  /** tmux display-message -p '#{pane_start_path}' → cwd at creation (heal probe). */
  paneStartPath(name: string): Promise<string | null>;

  /** tmux kill-session -t <name>. Caller frees the pool slot. */
  kill(name: string): Promise<void>;

  /** NEW: tmux list-sessions. The persistence query that replaces in-memory registry on restart. */
  list(): Promise<SessionInfo[]>;

  /** One snapshot of the whole process table. ps -axo / Win32_Process. */
  processTree(): Promise<ProcSnapshot>;

  /** argv node-pty spawns INSIDE a PTY to attach the UI to a named session. */
  attachCommand(name: string): string[];

  /** tmux -V / wsl probe / daemon ping. The single platform-capability gate. */
  isAvailable(): Promise<boolean>;
}

// Pure, already unit-tested, shared by EVERY backend unchanged:
export function claudeAliveInSubtree(rootPid: number, snap: ProcSnapshot): boolean;
```

Two deliberate additions beyond today's surface:
- **`list()`** — tmux has `list-sessions`; today's code never used it because it leaned on the in-memory Map. This is the method that replaces disk-persistence of the registry: on restart, rebuild `worker-pool`'s Map authoritatively from `list()`.
- **`startedAt` / `hostPid`** in `SessionInfo` — the restart-robust clock that today is faked with persisted `claimedAt`, and the BFS root.

**`TmuxSessionMux` (mac/linux) is a byte-parity mechanical extraction**, not a rewrite. Each method is the existing `Bun.spawn(['tmux', …])` lifted verbatim out of its current call-site, gated by a **golden-argv regression test** asserting the produced argv arrays equal today's literals.

| method | tmux body (verbatim) |
|---|---|
| `ensure` | `tmux has-session -t N || tmux new-session -d -s N -c CWD` |
| `exists` | `tmux has-session -t N` (exit 0) |
| `sendKeys` | `tmux send-keys -t N -l TEXT` → 150ms → `send-keys -t N Enter` (the load-bearing split from `tmux-send.ts`) |
| `capture` | `tmux capture-pane -t N -p [-S -10000]` |
| `panePid` | `tmux list-panes -t N -F '#{pane_pid}'` |
| `paneStartPath` | `tmux display-message -p -t N '#{pane_start_path}'` |
| `kill` | `tmux kill-session -t N` |
| `list` | `tmux list-sessions -F '#{session_name} #{session_created} …'` (new wiring, native verb) |
| `processTree` | `ps -axo pid=,ppid=,comm=` → existing regex parse (cmd=comm) |
| `attachCommand` | `['tmux','attach-session','-d','-t',N]` |
| `isAvailable` | existing `isTmuxAvailable()` cache |

Backend selection at one site (the existing `tmux-availability.ts` gate slot):

```typescript
export const mux: SessionMux =
  process.platform !== 'win32'        ? new TmuxSessionMux()
  : process.env.MC_BACKEND === 'wsl'  ? new WslTmuxSessionMux(distro)   // Phase 0 + permanent fallback
  :                                     new DaemonSessionMux();          // the product backend
```

---

## 3. The WINDOWS backend — `mc-sessiond` + `DaemonSessionMux` (concrete)

Two pieces: a **long-lived daemon** (owns workers) and a thin **client** (`DaemonSessionMux`, what the sidecar uses).

### 3.1 The daemon `mc-sessiond`

A tiny compiled Bun binary (reuses the `bun build --compile` pipeline that already produces `mc-server`), shipped beside it in the Electron bundle. It:

1. Holds `Map<name, Session>` where each `Session` owns a live **node-pty ConPTY** (`pty.spawn(shell, [], {cwd, cols, rows})`; `claude` is driven in via `sendKeys` exactly as tmux runs a shell then `send-keys` the worker skill).
2. Keeps a **ring buffer** (~256 KB, the `capture-pane` equivalent) per session, timestamping every write, **and tees the same bytes to** `%LOCALAPPDATA%\mc\logs\<name>.log` (graft 3).
3. Listens on named pipe `\\.\pipe\mc-sessiond` for newline-delimited JSON-RPC (`{id, method, params}` → `{id, result|error}`) — the `SessionMux` verbs.
4. Exposes a **per-session attach pipe** `\\.\pipe\mc-sessiond-attach-<name>` that replays the ring buffer then bridges live duplex to the ConPTY.
5. Writes a discovery file `%LOCALAPPDATA%\mc\sessiond.json {pipe, pid, startedAt}` so a fresh client can find-or-spawn it.

### 3.2 HOW A WORKER SURVIVES A SIDECAR RESTART (the crux)

```
Electron (native Win, UI)
  ├─ launch ONCE: CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS ─► mc-sessiond  (never restarts)
  │                                                                  ├─ ConPTY ─► shell ─► claude (lane A)
  │                                                                  └─ ConPTY ─► shell ─► claude (lane B)
  └─ launch/relaunch (transient) ────────────────────────────────► mc-server (:9002)  ── RPC client only
                                                                        │ named-pipe RPC
                                                                        └──────────────► mc-sessiond
```

- The daemon is spawned with **`CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`** so it is **not** in Electron/sidecar's job object (whose default `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` would otherwise murder it on exit — the #1 Windows footgun). Workers need no breakaway flag because *their* parent (the daemon) is already stable and detached.
- When `mc-server` crashes or is redeployed, the daemon's ConPTYs and the `claude` processes underneath keep running.
- On `mc-server` startup it calls **`mux.list()`** over the pipe. The daemon returns the authoritative live set; the sidecar rebuilds `worker-pool`'s `registry` Map + `deadTracker`/`idleTracker` from it. **No liveness-probe reconstruction, no PID re-adoption.** The persisted SQLite `todos.sessionName` (written pre-spawn at `coordinator-live.ts:774`) still names the lane; on restart we match `list()` entries to claimed todos by name. The reapers become *reconciliation against ground truth* rather than the only source of truth.
- **PID-recycle guard:** rarely needed here (the daemon hands us *live* host pids it actively holds, not persisted pids we re-adopt) — but the daemon validates `GetProcessTimes` start-time against its own `startedAt` on the discovery handshake, and the *daemon launch* itself is start-time-validated by the find-or-spawn client.

### 3.3 attach / capture / kill / sendKeys — verb mapping

| verb | `DaemonSessionMux` implementation |
|---|---|
| `ensure` | RPC `ensure` → daemon `hasSession`? no-op : `pty.spawn` + register; returns `{created}`. |
| `exists` | RPC `exists` → daemon Map hit. |
| `sendKeys` | RPC `keys` → **daemon** performs `write(text)` → 150ms → `write('\r')` (load-bearing split lives in the PTY owner so every transport gets it identically). |
| `capture` | RPC `capture` → ring buffer (deeper scrollback tails the `.log`). Byte-identical-over-time idle detection runs on this exactly like `capture-pane`; the daemon can also return `lastOutputAt` directly. |
| `panePid` | RPC → the ConPTY host/child pid the daemon already holds (the `#{pane_pid}` analog, BFS root). |
| `paneStartPath` | RPC → session `cwd` (heal probe). |
| `kill` | RPC `kill` → `pty.kill()` (terminates host + child tree), drop Map entry, tear down attach pipe. Caller frees the pool slot via `reapDeadSlots` keyed by name — no PID-recycle hazard (killed by name). |
| `list` | RPC `list` → `SessionInfo[]` from the live Map. **The restart-rebuild query.** |
| `attachCommand` | `['mc-attach','--pipe','\\.\pipe\mc-sessiond-attach-<name>']` — a tiny bundled helper node-pty spawns inside the UI PTY; it replays the ring buffer (scrollback) then bridges pipe↔stdio duplex. The PTY-WS layer is untouched; it just spawns this argv instead of `tmux attach`. Multi-attach supported (daemon fans out). |
| `processTree` | CIM snapshot — daemon-native preferred (it owns the host pids), client fallback if daemon down. |
| `isAvailable` | find-or-spawn ping; daemon binary always ships → effectively always true on Windows. |

---

## 4. LIVENESS / REAPING replacement (ps → CIM, mapped to WorkerState)

`processTree()` is the only platform-specific liveness call; **`claudeAliveInSubtree` BFS is reused verbatim.**

- **Primary: `Get-CimInstance Win32_Process`** → `ProcessId, ParentProcessId, Name, CommandLine`, one call, parsed into the same `Map<pid,{children,comm,cmd}>`.
- **CRITICAL CORRECTNESS: match on `CommandLine`, NOT `Name`.** Claude Code is a Node/Bun CLI — `Name` is `node.exe`/`bun.exe`, never `claude`. The BFS predicate becomes `/claude/i.test(node.cmd) || /claude/i.test(node.comm)`. This is the exact analog of the Unix BFS testing `node.comm` at `coordinator-live.ts:138`, and the single most important Windows correctness fix.
- **Reject `tasklist`** — no ParentProcessId, cannot reconstruct the subtree (usable only as a coarse "is PID alive" cross-check). **Reject WMIC** — deprecated/being removed.
- **Optional later:** `CreateToolhelp32Snapshot` (pid+ppid, no shell spawn) via FFI for latency — but Toolhelp `Name`-only has the same claude=node blind spot, so still cross-check CommandLine for matched pids.
- **On the WSL backend:** `processTree()` stays the original `ps -axo pid=,ppid=,comm=` (via `wsl ... ps`) with **zero rewrite**.

**Layered cheap signal (graft 3):** the daemon timestamps ring writes and tees to `<name>.log`; "host pid alive + log/ring mtime frozen over the window" corroborates `dead_shell`/idle **without** a CIM call, and is restart-proof.

**WorkerState mapping (`fleet-status.ts`) — logic byte-identical, only sources swapped:**

| WorkerState | tmux today | Daemon backend |
|---|---|---|
| `no_tmux` (→ `no_session`) | `has-session` fails | `exists(name)===false` (daemon Map miss) |
| `dead_shell` | host pid alive, `claudeAliveInSubtree===false` AND `!isClaudeTuiPresent(pane)` | host alive (daemon holds it) AND CIM-subtree BFS finds no `claude` in CommandLine AND TUI absent in `capture` — the live-host/dead-Claude blind-spot (63a59bd6) preserved; daemon can *also* report `claude` child exit synchronously for a deterministic signal |
| `working`/`idle`/`permission` | alive, pane-regex classified | claude in CIM subtree, same pure regexes (`isActivelyWorking`, `detectPermissionPrompt`, `paneSignature`) over `capture()` |
| `unknown` | `null` (no pid / no ps) → assume alive, never escalate | CIM failed / pipe timeout → `null`, same "never escalate on uncertainty" invariant (`coordinator-live.ts:59,146`) |

`DEAD_GRACE_MS` (45s) clock: use the daemon's `startedAt`/`lastOutputAt` where available, falling back to persisted `claimedAt` — restart-robust by construction.

---

## 5. Component / IPC diagram

```
                              WINDOWS HOST (native, no WSL on the product path)
 ┌─────────────────────────────────────────────────────────────────────────────────────────┐
 │  Electron (UI, native Win32)                                                              │
 │    │ spawn ONCE: CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS (bun:ffi CreateProcessW)    │
 │    │ spawn/relaunch (transient)                                                           │
 │    ▼                                              ▼                                       │
 │  ┌──────────────┐        named-pipe JSON-RPC    ┌──────────────────────────────────────┐ │
 │  │  mc-server   │◄────── \\.\pipe\mc-sessiond ─►│            mc-sessiond               │ │
 │  │  (:9002)     │  ensure/exists/sendKeys/      │   (long-lived; owns PTYs; never       │ │
 │  │              │  capture/kill/list/panePid/   │    restarts with the sidecar)         │ │
 │  │ DaemonSession│  processTree                  │   Map<name, Session>:                 │ │
 │  │  Mux (CLIENT)│                               │    ┌────────────────────────────────┐ │ │
 │  │ worker-pool  │  list() on restart ─rebuild──►│    │ ConPTY host ─► shell ─► claude  │ │ │
 │  │  registry    │                               │    │ ring buffer (capture)           │ │ │
 │  │ coordinator  │                               │    │ startedAt, lastOutputAt         │ │ │
 │  │ fleet-status │                               │    │ tee ─► %LOCALAPPDATA%\mc\logs\  │ │ │
 │  └──────┬───────┘                               │    └────────────────────────────────┘ │ │
 │         │ WS terminal (PTYManager /             │   CIM Win32_Process snapshot           │ │
 │         │ terminal-ws-server)                   └──────────────┬───────────────────────┘ │
 │         │ spawns attachCommand() = mc-attach ─► \\.\pipe\mc-sessiond-attach-<name>        │
 │         ▼ (node-pty / ConPTY)                                  │ replay ring + live duplex │
 │      UI terminal ◄════════════ byte stream ═══════════════════┘                           │
 │                                                                                           │
 │   git worktrees on NTFS (worktree-manager, unchanged)                                     │
 └─────────────────────────────────────────────────────────────────────────────────────────┘

 mac/linux: mc-sessiond ≡ tmux server (already running); DaemonSessionMux ≡ TmuxSessionMux;
            pipe ≡ tmux socket; list() ≡ list-sessions; CIM ≡ ps. Callers UNCHANGED.
 RESTART INVARIANT: mc-server dies → daemon + workers untouched → list() rebuilds state.
```

---

## 6. TECHNICAL PLAN

### New files
- `src/services/session-mux/SessionMux.ts` — interface + `ProcSnapshot`/`SessionInfo` + `claudeAliveInSubtree` (moved here, unchanged, `cmd||comm` predicate).
- `src/services/session-mux/TmuxSessionMux.ts` — mechanical byte-parity extraction of today's tmux argv (incl. `parsePs`).
- `src/services/session-mux/WslTmuxSessionMux.ts` — `wsl.exe -d <distro> --` prefix + `wslpath` translation. **Phase 0 + permanent `MC_BACKEND=wsl` fallback.**
- `src/services/session-mux/DaemonSessionMux.ts` — Windows client: named-pipe JSON-RPC, find-or-spawn daemon, CIM `processTree`.
- `src/services/session-mux/index.ts` — the `mux` singleton selector (behind the `isTmuxAvailable` gate).
- `src/sessiond/main.ts` — `mc-sessiond`: pipe server, `Map<name,Session>`, node-pty ConPTY ownership, ring buffers, log tee, CIM snapshot, attach-pipe bridge, breakaway self-launch helper. New `bun build --compile` target.
- `src/sessiond/mc-attach.ts` — tiny pipe↔stdio bridge spawned by node-pty for attach.
- `src/sessiond/win-proc.ts` — `bun:ffi` (fallback `koffi`) for `CreateProcessW` (BREAKAWAY flag), `GetProcessTimes`, `OpenProcess`/`TerminateProcess`, + the CIM query runner.
- Tests: golden-argv parity for `TmuxSessionMux`; integration "spawn daemon → kill spawner → assert survival + `list()` rebuild".

### Changed (all become `mux.<verb>` callers — the 42-call consolidation)
- `src/services/coordinator-live.ts` — `launchWorker`→`mux.ensure`+`mux.sendKeys`; `isTmuxAlive`→`mux.exists`; `capturePane`→`mux.capture`; `tmuxPanePid`→`mux.panePid`; `killTmuxSession`→`mux.kill`; `procSnapshot`→`mux.processTree`. **`detectStalls`/`reapDeadClaims` gain a `mux.list()` restart-reconcile** (the persistence fix). `claudeAliveInSubtree` predicate → `cmd||comm`. Logic otherwise unchanged.
- `src/services/tmux-naming.ts` — one-line fix `root.split('/')` → `root.split(/[\\/]/)` (Windows `\` basename). `trackingProjectRoot` already accepts `[/\\]`.
- `src/services/tmux-session.ts` — `healStaleTmuxSession` → `mux.paneStartPath` + `mux.kill` + `mux.ensure`.
- `src/services/fleet-status.ts` — `tmuxAlive`/`tmuxPanePid`/`capturePane`/`procSnapshot` → `mux.*`; `no_tmux`→`no_session`; pane regexes unchanged.
- `src/terminal/PTYManager.ts` — `buildTmuxAttachCommand` → `mux.attachCommand(name)`; drop cosmetic `set-option status/mouse` on Windows. Viewer transport unchanged.
- `src/routes/ide-routes.ts` — `/api/ide/create-terminal`: derive `tmuxBaseName` (unchanged) → `mux.ensure`/heal → spawn `mux.attachCommand`.
- `src/services/terminal-ws-server.ts` — `mux.ensure`, scrollback via `mux.capture(name, 10000)`, attach via `Bun.spawn(mux.attachCommand(name), {terminal})`.
- `src/services/claude-launch.ts` — `ensureSession`/`runTodoInSession`/`killTmux` → `mux.*`.
- `src/services/tmux-send.ts` — folded into `TmuxSessionMux.sendKeys`; the split also lives daemon-side. File becomes a thin re-export or is removed.
- `src/services/tmux-availability.ts` — generalized to back `mux.isAvailable()`; keep `TMUX_UNAVAILABLE_MESSAGE`, add a daemon/WSL-missing variant.

### Reused UNCHANGED
- `src/agent/worktree-manager.ts` — git/`gh` via injectable `spawnFn`, cross-platform; `fs.symlink('dir')` already `.catch(()=>{})` (wants Dev Mode/admin on Windows, degrades gracefully). **No change.**
- `claudeAliveInSubtree` BFS (pure), all pane classifiers (`isActivelyWorking`, `isClaudeTuiPresent`, `detectPermissionPrompt`, `paneSignature`), `trackingProjectRoot`, `worker-pool` registry/reap logic, persisted `todos.sessionName`/`claimedAt` clock, the entire PTY-websocket transport.

### Deleted
- Nothing on mac/linux structurally — the scattered `Bun.spawn(['tmux',…])` literals are **absorbed** into `TmuxSessionMux` (behavior preserved), not deleted. Cosmetic `set-option` calls dropped on Windows only.

### Deps
- One FFI for the daemon: prefer **`bun:ffi`** (no new npm dep) for `kernel32` breakaway-spawn + `GetProcessTimes`/`TerminateProcess`; fall back to `koffi` if ergonomics bite. `node-pty`/ConPTY already vendored (now also bundled into `mc-sessiond`). Named pipes via Node/Bun `net` (`\\.\pipe\…`), no new dep. No new deps in the sidecar itself.

### Phased migration plan
- **Phase 0 — SessionMux seam + WSL2 MVP. DECISION: YES, build WSL2 as Phase 0.** Rationale: it proves the interface, the pool-wiring, and the `list()`-restart-reconcile against **real running claude workers with zero claude-on-native-Windows risk**, and de-risks the single biggest unknown both daemon concepts wave past (does claude's TUI render/drive via raw ConPTY). It is also a permanent supported fallback (`MC_BACKEND=wsl`) for users whose native claude misbehaves. Deliverables: `SessionMux` + `TmuxSessionMux` (mac/linux **byte-parity, golden-argv regression-gated, zero behavior change**) → `WslTmuxSessionMux` + `wslpath` translation; sidecar-in-WSL topology (pins the VM, kills `wsl.exe` per-call latency, makes tmux a local call); worktrees on ext4.
- **Phase 1 — SessionMux seam landed everywhere (the de-risk of the abstraction itself).** Route all 42 call-sites through `mux.*` on mac/linux with **zero behavior change**; add the `mux.list()` restart-reconcile (this **also fixes the registry-persistence gap on mac** — restart now rebuilds from `tmux list-sessions`). This is the safe, value-shipping foundation that gates everything Windows.
- **Phase 2 — native `mc-sessiond` + `DaemonSessionMux`.** Build the daemon (ConPTY map, pipe RPC, ring buffers, log tee, CIM snapshot, breakaway launch via `bun:ffi`), `mc-attach`, the factory switch. Order: attach/capture/kill → the **restart invariant test** (kill mc-server, confirm `list()` rebuild) → CIM subtree probe (CommandLine matching) → full `WorkerState` mapping incl. `dead_shell`. **Startup self-test gates backend availability** (spawn daemon, kill spawner, confirm survival).
- **Phase 3 — Windows deploy / installer / service lifecycle.** MSIX/NSIS for the Electron shell, bundling `mc-server.exe` + `mc-sessiond.exe` + `mc-attach.exe`. Daemon lifecycle: per-user **Scheduled Task** (`at logon`, restart-on-failure) so no admin needed; Electron also find-or-spawns it. Replace macOS `open -a`/`.app`/`pkill` with: graceful `:9002` shutdown endpoint (not `pkill`) for the swappable sidecar; per-lane `kill(name)` / "stop all" enumerating the registry. **Daemon upgrades are the one operation that ends running workers** (PTYs can't migrate) — schedule between waves, exactly as today's full `dist:dir` is heavier than the sidecar-only swap.

---

## 7. Why-over-alternatives + TOP RISKS & mitigations

**Why the daemon over the others (judge totals): out-of-process-daemon 61 · seam-first 57 · wsl2-reuse 56 · native-conpty 54 · log-journal 39.**
- vs **seam-first / native-conpty per-lane host:** same correct persistence primitive, but the daemon concentrates the breakaway footgun + start-time validation in **one** spawn instead of N, and keeps the PTY handle live in one process across restart (immediate post-restart attach, no re-adoption). We *graft* their breakaway+startTime rigor onto the daemon launch.
- vs **wsl2-reuse-tmux:** lowest novelty/highest correctness, but `wsl --install` + distro provision + ext4 worktree relocation + `\\wsl$` path translation is real friction for a local-first desktop, and VM-idle-shutdown is a genuine persistence footgun. We *keep WSL as Phase 0 + permanent fallback*, not the product path.
- vs **detached-logjournal:** lowest install burden, but headless/print-mode claude guts `isClaudeTuiPresent`/`detectPermissionPrompt` fidelity and kills live type-into-TUI attach — the exact things `fleet-status` depends on. We *graft only its log-tee* as a cheap secondary signal.

**Top risks & mitigations:**
1. **(BIGGEST) Does claude's TUI render & drive correctly via raw ConPTY on native Windows?** The `shellSingleQuote` / `/collab` keystroke / TUI-regex gates are all POSIX-shaped. *Mitigation:* **Phase 0 WSL proves the entire seam with zero exposure to this**; Phase 2 brings the native daemon up against that working baseline; `MC_BACKEND=wsl` is a permanent escape hatch. The daemon also spawns claude **directly via ConPTY (no `sh -c`)** and `sendKeys` writes raw bytes to the PTY master — eliminating the shell re-quoting class entirely.
2. **Daemon is a new single point of failure (its death kills all workers).** *Mitigation:* keep the daemon trivially small (PTY map + pipe + ring, no business logic → minimal crash surface); restart-on-failure Scheduled Task; the **log-tee surfaces "these lanes were lost"** cleanly instead of hanging; WSL fallback as the structurally-different safety net.
3. **`CREATE_BREAKAWAY_FROM_JOB` is load-bearing and Bun/Node `detached` does NOT set it.** *Mitigation:* `bun:ffi`/`koffi` `CreateProcessW`; verify parent job permits breakaway (`JOB_OBJECT_LIMIT_BREAKAWAY_OK`), else spawn the daemon via Task Scheduler (outside any inherited job); a **startup self-test gates backend availability** so we never silently run a non-persistent backend.
4. **PID recycling.** *Mitigation:* `GetProcessTimes` start-time validation on the daemon find-or-spawn handshake and any persisted pid; mostly moot because the daemon hands live host pids, not re-adopted ones.
5. **`claude`=`node.exe` blind spot in liveness.** *Mitigation:* CIM `Win32_Process` matching on **CommandLine, not Name**; `tasklist` and WMIC rejected.
6. **Regression to the proven mac/linux path.** *Mitigation:* `TmuxSessionMux` is a pure mechanical extraction gated by a **golden-argv test** asserting byte-parity with today's literals; Phase 1 ships zero behavior change before any Windows code exists.
