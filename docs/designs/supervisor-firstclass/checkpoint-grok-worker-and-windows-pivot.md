# Checkpoint — 2026-06-15 (Grok worker shipped → pivoting to Windows port)

## WINPORT PROGRESS — 2026-06-15 (P1 + P3 SHIPPED)
- **P1 `acdf7b41` SessionMux seam — DONE + DEPLOYED (v5.101.18).** New `src/services/session-mux/` (pure tmux/ps argv builders + `SessionMux` seam: `cmd(argv)` transform, identity on native tmux = byte-parity, WSL-wrapped in P2). Routed every worker-spine tmux/ps spawn through `mux.cmd` (tmux-availability, tmux-send, tmux-session, tmux-reaper, lane-session-register, fleet-status, claude-launch, coordinator-live, ide-routes) with ZERO behavior change. Golden-argv parity tests. Doc `impl-winport-p1-sessionmux-seam`.
- **P3 `fe153cdd` restart-reconcile — DONE + DEPLOYED (v5.101.19, live PID 24336).** `mux.list()` + `reconcileWorkerPoolFromLiveSessions()` wired into server.ts startup BEFORE the orchestrator's first build pass: rebuilds busy pool slots from `mux.list()` ∩ claimed in-progress todos. Also fixes the pre-existing **mac** registry-persistence gap. Pure `parsePoolSessionName`/`restoreBusySlot` in worker-pool (+ tests). Broke the tmux-availability→index→TmuxSessionMux init cycle (availability imports the leaf argv builder now).
- **P2 `a49c5d2a` WslTmuxSessionMux — CODE-COMPLETE + LIVE-VALIDATED (v5.101.20, pushed; NOT deployed — no-op on mac).** `WslTmuxSessionMux` extends `TmuxSessionMux`, overrides `cmd()` → `['wsl.exe','-d',distro,'--',...argv.map(winToWslPath)]` + `available()`; `list()` inherited. index.ts selects it on win32 (`MC_WSL_DISTRO`, default Ubuntu); mac/linux + sidecar-in-WSL keep TmuxSessionMux. Unit tests 21/21. **VALIDATED LIVE on Windows 11 ARM / Parallels VM**: wrapped argv drives real tmux-in-WSL end-to-end (ensure/exists/list/panePid/sendKeys+capture/kill) + `/mnt/c` path translation honored by pane_start_path. Decided fork: BOTH topologies coded; sidecar-in-WSL preferred (needs ~no backend code, just P6 Electron launch-via-wsl).
- **⚠ WSL2 BLOCKED on the Parallels VM** (Apple M3 Max, Parallels 26.3.3): `HCS_E_HYPERV_NOT_INSTALLED` — nested virt not exposed to Windows-ARM Hyper-V despite all features on + cold restart. Live smoke ran on **WSL1**. Full WSL2 product validation (real-kernel ps fidelity, vmIdleTimeout) needs a different env. VM access recipe + findings in doc **`winport-wsl-validation-2026-06-15`**. VM SSH: `benmaderazo@10.211.55.3` (key installed), Ubuntu-24.04 distro present (WSL1).
- **NOT done yet:** **P4** (WSL persistence/vmIdleTimeout) · **P5** (provisioning/onboarding — partly explored: distro+tmux install automatable via ssh) · **P6** (Windows installer + Electron sidecar-launch-via-wsl) · **P1b** (todo `1be7d893…`, dep P1): the two deferred shell-string surfaces (terminal-manager + PTYManager re-pointable attach) — needs the real-tmux bun-run switch gate. Epic still needs a `[LAND]` leaf.
- Build approach: in-session by HAND (user choice), human-gated deploys. drive never auto-landed P1.

## LIVE STATE
- **Deployed: v5.101.19** (sidecar PID 24336 on :9002). `master` = `origin/master` (P1=v5.101.18, P3=v5.101.19 pushed). Working tree clean.
- ~~v5.101.17 / PID 11480~~ superseded.
- Orchestrator levels: **claude-mermaid-collab = `build`** (raised on the Bridge for the grok trial; idle — no `ready` todos). Other projects (build123d, stud_feeder, terminator, qbs, figure-h8) = `drive`. AudioLock = off.
- Leftover (harmless): session `grok-trial` is pinned `grok-build` (via `/api/session/provider`); both grok-trial todos dropped + lane branches/worktrees cleaned.

## THIS SESSION SHIPPED (all on master + deployed)
1. **Audio UI** wired through frontend (v5.101.10); audio/asset/imagegen toolkit epics landed; grok-game-mcp standalone repo verified done.
2. **grok-game generation tooling REMOVED from collab** (v5.101.12) — extracted to ~/Code/grok-game-mcp; kept consult_grok + create_image/generate_image + the audio PLAYER (DSP picker stripped). 3,524 deletions.
3. **Daemon reliability fixes:** status read-model reconcile (7fb16985), reclaim→ready (c4f9f170), acceptance no-false-reject of master-landed work (7b7d66d5b/c), OI-1 enforces master-reachability only at drive (the build-level re-claim-loop fix).
4. **Grok headless worker NOW FUNCTIONAL** (v5.101.16) + watchable in the Bridge (v5.101.17). See memory [[project_grok_headless_worker_live]] for how to run/watch one. The in-process MCP fix + no-claude-fallback + OI-1/build fix + fleet/Bridge card visibility all landed.
5. **Console watch+steer for grok** (transcript viewer + inject) — dormant-gated, only engages for grok-build lanes.

## PAUSED DISCUSSION (not built): vibe-go / vibe-blueprint for Grok
Conclusion captured in [[project_grok_headless_worker_live]]: bake vibe-go's *discipline* (research→verify→fix, diagrams-as-spec, fix loops, completeness) into the grok worker loop; adapt vibe-blueprint to a headless grok PLANNER lane; do NOT make grok an Agent()-spawning orchestrator (the daemon already does wave fan-out). Resume from there if revisited.

## NEXT FOCUS: ship the Windows port (so it can be used)
Epic **`68affdb7`** [EPIC] Windows port (WSL2-required) — SessionMux seam + WslTmuxSessionMux. All children currently `planned`. Design docs: **`design-windows-port-sessionmux`**, **`winport-build-plan`** (read these first).
Children + dep chain:
- **P1 `acdf7b41`** SessionMux seam — extract the interface + TmuxSessionMux reference impl, route ALL 42 tmux call-sites through it (ZERO behavior change). deps: none → **start here** (promote to ready).
- **P2 `a49c5d2a`** WslTmuxSessionMux — wsl-exec-prefixed tmux backend; decide sidecar-in-WSL vs drive-wsl-tmux; path translation. deps: P1.
- **P3 `fe153cdd`** mux.list() restart-reconcile — rebuild worker-pool registry from live sessions after restart (also fixes the mac persistence gap). deps: P1.
- **P4 `354b9b0f`** WSL persistence hardening. deps: P2.
- **P5 `619f6c35`** WSL provisioning + onboarding (wsl --install, distro, in-WSL Bun/tmux/git/claude). deps: P2.
- **P6 `1ec0a60a`** Windows build + installer + sidecar lifecycle (Electron win32, NSIS/portable, in-WSL sidecar start/stop). deps: P2.
Epic still needs a `[LAND]` leaf. Was excluded from the overnight landing earlier; now it's the priority.

## DEPLOY recipe (well-trodden)
`bash scripts/deploy-desktop.sh` — rebuilds sidecar+ui from working tree, backs up, swaps, force-restarts, health-checks. Version via `npm version patch` (CLAUDE.md). Steward brake = `orchestrator_off` (durable; raising is human-only on the Bridge ladder).
