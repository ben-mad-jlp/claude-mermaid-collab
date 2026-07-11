# Design: Persistent role-typed worker sessions (Worker Pool)

Status: DRAFT for approval. Supersedes the ephemeral spawn-fresh-per-todo worker model for interactive/dogfooding use. Grok consult deferred (XAI key invalid).

## 1. Motivation
Today the Coordinator spawns a **fresh, anonymous, ephemeral** `claude` tmux session per todo (`worker-<id8>`), runs `/worker <id>`, and discards it. Two problems surfaced while dogfooding:
1. **Workers stall on the first permission prompt** — every agent profile uses `runtimeMode: 'edit'`, which adds no flag, so spawned `claude` runs interactive and deadlocks at "Do you want to proceed?". The loop has never actually run unattended.
2. **Workers don't appear in "Watching"** — they bind via `/collab worker-xxx` but nothing subscribes them, so the human can't see or click into them. The user's actual supervision flow is *watch the card → click in → flip auto-accept*, which is impossible without the card.

The user's proposed model: **a stable set of role-typed sessions (frontend, backend, …) that live in Watching and pick up todos of their type over time** — a "team of named specialists" instead of anonymous churn.

## 2. Current state (ground truth)
- `coordinator-live.ts launchWorker(project, todo)` → `resolveWorkerProfile(todo)` (`agent-profiles.ts`) → `launchAndBind()` (`claude-launch.ts`).
- `launchAndBind`: `tmux new-session -d -s worker-<id8>` → types `claude --allowedTools "…" [--model] [runtimeModeFlags]` → waits for TUI ready → `/collab worker-<id8>` → `/worker <id>`.
- `runtimeModeFlags`: `read-only`→disallow edit/bash; `bypass`→`--dangerously-skip-permissions`; `edit`/default→**no flag** (interactive).
- All profiles (default/frontend/backend/api/ui/library) currently = `{ allowedTools: 'Bash Edit Write Read <MCP>', runtimeMode: 'edit' }`. `type` only varies params, not session identity.
- **Context-watchdog (#6, BUILT)**: `selectWatchdogActions()` — per session, at ≥80% ctx on an idle boundary → checkpoint → verify-persisted (hard gate `checkpoint_ready`) → `/clear` → re-setup. This is the mechanism that makes a long-lived session safe.
- **Claim/lease (BUILT)**: `claimTodo` (CAS + 15-min lease), `reapDeadClaims` (tmux-alive check → reclaim/escalate), retry-cap → blocked+escalate.

## 3. Proposed model — Worker Pool of typed sessions
Replace per-todo spawn with a **pool of persistent, role-typed sessions** the Coordinator routes todos to.

### 3.1 Session identity
- Sessions named by **type + index**: `fe-1`, `be-1`, `api-1`, … (not `worker-<todoId>`). One per (type, slot).
- A pool config per project: `{ frontend: 1, backend: 1, api: 0, … }` = how many slots per type (parallelism dial). Default: 1 each for the types that appear in the ready-queue; 0 spawned lazily.
- A typed session is **long-lived**: it stays up across todos, picking up the next matching todo when it finishes one.

### 3.2 Routing (Coordinator change)
- On tick: for each `ready` todo, resolve `todo.type` → required pool type → find a **free** session of that type (not currently claiming a todo).
  - Free session exists → route todo to it (claim under that session's name; send `/worker <id>` into the existing tmux).
  - No free session but slot budget remains → spawn a new typed session (lazy), then route.
  - All slots of that type busy → leave todo `ready`; next tick.
- This keeps `dependsOn` wave-scheduling intact; parallelism is bounded by pool size per type instead of unbounded spawn.

### 3.3 Reuse instead of discard
- `complete_todo` no longer ends the session. The worker reports done, the session goes **idle** and is eligible for the next matching todo.
- Between todos the session keeps its warm context UNTIL the watchdog trips (≥80%) → checkpoint+clear+re-setup. So context is bounded without losing the warm-session benefit.

### 3.4 Watching registration (independent win)
- On spawn, **auto-subscribe** the session into the supervisor's Watching list (subscriptions) so a card always appears. Applies to ANY model (do this even if we keep ephemeral).
- Card shows: type+slot, current todo, status (idle/working), ctx%, claim/lease.

### 3.5 Autonomy level (the key knob)
Two distinct levels; make it a per-pool/per-type setting:
- **Supervised auto-accept (default, matches user's flow)**: session launches interactive + auto-registered in Watching. The human clicks the card and flips auto-accept (shift-tab), OR a UI affordance toggles it. NOT `--dangerously-skip-permissions`.
- **Headless bypass**: launch with `--dangerously-skip-permissions`; never prompts; runs fully unattended.
Recommended default = **supervised auto-accept** for dogfooding; allow opting a type into headless once trusted.
> NOTE: there is no CLI flag to *pre-arm* the interactive auto-accept toggle today — see Open Question Q4. If we can't pre-arm it, "supervised auto-accept" still requires one human click per session (acceptable: once per session, not per tool), or we fall back to headless `bypass` for true hands-off.

## 4. What changes (scope)
- `agent-profiles.ts`: add `runtimeMode`/autonomy per type; add pool-size + session-naming concept (or a new `worker-pool.ts` config).
- `coordinator-live.ts`: routing logic (free-session lookup, lazy spawn, route-to-existing-tmux), reuse-on-complete (don't kill), pool bookkeeping.
- `claude-launch.ts`: support "send `/worker <id>` into an EXISTING bound session" (today it always creates+binds). Split bind-once from run-todo.
- Watching/subscriptions: auto-subscribe on spawn (backend + supervisorStore).
- Watchdog: already per-session; just ensure typed sessions are enrolled.

## 5. Decisions / constraints to record
- **Decision**: Move to a persistent role-typed Worker Pool; retire ephemeral per-todo spawn for interactive use. (Ephemeral remains a valid headless fallback.)
- **Decision**: Auto-subscribe every spawned worker/typed session into Watching — unconditional, do first.
- **Constraint**: Default autonomy = supervised auto-accept (human-in-the-loop via Watching card), NOT headless bypass, until a type is explicitly trusted.
- **Constraint**: Reuse a typed session across todos; bound its context ONLY via the existing context-watchdog (checkpoint→clear→re-setup at 80%) — never auto-compact.
- **Constraint**: Pool size per type is the parallelism dial; a busy pool leaves todos `ready` (no unbounded spawn).
- **Assumption**: A long-lived session's `/clear`+re-setup cycle preserves correctness because the work-graph todo (not session memory) is the source of truth per todo.

## 6. Open questions (decide before build)
- **Q1 Pool sizing**: fixed `1` per active type to start, or configurable per project? Auto-scale to ready-queue depth?
- **Q2 Naming/visibility**: `fe-1`/`be-1` typed names (clear in Watching) vs keeping `worker-*`. (Recommend typed.)
- **Q3 Headless opt-in**: which types, if any, default to `bypass` vs supervised?
- **Q4 Pre-arming auto-accept**: can we start `claude` already in auto-accept mode without `--dangerously-skip-permissions`? If not, "supervised" = one click per session OR use bypass. (Needs a claude-code capability check.)
- **Q5 Cross-type todos** (`type: default`/multi-domain): which pool? A `general` slot, or the largest-matching type?
- **Q6 Idle retirement**: kill a typed session after N idle minutes to free resources, or keep warm indefinitely?

## 7. Immediate unblock (orthogonal, do regardless)
The two currently-stalled workers (T1, INFRA) are deadlocked on prompts. Independent of this redesign we should either (a) flip worker profiles to `bypass` so they run now, or (b) auto-subscribe + manually auto-accept them. This design doesn't block that quick fix.
