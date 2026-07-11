# Windows Port — Build Plan (resume here)

**Status:** Planned, not started. Architecture decided, epic + phases filed. Pick up at **P1**.
**Date:** 2026-06-09 · **Session:** supervisor-firstclass

---

## TL;DR
Port mermaid-collab to Windows by **requiring WSL2** and running the worker session layer as **real tmux inside WSL**. The macOS/Linux tmux path stays byte-for-byte unchanged behind a new `SessionMux` seam. Build the seam first (P1, zero behavior change), then the WSL backend, then persistence/onboarding/installer.

---

## The decision (record `588c6df1`)
**Windows support REQUIRES WSL2. Backend = `WslTmuxSessionMux` (real tmux in WSL), NOT a native ConPTY daemon.**

- The design-exploration (doc `design-windows-port-sessionmux`) ranked a native out-of-process ConPTY daemon (`mc-sessiond`) #1 (61/70) — but it exists **only to avoid a WSL dependency**. We accept the WSL user-burden instead.
- WSL2-reuse-tmux scored top on every axis except user-burden (3/10): byte-parity correctness with the proven tmux/capture/`ps` path, far smaller build, and **eliminates the single biggest risk** (claude's TUI driving via raw ConPTY on native Windows — unproven).
- **Dropped:** the native `mc-sessiond` daemon + all native-ConPTY work; the detached log-journal model (guts capture/attach fidelity).

### The big payoff of requiring WSL
Because tmux, the `claude` CLI, `ps`, and the git worktrees **all run inside Linux/WSL**, the entire liveness/capture/naming layer works **unchanged** — `capture-pane`, the `ps`-subtree probe (`claudeAliveInSubtree`), the `tmux-naming` regex. **No `tasklist`/WMI port is needed at all.** The only Windows-native surface left:
1. the Electron shell,
2. the installer + sidecar lifecycle,
3. WSL provisioning/onboarding,
4. a thin wsl-exec bridge + path translation (and possibly *none* of #4 if the sidecar itself runs inside WSL).

---

## Architecture

`tmux`'s one irreplaceable property: *a separate, long-lived process that owns a worker's PTY by name and outlives whoever talks to it.* We reproduce that behind a single `SessionMux` interface.

- **mac/linux:** `TmuxSessionMux` — the real tmux server (today's behavior, untouched).
- **Windows:** `WslTmuxSessionMux` — the **same** tmux backend, just running inside WSL. **Preferred:** run the Bun sidecar (`mc-server`) *itself* inside WSL, so everything is native Linux and `WslTmuxSessionMux == TmuxSessionMux`; only the Electron shell stays on Windows, talking to the in-WSL sidecar over `localhost:9002`. (The alternative — sidecar on Windows driving `wsl.exe -- tmux …` with path translation — is the fallback; **decide this fork in P2**.)

### The SessionMux interface (derive in P1)
From the ~7 tmux ops actually used today, plus liveness + a new `list()`:
- `launch(name, cwd, command)` — new-session -d + send-keys to run the claude skill
- `hasSession(name)` → bool
- `capture(name)` → pane text (for idle/stall byte-diff)
- `kill(name)`
- `paneStartPath(name)` / `panePid(name)`
- `list()` → live session names (**new** — for restart-reconcile)
- `claudeAliveInSubtree(pid)` stays a pure shared free function (Unix `ps`, runs in WSL on Windows)

---

## Epic + phases (work-graph)

**EPIC `68affdb7` — Windows port (WSL2-required)**

| Phase | id | Depends on | Gist |
|---|---|---|---|
| **P1** | `acdf7b41` | — | **SessionMux seam** + `TmuxSessionMux` reference impl; route all 42 tmux call-sites through `mux.*`. **ZERO behavior change** (golden-argv parity). Foundational. |
| **P2** | `a49c5d2a` | P1 | **`WslTmuxSessionMux`** — wsl-exec bridge; **decide sidecar-in-WSL vs drive-wsl-tmux**; path translation; worktrees on ext4. |
| **P3** | `fe153cdd` | P1 | **`mux.list()` restart-reconcile** — rebuild the worker-pool registry from live sessions after a sidecar restart. **Also fixes the existing mac/linux persistence gap** (`worker-pool.ts:148`). |
| **P4** | `354b9b0f` | P2 | **WSL persistence hardening** — WSL2 idle-shutdown would kill detached workers; keepalive / `.wslconfig vmIdleTimeout`. |
| **P5** | `619f6c35` | P2 | **WSL provisioning + onboarding** — detect/guide `wsl --install`, distro, in-WSL toolchain (Bun/tmux/git/claude). |
| **P6** | `1ec0a60a` | P2 | **Windows build + installer + sidecar lifecycle** — Electron win32 target, NSIS/portable, in-WSL `mc-server` start/stop (replaces the macOS `deploy.ts`/`.app`/`open`/`pkill` path). |

Dependency shape: **P1** unblocks P2 + P3; **P2** unblocks P4 + P5 + P6. P1 is the only ready-able item today.

---

## ⚠️ P1 is delicate — do NOT let drive auto-land it unreviewed
P1 reroutes all 42 tmux call-sites — the **live worker-spawning spine that the drive/orchestrator system itself runs on**. A seam that passes `tsc` but subtly changes tmux behavior would, at level `drive`, **auto-land and break the running orchestrator**. Build options (decide when we resume):
1. **In-session, by hand** (recommended) — golden-argv parity tests, human review, then deploy.
2. **Drive builds on the epic branch, human-gated land** — review + manual land (don't auto-land).
3. **Drive at `propose`** — land waits for a click.

P3 (restart-reconcile, platform-agnostic, also fixes a real mac bug) and P5/P6 are safer to hand to drive once P1/P2 land.

---

## Risks carried into the build
- **(a) WSL2 idle-shutdown** kills detached tmux workers → P4 (keepalive / disable idle timeout). This is the persistence footgun; combined with P3's `list()` reconcile, a worker must survive both a sidecar restart and the app backgrounding.
- **(b) Path translation / worktree location** — keep git worktrees on WSL ext4 (perf + case-sensitivity); translate only where Windows↔WSL paths cross. Mitigated to near-zero if the sidecar runs inside WSL.
- **(c) sidecar-in-WSL vs drive-wsl-tmux** — the P2 fork; sidecar-in-WSL is simpler and erases most path/translation work.
- **(d) Onboarding friction** — requiring WSL is only acceptable with a clean first-run (P5).
- **Residual native-Windows risk** is eliminated by the WSL choice (no raw-ConPTY claude TUI).

---

## References
- Full design (interface, liveness mapping, file-by-file plan, the rejected alternatives + their scores): doc **`design-windows-port-sessionmux`**.
- Decision: **`588c6df1`** (require WSL2 / WslTmuxSessionMux).
- Exploration ranking: out-of-process-daemon 61 · seam-first 57 · **wsl2-reuse-tmux 56 (chosen for non-rubric reasons)** · native-conpty 54 · log-journal 39.

## Open item (separate bug, found while planning)
The **epic-rollup sweep** (`c1d53c6e`, deployed) rolls an epic to `done` but does **not** raise the `epic-ready-to-land` card (that surfacing lives only in the completion-event path) — so sweep-rolled epics never auto-land (had to hand-land the Bridge epic). File + fix separately; not part of this epic.

---

## Next move when we resume
Start **P1** via the chosen build option above. Everything else is dependency-blocked behind it. The architecture + risks are settled — P1 is a careful, well-scoped refactor, not an open question.
