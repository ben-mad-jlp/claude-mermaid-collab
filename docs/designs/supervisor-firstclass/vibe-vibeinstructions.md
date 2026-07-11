# Vibe: supervisor-firstclass

## Goal
PCS (Planner/Coordinator/Supervisor) multi-agent orchestration, hardened + dogfooded via (a) a CAD arm built through collab in build123d-ocp-mcp, and (b) a Bridge UI redesign. collab stays domain-agnostic; bsync (build123d) plugs in via a per-project manifest + Coordinator-side gate (decision cf58d76a).

## Context
Acting as Planner+Supervisor inside this vibe session (not the dedicated skills — see feedback). The Coordinator is a server-side daemon that keeps running across /clear. Most durable state lives in: decision records, the work-graph todos, git, and the design docs.

## SESSION 5 CHECKPOINT — 2026-06-11 (READ FIRST on resume)

**Model now (decision f0ec0b06):** Coordinator/Supervisor/Steward MERGED into ONE always-on Orchestrator daemon, driven by a per-project LEVEL (off · build · nudge · propose · drive) set on the Bridge ladder. The Planner only plans/promotes-to-ready; the daemon claims `ready` + builds + gates + (at drive) Grok-triages + auto-lands. Steward asymmetry (decision 3bf1292b): steward may force level→off (brake) but NEVER raise it — there's an `orchestrator_off` MCP tool for the brake; raising stays human-only.

**LIVE: v5.92.22 deployed** (`/Applications/Mermaid Collab.app`, sidecar reinstalled). claude-mermaid-collab level = **drive**; build123d/AudioLock/stud_feeder = off. git: master = origin/master, all pushed.

**SHIPPED THIS SESSION (all on master + deployed):**
- **Status & observability tools epic `5cce6cb4`** — 11 MCP tools live (orchestrator_status, fleet_status, invariant_check, instance_topology, gate_status, context_usage, system_status, epic_branch_status, orchestrator_off, escalation_history, friction_trends/roadmap_rollup). 12th, `runtime_config` (`f16b514f`), is RE-OPENED ready (was phantom — accepted with no commit). NOTE: new MCP tools need a fresh Claude session to appear in the manifest.
- **6 bugfixes incl. both P0s** (v5.92.21): sidecar **health-watchdog** (`8395d140`, in desktop main — a pegged-but-alive sidecar now self-recovers ~30s instead of the 9h wedge), **acceptance-verifies-commit** prevention (`d1f535f4`), worker-card time-on-task (`78a0a218`), escalation live-refresh (`f9385939`), Bridge tab overflow (`130f73b2`).
- **Terminal fixes earlier** (v5.92.16–19): tmux mouse-off (drag-copy), `/tui fullscreen` reset re-sync. **Window restore** (v5.92.17). 

**INCIDENT (contained): BP0 sweep flood.** The d1f535f4 backlog-repair sweep flooded 2200+ "Stranded acceptance" escalations (flap: it flags done+accepted todos not on the epic branch each 30s tick, step-4 auto-close clears them, repeat). FIXED v5.92.22: gated behind `MERMAID_BP0_SWEEP` (default OFF). Cleared all 2211 junk escalations from supervisor.db. Redesign filed: **`e7b3f8cb`** (one-shot + summary escalation + exclude from step-4 auto-close) — currently in_progress (daemon claimed it at drive).

**KEY LEARNING — integration is BROKEN (being fixed):** worker `done+accepted` does NOT guarantee the commit reached the epic branch — work strands on lane branches (or accepted with NO commit). Had to MANUALLY reconcile both the status-tools epic and the 6 bugfixes onto master (cherry-pick from scattered lane/epic branches, resolve setup.ts, restore dropped registrations). The forward-prevention half of d1f535f4 is now live; the backlog sweep is gated. The stale lane/epic branches are cruft (their work is mostly already on master).

**OPEN / NEXT:**
- Epics in_progress with REAL remaining work (need BUILDING, not releasing): Terminal console UX `4fa60fed` (foundation `6212f98a` is PLANNED — promote to start), UI status coherence `d5b1ff4e` (audit `2bf43a98` ready), Bugfix inbox `98a779a1` (idle-tmux-reap `8e2e53b8`, Bridge panels fill-height `183ceb8f`, BP0 redesign `e7b3f8cb`, runtime_config `f16b514f`), CAD `d61c73de`.
- Native epics (Windows `68affdb7` / Ubuntu `7d860a50`) — EXCLUDED from release per user.
- A background wedge-sampler may still be running (`/tmp/wedge-watch.sh`) — captures a stack if the sidecar pegs.
- Decisions this session: f0ec0b06 (unified daemon — from planner skill), 3bf1292b (steward off-only), a97c0d83 (status tools read-only), 7703f475 (single-console rewrite post-spike).
- Docs: investigation-drive-wedge, design-status-observability-tools, design-single-console-terminal, spike-result-single-console, design-ui-status-coherence (planned).

## SESSION 4 UPDATE — 2026-06-05 eve+ (READ FIRST on resume)

**`afd1666a` AND `63a59bd6` are both DONE + DEPLOYED + MERGED + PUSHED. The whole isolation-regression arc is closed (cause fixed + death now visible).** Next candidates in Architecture hardening epic `34a22538`: `6066b12a` setup.ts→registry, `86799634` session-runtime read model, `d0d59599` deploy script, `2dd13c65` epoch fence → `b76f7869` daemon↔LLM decision-handoff (63a59bd6's dead-worker signal feeds it), `c0cecc3e` epic-parent enforcement.

**`63a59bd6` SHIPPED (commit `ff9efd1`):** PID-based liveness closes the watchdog blind spot (worker's Claude exits but tmux stays alive = bare shell → fell through reapDeadClaims AND the stall classifier → silently RED, never escalated). In `src/services/coordinator-live.ts` detectStalls: one `ps -axo pid,ppid,comm` snapshot per pass, BFS the tmux pane's process subtree for a live `claude` process; if gone AND no Claude TUI chrome in the pane, confirm across `DEAD_GRACE_MS` (default 45s, `MERMAID_DEAD_GRACE`) then ESCALATE (kind 'blocker'), kill the dud tmux, free the slot (markIdle), and reclaimClaim (retry-budget-aware). Exported pure helpers `claudeAliveInSubtree` + `isClaudeTuiPresent` with 5 unit tests (33/33 coordinator-live, 73/73 backend; tsc clean).

**WHAT SHIPPED (afd1666a, decision `c4a8bf40`):** the isolation deps-fix, built by the STEWARD (the pipeline couldn't build its own fix — a worker would die in the deps-less worktree). Committed `d7464d6` on branch `fix/dogfood-5-worktree-isolation` (ancestor of HEAD; unrelated consult_grok `74b8a97` sits on top). Changes:
- `src/agent/worktree-manager.ts` `ensure()` → after creating a worktree, AUTO-DETECT every package.json dir (root + nested ui/, bounded depth-3 walk) and SYMLINK the main-repo node_modules into each (instant, zero disk, lstat-guarded, best-effort). New `linkNodeModules`/`findPackageJsonDirs`/`lpathExists` helpers.
- `src/services/coordinator-live.ts` → DROP keep-warm under isolation: `launchWorker` never reuses a warm idle session (its worktree cwd is removed on merge-back → bare shell); always fresh session+worktree per todo. On merge-back success: `killTmuxSession` + `removeSlot` tear down the lane. New `killTmuxSession` helper.
- `src/services/worker-pool.ts` → new `removeSlot()` (full slot teardown vs markIdle).
- test: `worktree-integration.test.ts` asserts root + ui/ node_modules symlinked in a fresh worktree (5/5 pass; `tsc --noEmit` clean; pool+coordinator suites 63/63).

**CURRENT LIVE STATE:**
- Coordinator STILL STOPPED (opted out of auto-restart — stays stopped through /clear). Isolation=1 is armed but NO workers spawn until the coordinator is started. When started, both fixes are live: workers get node_modules symlinked (afd1666a) and any dead-Claude-live-tmux worker is escalated within ~1 stall window + DEAD_GRACE_MS (63a59bd6).
- Live sidecar = a SOURCE-spawned `bun run src/server.ts` (**PID 29765**, port 9002, cwd=repo root, loading HEAD `ff9efd1`) — this app build spawns the sidecar FROM SOURCE, not the compiled binary, so a restart loads repo HEAD directly. Redeployed twice this session. Reconfirm the PID on resume (`pgrep -f "bun run src/server.ts"`); the app may have re-spawned it.
- config.json `MERMAID_WORKER_ISOLATION` = **"1"** (flipped back from the "0" safety fallback now that the fix landed). Durable via 828a89a9 resolveFlagsEnv → survives app restart.
- ⚠ The bare-shell trap is FIXED, so isolation=1 is now safe to run. If the coordinator is started, JS/Bun workers get node_modules symlinked and stay alive.
- Uncommitted WIP in working tree (NOT ours, leave as-is): a bsync-session-isolation change in `coordinator-live.ts` (imports `./bsync-session`, CAD-worker session_id derivation).
- Earlier: released 4 dead collab claims → ready (c7221332 #7a, 8f92621f #7b, cfde885f, e06eef6b G6). LEFT eab5f87c (build123d Python worker).

**GIT: `master` = `origin/master` = `ff9efd1` (MERGED + PUSHED).** Branch `fix/dogfood-5-worktree-isolation` fast-forwarded into master and pushed to origin. afd1666a = `d7464d6`, 63a59bd6 = `ff9efd1` (consult_grok `74b8a97` between them, not ours). Still uncommitted in the working tree: the unrelated bsync-session WIP in `coordinator-live.ts` (leave as-is) + other broad WIP (ui/, src/mcp/setup.ts, etc.).

**DEPLOY GOTCHAS (logged):** `open -a "Mermaid Collab"` is AMBIGUOUS (a Parallels WinApp shares the name) → launch the real app by FULL PATH `/Applications/Mermaid Collab.app`. The sidecar SURVIVES `quit app` (detached) → kill it before relaunch. Sidecar deploy = build `cd desktop && bun run build:sidecar` → backup+swap mc-server into app Resources → kill old sidecar → relaunch by path. Old apps backed up `/Applications/Mermaid Collab.app.bak-*`.

**KEY DECISIONS this session:** 20106f26 steward role · eb3c3e60 daemon-first (Coordinator/Supervisor separate; watchdog daemon + on-demand LLM for escalate-or-not) · 45a0d906 canonical vocabulary · 373a2d52 every-work-todo-needs-an-epic (ACTIVE) · be762c9c failover=epoch fence · c4a8bf40 isolation provisioning (symlink/drop-keep-warm/PID-liveness). Memories: project_build_time_steward_role, feedback_deterministic_daemon_first, feedback_every_todo_needs_an_epic.

**EPICS:** Architecture hardening `34a22538` (holds 6066b12a, 86799634, d0d59599, b76f7869, c0cecc3e, 2dd13c65, + 1cb49878 DONE, 40d38438 DONE, afd1666a DONE, 63a59bd6 DONE) · CAD/bsync `d61c73de` · Vocabulary `1f75ebe9` · Profiles `5f6ab046` · #7 `7fc8bac5`. docs/roadmap.md is the committable mirror.

---

## SESSION 2 CHECKPOINT — 2026-06-05 PM

**Mode this session: BUILD-TIME STEWARD** (decision 20106f26 / memory project_build_time_steward_role) — NOT the supervisor. We dogfooded the system, fixed friction, and converted a full architecture review into a plan. Stop framing the session as "the supervisor."

**SHIPPED + DEPLOYED + MERGED this session:**
- 3 steward fixes committed standalone → merged to **master `d7fc29e`** (FF), tag **v5.83.0** pushed: `d8a1195` list_session_todos compact mode (use compact:true on resume!), `183d784` supervisor self-watchdog, `814a019` FleetGraph framed-container epics, + `d7fc29e` targetProject field (made committed HEAD build).
- **DEPLOYED** ui+sidecar from working tree → app **PID 45058** live (compact mode proven). ⚠ Plugin still pinned 5.82.3 — the supervisor SKILL (self-watchdog loop) is NOT live until a plugin update pulls 5.83.0 from master.

**KEY DECISIONS (durable):** eb3c3e60 (supersedes e216f8d6) deterministic-DAEMON-first: mechanical→daemon, LLM only for irreducible judgment; Coordinator & Supervisor SEPARATE; supervisor watchdog = daemon + on-demand LLM session for escalate-or-not (self-watchdog 183d784 + epoch fence 2dd13c65 STILL apply to that LLM session). 45a0d906 canonical vocabulary: workspace(durable) vs session(runtime); pool/slot/worker; type=pool-type; profile distinct. be762c9c failover=epoch fence not standby.

**ARCHITECTURE REVIEW → PLAN (doc review-collab-architecture).** New design docs: design-collab-system-overview, glossary-collab-terms, design-supervisor-failover, design-watchdog-daemon-decision-handoff, spec-canonical-vocabulary, design-setup-ts-registry, design-session-runtime-read-model, design-deploy-script. New diagrams: collab-system-overview, collab-glossary-map. (Deprecated ~55 stale docs; 9 kept.)

**NEW READY/PLANNED TODOS this session (all backend unless noted):**
- `40d38438` worktree isolation = **LINCHPIN** (ready, top priority — gates setup.ts refactor + merge-integrity + safe parallelism).
- `2dd13c65` epoch fence (ready) → `b76f7869` daemon↔LLM decision handoff (ready, dep 2dd13c65).
- Vocab EPIC `1f75ebe9` (planned): `b3b81bdb` type-unify (ready, prereq for Profiles), `3db13225` pool/slot/worker (ready), `142824b0` session→workspace (planned, needs migration design), `5f9aefde` vocab lint (ready).
- `6066b12a` setup.ts→registry (ready, dep 40d38438). `86799634` session-runtime read model (ready). `d0d59599` deploy script+sidecar-lifecycle (ready). `8a838986` BUG: MCP artifact writes don't broadcast → UI no live-refresh (ready).
- Released earlier: UI `0f565509`/`63b02a8c`; secrets `828a89a9`; Profiles L1 `fe016a6f`/L2 `925db497`; CAD `cfde885f`; #7 `c7221332`/`8f92621f`.

**OPEN LOOSE ENDS (resume here):**
1. UNANSWERED: chain Profiles L1/L2 (fe016a6f/925db497) behind type-unify b3b81bdb? (decision says unify-first; but they're already released.)
2. Confirm 40d38438 stays top of backend queue (it's the linchpin for 3 things).
3. Plugin update to 5.83.0 to make the supervisor skill live.
4. Coordinator running on PID 45058; backend pool=1 sequential on shared tree until 40d38438.
5. NEW INVARIANT (constraint 373a2d52, PROPOSED — needs approval): every work todo must have an epic parent (epics are roots; 'epic' becomes a declared kind, not emergent; Inbox default). Memory feedback_every_todo_needs_an_epic. Enforcement todo c0cecc3e (under Architecture hardening epic). NOT enforced yet — existing orphans (CAD/SEAM 28d016aa/eab5f87c/7ef13930/32125394/49352848/00ff43f2/61f06bde, secrets, UI) still float; group them or let c0cecc3e's migration sweep them.
6. EPICS now: Architecture hardening 34a22538 (in_progress — 8 children incl. the 7 review refactors + c0cecc3e); Vocabulary unification 1f75ebe9 (sibling); Profiles 5f6ab046; #7 fitness 7fc8bac5.

---

## Currently Doing — CHECKPOINT 2026-06-05 (read first on resume)

**SHIPPED + DEPLOYED this session** (branch `fix/dogfood-5-worktree-isolation`, 5 commits PUSHED):
- RUN 3 CAD arm — good-AND-real, pushed to build123d (branch cad-dogfood-arm); todo deddb23b accepted.
- Coordinator hardening: `bb076fe` manifest+friction · `2fd2a05` slot-reap (889e3e26) · `aa30afe` authoritative gate (5374e299) · `a250173` worker-recovery (41d24bee) · `60d1acd` collab gate manifest.
- **DEPLOYED**: rebuilt `mc-server` sidecar → swapped into `/Applications/Mermaid Collab.app/Contents/Resources/` (backup `mc-server.bak-1780624291`) → app restarted → **PID 49687** runs the fixes. Gate PROVEN LIVE (override-on-fail; throwaway gate-fail/gate-pass test). MCP reconnected to the new server (no new session needed).

**GATE ACTIVE**: `.collab/project.json` — collab: `npx tsc --noEmit` (committed); build123d: focused pytest (gitignored/local, machine path).

**COORDINATOR RUNNING** on claude-mermaid-collab (in-process in PID 49687). Autonomously builds `ready` todos. backend pool=1 (sequential); ui pool builds the Bridge epic.

**LIVE WORK-GRAPH:**
- **Bridge redesign EPIC `97382870`** (approved; design `design-bridge-layout-redesign` = stacked-zones; mockup design `bridge-redesign-mockup`, 4 screens). Phases: **P1 `b735e3bb` READY** (CommandBarBadge + openEscalations selector — safety net) → P2 `6f5737ee` → P3 `35f58992` (SplitDeck reflow) → P4 `4eae088f` / P5 `385393a4` / P6 `a2359dc1`, dep-chained. ui pool builds these. Decisions: 47338e3a (approval), + the exploration winner. 09cf40e2 dropped (→P3); 38669eb7 (task-view reuse, signal 5) done.
- **Backend seam**: `b5dcce4e` (target-repo) in_progress; `1cb49878` (coord self-liveness) ready; eadfe7de/464c5cef DONE; b112ba50/e20f1c48 DONE (uncommitted). 8 bsync/cross-repo todos BLOCKED on b5dcce4e; c5955d29 blocked on 464c5cef; 49352848 blocked on 28d016aa.
- **Profiles EPIC `5f6ab046`** (planned, NOT released): L1 capability `fe016a6f` / L2 tech-pack-lib `925db497` / L3 compose `daff4708` / L4 auto-proposer `fd052733`. Decisions e8fddf63 (taxonomy) + 5a7af2f2 (route-by-primary-pack).

**⚠ KEY DEPLOY GAP**: post-deploy worker output (e20f1c48 lane-session-register.ts, b112ba50 detectPermissionPrompt, AND the Bridge UI as it builds) is UNCOMMITTED in the working tree and NOT live until commit + `bun run build` (ui) + rebuild sidecar + redeploy. So todos go `done` BEFORE you see them live — expected, not a bug.

**✅ DEPLOYED 2026-06-05 (release batch shipped):** Built ui/dist + mc-server from WORKING TREE → backed up (`mc-server.bak-1780670596`, `ui-dist.bak-1780670596` in app Resources) → swapped both into `/Applications/Mermaid Collab.app/Contents/Resources/` → quit+relaunch. NOTE: the old sidecar survives `quit app` (detached); had to `kill` the stale PID then relaunch so a fresh sidecar spawns on the freed port 9002. **LIVE: PID 45058** — compact mode PROVEN live (slim projection), self-watchdog server seam live (same binary), new ui bundle `index-DSw2x0sB.js` served, Coordinator restarted. ⚠ Deploy built from working tree (includes uncommitted WIP: friction wiring, P2 in-flight). ⚠ Supervisor self-watchdog SKILL loop NOT live (repo skills/ needs plugin version-bump to leave cache); only its server-side self-tagging is live. Steward commits d8a1195/183d784/814a019 still local on branch (unpushed).

**🚀 RELEASE TRIGGER (user, 2026-06-05):** Deploy the new build "so we can use it" ONCE both gates green — (1) Bridge epic `97382870` P1→P6 all accepted, (2) collab-side COORD-FIX `1cb49878` + collab SEAM todos done. SCOPE = **Bridge + collab COORD/SEAM only**; Profiles epic `5f6ab046` and CAD-VERIF/bsync-only todos stay UNRELEASED (plug in per-project, don't block collab usability). Deploy steps: commit worker output → `bun run build` (ui) → rebuild mc-server sidecar → swap into `/Applications/Mermaid Collab.app/Contents/Resources/` (+.bak) → restart app. DO NOT deploy until user gives go; flag them when both gates green.

**NEXT (resume here):**
1. Let the Coordinator keep building the Bridge epic (P1→P6) + remaining backend seam. Monitor; escalate decisions to the human (don't auto-decide — invariant).
2. **Commit the accumulated worker output + redeploy** to make e20f1c48/b112ba50/Bridge changes live.
3. When `b5dcce4e` (target-repo) lands → the 8 cross-repo bsync todos auto-unblock.
4. Hold backend pool=1 until worktree isolation `40d38438` (upping pool is risky on the shared tree — overlapping files).
5. Profiles epic stays `planned` until you decide to release it.

**Key refs**: decisions cf58d76a (seam), e8fddf63 (profiles), 47338e3a (Bridge); docs research-collab-bsync-integration, design-bridge-layout-redesign; mockup design bridge-redesign-mockup.

## Pair Mode
Disabled

## Agent Mode
Enabled
