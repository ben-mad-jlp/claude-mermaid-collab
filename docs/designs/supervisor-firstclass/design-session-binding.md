# Design: Session ↔ Server Binding / Identity

**Status:** Proposed · **Session:** supervisor-firstclass · **Date:** 2026-06-10
**Sibling of:** decision `9cd01858` / doc `design-session-daemon-comms` (reconciliation-first comms)

---

## VISION

A Claude Code session — human or worker — should be reachable by the collab server for the *entire life of its tmux pane*, with **zero manual re-binding**, surviving frequent deploys, `/clear`, compact, `resume`, and `/tmp` pruning. The binding is not a fragile fact a session *pushes once*; it is a fact the server **continuously observes** from the most durable thing in the system: the live tmux pane. We stop registering bindings and start *reconciling* them — the exact move decision `9cd01858` made for comms, applied to identity.

The user's complaint ("sessions get lost after a while; we need to re-register, just the PPID part") dissolves: there is nothing to re-register, because the server re-derives every binding from tmux on a tick.

---

## CANONICAL IDENTITY (the decision)

**Routing identity = `(project, session)`.** Its 1:1 physical handle is the tmux name `mc-<project>-<session>` (`tmuxBaseName`). Everything else is a **re-derived secondary**:

| Field | Role | Source |
|---|---|---|
| `(project, session)` | canonical routing key | project registry / tmux pane name |
| `claudeSessionId` (UUID) | WebSocket broadcast target | resolved from pane subtree on demand |
| `claudePid` | **liveness hint only** (`kill(pid,0)`) — never a routing key | pane subtree BFS |

The binding **FILE** `/tmp/.mermaid-collab-binding-<UUID>.json` stays the on-disk artifact every consumer already reads (`session-notify` trust boundary, `ide_focus_terminal`, `ide_reattach`). The in-memory `pidToSession` map and the `claude_session_registered` WebSocket broadcast are **kept** (live UI dots are a real feature) — but both are now *repopulated by the reconciler*, not by a one-shot push.

---

## ARCHITECTURE

The server runs a **`BindingReconciler`** on boot and every ~20s. It enumerates live `mc-*` tmux panes, resolves each via the already-shipping `resolveLaneClaudeSession()` (`lane-session-register.ts:111`), and idempotently upserts the binding file + in-memory map + `watchSession` + first-seen broadcast. A token-free **SessionStart hook curl** and the existing **worker spawn call** are *fast-paths* layered on top (bind in <1s instead of waiting a tick); the reconciler is the load-bearing durable floor.

### Data flow — BOTH session kinds

```
  SESSION START (zero model tokens, human AND worker, identical)
  ┌──────────────────────────────────────────────────────────────┐
  │ claude CLI in tmux pane  mc-<project>-<session>                │
  │   └─ SessionStart hook: walk $PPID ↑ to claude PID            │
  │        write /tmp/.claude-session-id-<pid> = UUID  (overwrite) │
  │   └─ FAST-PATH: curl POST /api/claude-session/self-register    │
  │        {cwd, claudeSessionId, claudePid}  (|| true)           │
  │   └─ WORKER also: registerLaneClaudeSession() at spawn         │
  └──────────────────────────────────────────────────────────────┘
                              │
       ┌──────────────────────┴───────────────────────────────────┐
       │ DURABLE FLOOR — BindingReconciler.tickOnce()              │
       │   (server, on boot + setInterval(20s).unref())            │
       │                                                            │
       │   tmux list-panes -a -F '#{pane_pid} #{session_name}'      │  ← live panes ONLY
       │     filter name ~ /^mc-/                                   │
       │     for each pane:                                         │
       │       parse name → (project,session)                      │
       │         (reconcile vs supervised registry for x-project)  │
       │       resolveLaneClaudeSession(name):                      │
       │         BFS pane subtree → claude PID                      │
       │         read /tmp/.claude-session-id-<pid> → UUID          │
       │       UPSERT /tmp/.mermaid-collab-binding-<UUID>.json      │  ← source-of-truth file
       │       registerPidSession(pid,session)  (in-mem cache)     │
       │       watchSession(project,session)                       │
       │       broadcast claude_session_registered (first-seen)    │
       │     GARBAGE PASS: binding not in keep-set AND ESRCH → rm   │
       └────────────────────────────────────────────────────────────┘
                              │
   CONSUMERS (unchanged — key on UUID / (project,session); PID = liveness only):
   session-notify · ide_focus_terminal · ide_reattach · supervisor_nudge · status WS · resolveSessionId
```

**Human session:** lives in an `mc-*` pane → resolved by the IDENTICAL path as a worker. No daemon, no env injection, no self-report, no `echo $PPID`. The only edge — a human running *bare* `claude` outside any `mc-*` pane — is covered by the hook's `cwd → registry` self-register POST.

**Worker lane:** `claude-launch.ts:165` keeps its `registerLaneClaudeSession` call as a <1s fast-path; the reconciler re-asserts it every tick regardless. One mechanism, two kinds.

---

## IS PPID NEEDED?

**No.** PPID was never identity — it is only the hook's *internal walk-up seed* to find the claude CLI PID and write `/tmp/.claude-session-id-<pid>` (`session-start-hook.sh:24-34`). The server never needs it: `resolveLaneClaudeSession(tmux)` BFS-walks the pane subtree **down** to that same PID (`lane-session-register.ts:111`).

- User-facing PPID step in `/collab`: **DELETED** (`echo $PPID` → `register_claude_session`).
- `claudePid` in the binding file: **kept as a `kill(pid,0)` liveness hint**, never routed on.
- PPID survives only as an unexposed local variable inside the hook script.

**Answer to the user:** PPID is obsolete now that we have tmux.

---

## DURABILITY TABLE (today vs proposed)

| Decay mode | Today | Proposed | Recovery latency |
|---|---|---|---|
| **Deploy / server restart** | in-mem map wiped; nothing re-watches/re-broadcasts → UI dark until manual `/collab` | boot reconcile re-derives ALL from live tmux | **instant on boot** |
| **/clear, compact (UUID flip)** | carry-forward jq only; breaks if old binding pre-swept | hook overwrites file + next tick re-reads new UUID | **immediate** / ≤20s |
| **resume source** | **lost** — carry-forward skips `resume` | reconciler doesn't care which source fired | ≤20s (or instant via hook) |
| **7-day prune / /tmp wipe** | file gone, never recreated → permanently dark | tick re-derives from live pane | ≤20s |
| **Idle (MCP 30-min expiry)** | orthogonal; binding file fine | unaffected; tick refreshes `boundAt` | n/a |
| **Hard kill (`kill -9` / pane destroy)** | sweeper ESRCH lag; recycled-PID false-survive risk | pane absent from `list-panes` → not in keep-set + ESRCH → reaped | ≤20s |
| **Recycled PID false-survive** | sweeper trusts stale PID | identity no longer depends on PID; repaired next tick | ≤20s |

---

## HARD PARTS + HANDLING

- **Deploy** — boot tick rebuilds the entire binding set from live tmux; binding files already survived on disk, so the boot pass only needs to re-`watchSession` + re-broadcast. Directly kills the verified #1 root cause.
- **/clear + compact** — the hook overwrites `/tmp/.claude-session-id-<pid>` in place (same PID); the next tick reads the new UUID. Carry-forward jq becomes belt-and-suspenders, not load-bearing.
- **Hard kill** — no `Stop`/`SessionEnd` fires on `kill -9`; decay stays liveness-driven. Pane vanishes from `list-panes` ⇒ not refreshed; garbage pass deletes when ESRCH. Fold `BindingSweeper`'s ESRCH logic into the garbage pass so there is **one writer** on `/tmp` (no sweeper/reconciler race).
- **Human self-bind** — the human never self-identifies; the server resolves it from the `mc-*` pane. Bare-`claude`-outside-tmux edge is caught by the hook's `cwd → registry` POST.
- **Cross-project** — a worker's tmux is `mc-<launchProject>-<session>` but it may *track* a different project (`supervisor-store.ts:35`). Parsing the pane name yields the launch basename; reconcile it against the supervised registry inverse (`api.ts:3248`, `ide-routes.ts:76`) to recover the tracking pair. **Verified subtlety:** `tmuxBaseName` keys on the tracking project basename in some paths — so name→(project,session) parsing must reconcile against the registry, never assume `launch == tracking`.
- **Burst latency** — a 10s LRU on the resolve path collapses notification storms (active/waiting/permission) to one tmux walk; negative results are **not** cached so a just-started session binds immediately.
- **Sweeper** — kept conceptually but its ESRCH check moves into the reconciler garbage pass; flip the hook's 7-day session-id prune to **liveness-based** (prune only when PID dead) to remove the prune-vs-long-session race.

---

## TECHNICAL PLAN (file changes)

**NEW**
- `src/services/binding-reconciler.ts` — `class BindingReconciler { tickOnce(); start(intervalMs=20000) }`. `tickOnce`: enumerate `mc-*` panes → `resolveLaneClaudeSession` per pane → idempotent upsert (reuse `registerLaneClaudeSession` helper) → `watchSession` → first-seen-dedup broadcast → garbage pass (keep-set + ESRCH + UUID-mismatch reap). `listPanes` injectable dep, mirroring `LaneRegisterDeps`.
- `POST /api/claude-session/self-register` in `src/routes/api.ts` (near register `2415`) — body `{cwd, claudeSessionId, claudePid}`; resolve `(project,session)` from `cwd` via project registry (`trackingProjectRoot` worktree mapping); upsert binding + `watchSession` + broadcast. Token-free, hook-callable. Returns `{ok:false, reason:'needs-session'}` when ambiguous (hook no-ops).

**REUSE (verbatim)**
- `src/services/lane-session-register.ts` — `resolveLaneClaudeSession()` is the whole engine; reconciler loops over it. `registerLaneClaudeSession()` becomes the shared upsert helper.
- `tmuxBaseName` / `tmux-naming.ts` + its inverse (`ide-routes.ts:76`, `api.ts:3248-3249`) for cross-project name↔(project,session).
- `BindingSweeper` ESRCH logic (`binding-sweeper.ts:30-44`) — folded into the garbage pass.

**MODIFY**
- `src/server.ts` (boot ~174-175) — alongside/replacing `new BindingSweeper()`: `const r = new BindingReconciler(); await r.tickOnce(); r.start();`.
- `scripts/session-start-hook.sh` — keep walk-up + session-id write (overwrite-in-place on every source). Append fire-and-forget `curl -s -m 2 -X POST localhost:9002/api/claude-session/self-register -d '{...cwd,sid,pid...}' || true`. Flip 7-day prune to liveness-based.
- `src/mcp/setup.ts` (`register_claude_session` 3244-3312) — make `claudePid` **optional**; when absent, derive via `resolveLaneClaudeSession` from `(project,session)`/tmux name. Keep as a thin manual-rebind alias; mark deprecated.
- `src/services/cdp-session.ts` `resolveSessionId` — unchanged in keying (in-mem cache repopulated each tick, disk fallback intact). Optionally add a 10s LRU.
- `/collab` skill — **DELETE** the `echo $PPID` Bash step + `register_claude_session` call.

**DELETE (after soak)**
- Standalone `BindingSweeper` (`server.ts` wiring) once garbage pass is proven.

**No DB / no new columns** — `tmux list-panes` already IS the authoritative, deploy-surviving, per-machine liveness DB. State stays in `/tmp` binding files + the in-memory cache (rebuilt per tick). (Rejected a SQLite store as over-engineered — see below.)

---

## PHASED BUILD ORDER

1. **Phase 1 (highest leverage, lowest risk) — `BindingReconciler` + boot wiring.** Pure server-side, reuses the shipping resolver, runs ALONGSIDE existing registration (idempotent upserts). Instantly fixes deploy-blank + 7-day-prune + resume-miss. Verify dots relight after a deploy with no manual `/collab`. **Ship alone.**
2. **Phase 2 — self-register endpoint + hook curl.** Token-free fast-path; also covers the bare-`claude` human edge. Keep worker spawn call as the same fast-path.
3. **Phase 3 — `/collab` cleanup.** Delete the `echo $PPID` step; soften `register_claude_session` to a PID-optional manual-rebind alias.
4. **Phase 4 — decay consolidation.** Fold sweeper ESRCH into the garbage pass; flip the hook's session-id prune to liveness-based; delete standalone sweeper.

---

## WHY OVER ALTERNATIVES

- **vs hook-self-register / tmux-as-identity:** those rely on an *event* (SessionStart firing) and add machinery (env injection, a by-tmux alias file). Reconcile-on-tick relies on **no event** — it re-derives truth on a clock from facts always present while the session lives, so there is no "missed assertion" failure mode. We graft their best parts (the hook curl as a fast-path; the `(project,session)`-as-canonical framing) without their load-bearing fragility or redundant state.
- **vs boot-rehydrate-durable (SQLite):** over-engineered. tmux is already a durable per-machine liveness DB; a parallel SQLite store buys only the idle-human-across-deploy case, which the boot reconcile already recovers from the live pane.
- **vs lazy-on-demand:** elegant, but deleting the in-memory map + WS broadcast means UI dots can only be polled, not pushed — a real UX regression. We keep the push path and steal only its live-negative-result insight (10s LRU, no negative caching).

## TOP RISKS

1. **~20s worst-case relight latency** after a deploy if a session isn't cycling — mitigated by the boot `tickOnce()` (instant on boot) and the hook fast-path. Tunable via interval.
2. **Steady tmux-walk cost** — bounded: one `list-panes -a` + BFS (guard <256) + a few `kill(pid,0)` per tick; <100ms for <50 panes at 20s. LRU collapses bursts.
3. **Cross-project name parsing** — the launch-vs-tracking subtlety must reconcile against the registry, not assume equality; covered explicitly in the resolver path and tested.

---

## RELATION TO THE COMMS EPIC

This is the **identity sibling** of decision `9cd01858` (reconciliation-first comms, doc `design-session-daemon-comms`). Same philosophy — *derive durable facts on a tick, don't push volatile state* — and ideally the **same tick loop**: the comms reconciler and the binding reconciler can share one `setInterval` and both consume `resolveLaneClaudeSession`. Land binding-reconcile as a phase under the comms epic so they evolve together and share the enumerate-panes pass.
