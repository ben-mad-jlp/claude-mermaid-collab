# First-Class Steward — Definitive Design

> **Winner:** `minimal-flag` (judge total 44/50, #1 single-user-fit). Grafted: policy-router's server-side proof gate + hard human-reserved floors; context-supervised-agent's phased autonomy ramp + fail-open-to-human + loud override counter. **Dropped:** the cloned `steward_decision` queue, the cloned `steward-liveness.ts` daemon, the supervisor-superset shared-epoch overload — all premature multi-writer machinery at one host.

---

## 1. VISION

The Steward is a **stand-in for the absent human** that keeps the agent fleet flowing while you are away. Its safe job is **un-sticking work the system wrongly stalled** (re-queueing false blockers); its forbidden job is **deciding what the work should be or declaring it finished on its own say-so**.

The thesis: for a local-first single-user product the contended resource is **human attention**, and a steward is a proxy for it. So the Steward is **not** a new subsystem — it is *one role flag on the existing supervisor identity*, a routing tag on escalations, and the existing steward skill looping on the verbs we already shipped. **The steward LLM session IS the daemon** (the human launches a long-lived foreground skill); we do not spawn an on-demand judge from a server tick. Escalations ARE the durable, deduped, restart-surviving queue — no second one is built.

The one-line invariant: **a steward acts only when the server can re-derive its verdict from ground truth; absence of proof is a hand-back, never a license for judgment.** Restore-state → auto; create-truth → human; uncertain → fail closed to the human.

---

## 2. ROLE MODEL + REGISTRATION

### Identity — one column, no new table

Reuse `supervisor_identity`. Relax the singleton from `id=1 CHECK` to **`PRIMARY KEY(role)`** (max two rows: `supervisor`, `steward`) and add `role TEXT NOT NULL DEFAULT 'supervisor'`.

```
supervisor_identity (role PK, project, session, updatedAt, serverId, epoch)
   rows:  ('supervisor', ...)   ('steward', ...)
```

- `setSupervisorIdentity(project, session, serverId, role='supervisor')` — `INSERT OR REPLACE` keyed by `role`, bumps `epoch = prev.epoch + 1` (monotonic counter, clock-skew-immune). Default arg keeps every existing caller untouched.
- `assertSupervisorOwner(epoch, role='supervisor')` — throws `SupersededError` (generalized with a `role` label) on stale/absent epoch, performing NO write. Per-role fence.
- `touchSupervisorIdentity(epoch, role)` — fenced heartbeat. Reuse `SUPERVISOR_HEARTBEAT_INTERVAL_MS=30s` / `SUPERVISOR_STALE_AFTER_MS=60s`.

### Registration

Running `skills/steward/SKILL.md` calls a thin new verb `register_steward(project, session)` → `setSupervisorIdentity(..., role:'steward')` → returns `{steward:{epoch}}`. Identical shape to `register_supervisor`. **This satisfies requirement 1: running the skill registers the session.**

### Steward ↔ Supervisor relation

**Independent, parallel epochs — NOT a parent/owner fence.** The steward does not own, re-issue, or bump the supervisor's epoch. It acts on supervisor-domain state only through already-fenced act-verbs, calling them under its *own* steward epoch (handlers accept `role:'steward'`). Hierarchy is expressed in (a) which escalations route to it and (b) DOM order in the sidebar — never in a fencing relationship. Rationale: per-role epochs keep blast radius separable and auditable; a steward bug can never corrupt supervisor-domain attribution.

A second steward registering bumps the steward-epoch; the first's next fenced write throws `SupersededError` and it stops cold. **This is the kill-switch and the human-reclaim, for free.**

---

## 3. ESCALATION FORWARDING + ANSWER/ACT LOOP

### Transport — reuse existing WS broadcast + poll. No new push bus.

`escalation_create` already broadcasts `escalation_created` (setup.ts:3717) and `createEscalation` (L353) already dedupes on `(project, session, questionText, status='open')`. The steward skill **polls `escalation_list` filtered to `routedTo='steward', status='open'`**; the WS event is merely a wake-hint to poll sooner. Escalations ARE the durable queue.

### Routing — deterministic, server-side, at create-time, by KIND not prose

Extend `ESCALATION_KINDS` with `'needs-design'`, `'assumption-invalidated'`, `'operator-gated'`. Add columns to `escalation`: `routedTo TEXT DEFAULT 'human'`, `operatorGated INTEGER DEFAULT 0`, `proof TEXT` (on resolution), `stewardAttempts INTEGER DEFAULT 0`.

Pure function `routeOf(kind, operatorGated)` called inside `createEscalation`:

| kind / flag | routedTo |
|---|---|
| `operatorGated=1` (irreversible / outward) | **human** |
| `approval` | **human** (sign-off is definitionally human) |
| `decision` (genuine product A/B) | **human** |
| `assumption-invalidated` | **human** (re-planning is the Planner's) |
| `blocker`, `question` | **steward** |
| `needs-design` | **steward** (mechanical re-park only, never design) |

> **HARD SERVER FLOORS (grafted from policy-router, tightened):** a future `.collab/steward-policy.json` may ONLY ever make routing *more* conservative (steward→human). It can NEVER lift `operatorGated` / `approval` / `decision` / `assumption-invalidated` / override-with-in-tree-gate-failure into AUTO. These floors live in server code, not config.

### Answer/act loop — the skill IS the daemon (reuse shipped act-verbs)

For each steward-routed escalation the skill classifies into the codified buckets and acts ONLY when it can cite a **deterministic, server-re-validated proof string**:

| Bucket | Act verb | Proof the skill MUST cite (server re-validates) |
|---|---|---|
| STALE blocker | `reset_todo` | `git rev-list --count HEAD..master == 0`, grep-hit for named fixed symbol, or `tsc --noEmit` clean — stored on resolution |
| NOW-BUILDABLE | `reset_todo`→ready | dep todo is `done/accepted` in store AND target is leaf (no `needs-design`) |
| runaway-retry, cause fixed | `reset_todo` | same staleness proof; unproven → hand back |
| VERIFIED-DONE false-reject | `override_accept_todo` | **default DEFER**; auto only if (a) deliverable artifact provably in-tree (file+symbol cited) AND (b) gate failure is *foreign* (outside the change's own files) |
| needs-design | `update_session_todo`→planned + "run vibe-blueprint" note | never designs; re-parks so Coordinator stops one-shotting |
| keep-flowing | `start_coordinator` / `stop_coordinator` | coordinator stale/stopped |

Then `escalation_resolve`. Un-actionable / no-proof → flip `routedTo='human'` (one column write) → re-surfaces in `NeedsYouZone` tagged "deferred by steward."

**The single most important rail (grafted, non-negotiable): the SERVER, not the LLM, enforces the proof gate.** The `reset_todo` / `override_accept_todo` handlers, when called under a steward epoch, **reject any call lacking the required machine-checkable proof field and re-route to human.** The LLM cannot talk past a handler-level deterministic check. No on-demand spawner, no `enqueueDecision` queue — escalations are the queue; the skill is the judge.

---

## 4. LIVENESS / CONTEXT SUPERVISION OF THE STEWARD

Three layers, all REUSE — no cloned `steward-liveness.ts`.

1. **Heartbeat:** the skill calls `touchSupervisorIdentity(epoch, role:'steward')` each loop. Liveness math = the same `SUPERVISOR_STALE_AFTER_MS` against `updatedAt`.
2. **Context (self-clear):** the steward is just another `(project, session)`. Its context exhaustion uses the role-agnostic `checkpoint_ready` → `supervisor_clear_session` gate (checkpoint into its active triage todo, then `/clear` + resume). The context-watchdog `self` branch already handles "a session can't clear itself." The **supervisor's `supervisor_watchdog_scan` includes the steward session** (role-agnostic by `(project,session)`) so it is checkpoint/clear-managed like any supervised session.
3. **Who watches the watcher — FAIL-OPEN-TO-HUMAN, not a second daemon.** The regress bottoms out at the always-on server. The `GET /api/supervisor/steward-identity` route computes `stale`. When the steward is stale/dead: the system **stops routing to steward** (`routeOf` defaults flip everything to human), the StewardPanel front door flips to `crashed`, and **one** human escalation surfaces: *"steward dead, N escalations queued."* It does NOT spawn a replacement LLM. A dead automation must become the human's problem loudly, never auto-act blind or breed a watcher-for-the-watcher. This is strictly simpler than a cloned spawner and is the *correct* single-user behavior.

---

## 5. HAND-BACK BOUNDARY

### Never auto-decided (human-reserved invariant — enforced by routing + handler proof gate, NOT skill advice)

- **Irreversible:** delete, force-push, schema migration; `override_accept` of work whose gate failed *inside its own change-set files*.
- **Outward-facing:** deploy, publish, external API write, message/email send, spend (`operatorGated=1`).
- **True product decisions:** what to build, behavior/UX, public contracts, scope cuts, epic re-prioritization (`kind='decision'`).
- **`approval` / `assumption-invalidated`** kinds — definitionally human.
- **Anything lacking its deterministic proof** — proof-absence is itself a hand-back trigger.

### How the human reclaims (one keystroke each, durable)

1. **Supersede (hard kill):** human runs the steward skill in their own session → epoch bump → autonomous steward's next fenced write throws `SupersededError`, stops cold. Free; reuses `assertSupervisorOwner`.
2. **Pause (soft):** `steward_pause` / `steward_pause_status` / `steward_resume` — clone `supervisor_pause`/`isSupervisorPaused` with a `role:'steward'` scope. Router stops forwarding (all → human), steward parks. The standin's "I've got it from here."
3. **Undo a bad override:** `override_accept_todo` is reverted by `reset_todo` (clears acceptance). Documented recovery path; one-click "undo this override" in the panel feed. Every other steward action is reversible by design.

---

## 6. LEFT-COLUMN UI + ROLE HIERARCHY

New `StewardPanel.tsx` (clone of `SupervisorPanel.tsx`'s three-state front door: `none` → "Become the Steward" / `crashed` → "Restart" / `running` → dashboard), mounted in `Sidebar.tsx` (~L87) **above** `<SupervisorPanel>`. Backed by new route `GET /api/supervisor/steward-identity` (mirror supervisor-routes.ts:314, `role='steward'`). The panel leads with liveness; the scary metric (override count) is loud.

```
┌─ SIDEBAR (left column) ─────────────────────┐
│ ╔═════════════════════════════════════════╗ │
│ ║ ◆ STEWARD          ● LIVE  epoch 4  hb12s║ │  ← NEW, top slot (RED dot if stale)
│ ║   stand-in for you                       ║ │
│ ║   queue: 3 steward · 1 → you             ║ │
│ ║   ⚠ override-accepts this session: 0     ║ │  ← the scary metric, loud
│ ║   ─ last actions (with proof) ──────     ║ │
│ ║   ✓ reset_todo T-812  HEAD..master==0    ║ │
│ ║   ✓ reset_todo T-790  tsc clean          ║ │
│ ║   ↩ deferred T-770 → you (no proof)      ║ │
│ ║   [ Pause ]   [ Take over ]              ║ │
│ ╚═════════════════════════════════════════╝ │
│ ┌─────────────────────────────────────────┐ │
│ │ ▣ SUPERVISOR        ● running  epoch 7   │ │  ← existing, now 2nd
│ │   supervised: 4 · nudged 1               │ │
│ └─────────────────────────────────────────┘ │
│ ── NeedsYouZone (sticky) ───────────────────│
│   ⚑ decide: rebase vs merge?   [direct]     │  ← never seen by steward
│   ↩ accept T-770?      [steward sent this]  │  ← provenance tag
│                                              │
│  Subscriptions · Artifacts · Servers …       │
└──────────────────────────────────────────────┘

Role ladder:  Steward ▸ Supervisor ▸ Coordinator/Planner ▸ workers
```

`NeedsYouZone` / `escalationSelectors.ts` gain a **"steward sent this to you"** provenance tag (from the `routedTo` flip) so the human distinguishes *triaged-and-deferred* from *never-seen*.

---

## 7. SAFETY RAILS + FAILURE MODES + OBSERVABILITY

**Rails (priority order):**
1. **Server-enforced proof, not LLM trust** — handler rejects any steward act lacking its machine-checkable proof field; re-routes to human. The keystone rail.
2. **`override_accept_todo` confidence-gated + rate-limited** — default DEFER; auto only with in-tree-artifact proof AND foreign-error proof; cap auto-overrides/hour (proposed 2); (N+1)th forces human review.
3. **Hallucinated-resolve detection** — cross-check verdict vs store: claims dep `done` but store says `blocked` → reject. Cheap, deterministic, catches the worst hallucination class.
4. **Fail-open-to-human on death/supersede/pause** — routing stops, queue drains to human; never act on a stale epoch (fence guarantees it).
5. **Thrash guard** — same `todoId` reset→reclaim→re-escalate > K times (proposed 3, via `stewardAttempts`) → stop auto-handling, escalate as *systemic* (cause is real, not stale). Reuse `retryCount` semantics.
6. **Full audit** — every steward action → `recordSupervisorAudit` with `kind='steward_reset'|'steward_override'|'steward_defer'`, the bucket, the proof string, the escalationId; stamp `completedBy='steward'`. Survives restart — this is what earns human trust.

**Failure modes:**
- *Steward crash mid-triage* → un-flipped escalations stay `routedTo='steward'`, re-polled idempotently on resume; if it stays dead, fail-open surfaces them to human (§4).
- *Steward ↔ supervisor write race on same escalation* → `resolveEscalation`/decide is last-write-wins idempotent; per-role epoch fence stops a superseded actor.
- *Steward loops on un-actionable escalation* → `stewardAttempts` cap → auto-handback (rail 5).
- *Proof stale between judge and act* → handler re-validates proof at act time, not just classify time; stale → re-route to human.

**Observability (panel, loud):** queue depth + age; auto-action feed *with proof strings*; deferred-count; **override-accept count this session (surfaced prominently — the scary metric)**; steward liveness/epoch; one-click "everything the steward touched since I left" (filter `supervisor_audit` to `kind LIKE 'steward_%'` since last human heartbeat).

---

## 8. TECHNICAL PLAN

### Store (`src/services/supervisor-store.ts`) — mostly EDIT
- EDIT `supervisor_identity`: add `role TEXT NOT NULL DEFAULT 'supervisor'`; `id=1 CHECK` → `PRIMARY KEY(role)`. **Additive migration with backfill defaulting existing rows to `role='supervisor'`.**
- EDIT `setSupervisorIdentity` / `assertSupervisorOwner` / `touchSupervisorIdentity` / `getSupervisorIdentity`: add `role` param (default `'supervisor'` → existing callers untouched). Generalize `SupersededError` with a `role` label.
- EDIT `escalation` table: add `routedTo TEXT DEFAULT 'human'`, `operatorGated INTEGER DEFAULT 0`, `proof TEXT`, `stewardAttempts INTEGER DEFAULT 0`. Extend `ESCALATION_KINDS` (+`needs-design`, `assumption-invalidated`, `operator-gated`).
- NEW (tiny): `routeOf(kind, operatorGated)` pure fn, called in `createEscalation` (L353); `setStewardPause`/`isStewardPaused` (role scope on existing pause machinery); `incrementStewardAttempts`.
- Audit: reuse `recordSupervisorAudit` with `steward_*` kinds.

### MCP (`src/mcp/setup.ts`) — 2 thin verbs + 1 gate
- NEW `register_steward` (clone `register_supervisor` L3624, pass `role:'steward'`).
- NEW `steward_pause` / `steward_resume` / `steward_pause_status` (clone `supervisor_pause`).
- EDIT dispatch for `reset_todo` (L4464) / `override_accept_todo` (L4471): under a steward epoch, **require + server-re-validate the proof field; reject + re-route to human if absent/false; rate-limit + hallucinated-resolve check on override.**
- EDIT `escalation_created` broadcast (L3717): include `routedTo`.
- Tool-def array (~L2034): add the new verbs.
- (Optional) `steward_triage_next` = thin `escalation_list` filter for the skill loop.

### Routes (`src/routes/supervisor-routes.ts`)
- NEW `GET /api/supervisor/steward-identity` (mirror L314 liveness math, `role='steward'`). Existing `GET /api/supervisor/escalations` gains `routedTo`/`proof` fields.

### WS events
- Reuse `escalation_created` (+`routedTo`), `escalation_decided`. ADD cheap `steward_action` (auto-action + proof, panel feed) and `steward_handback` (re-surface in NeedsYouZone). Not load-bearing — the escalation table is the source of truth.

### UI
- NEW `ui/src/components/layout/StewardPanel.tsx` (clone `SupervisorPanel.tsx:177`); mount above `<SupervisorPanel>` in `Sidebar.tsx:88`.
- EDIT `NeedsYouZone.tsx` + `escalationSelectors.ts`: "steward sent this" provenance + override-count metric.
- EDIT `supervisorStore.ts`: poll steward-identity (10s).

### Skill (`skills/steward/SKILL.md`) — TIGHTEN
- Add: call `register_steward` on entry; `touchSupervisorIdentity(role:'steward')` each loop; the proof-required autonomy ladder (§3) verbatim.
- **TIGHTEN line 51 (GENUINE-DECISION):** must NOT auto-decide product/irreversible/outward — now routed human by kind; state it.
- **TIGHTEN line 49 (`override_accept`):** require the foreign-error proof, not just "deliverable exists." Document `reset_todo` as the undo.

### Reuse vs New vs Delete
- **REUSE:** epoch fence, escalation table + dedup + NeedsYouZone + decide route, `reset_todo`/`override_accept_todo`/`start_coordinator`/`stop_coordinator`, `checkpoint_ready`/`supervisor_clear_session`/`supervisor_watchdog_scan`, `supervisor_pause`, `recordSupervisorAudit`, `SupervisorPanel` front door.
- **NEW:** 1 column (`role`) + 4 escalation columns; `routeOf`; `register_steward`/`steward_pause`/`steward_resume`; server proof gate on act-verbs; `steward-identity` route; `StewardPanel`; 3 escalation kinds; 2 cheap WS events.
- **DELETE/NEVER BUILD:** separate `steward_decision` queue; `steward-liveness.ts` daemon clone; on-demand LLM spawner; push WS transport; shared/overloaded decision queue; user-editable policy as autonomy authority. (All deferred to a multi-user day that may never come.)

### PHASED BUILD ORDER
1. **Phase 0 (skill-only, ZERO schema, ship day one):** steward skill registers via `register_supervisor` convention, loops on `escalation_list`, acts via shipped verbs. Proves the loop end-to-end before touching schema. Smallest shippable.
2. **Phase 1 (role + routing):** `role` column (additive migration + backfill), `register_steward`, `routedTo`/`operatorGated`, `routeOf`, new escalation kinds. Escalations now split steward/human. **Gate the whole auto-act path behind `MERMAID_STEWARD_AUTO` env, default OFF, so a migration bug can never silently fence the live supervisor.**
3. **Phase 2 (proof gate — the safety core):** server-side proof re-validation on `reset_todo`/`override_accept_todo` under steward epoch; rate-limit + hallucinated-resolve check. Enable reversible `reset_todo` auto first; `override_accept` last.
4. **Phase 3 (UI):** `StewardPanel` + provenance tag + observability metrics + steward-identity route + WS events.
5. **Phase 4 (reclaim + liveness polish):** `steward_pause`/`resume`, fail-open "steward dead, N queued" escalation, `supervisor_watchdog_scan` includes steward, document `reset_todo` undo.

---

## 9. WHY OVER ALTERNATIVES + TOP RISKS

**Why minimal-flag wins:** it is the only concept right-sized for local-first single-user and it matches the real seams (role column on the existing identity, `routeOf` at `createEscalation` L353, the `escalation_created` broadcast at L3717, escalations ARE the durable queue, the steward skill IS the daemon → no on-demand spawner). Phase 0 ships a genuine steward day one with zero schema change.

- vs **separate-steward-daemon:** 2 tables + 5 verbs + a cloned daemon is the multi-writer machinery the brief warns is premature at one host; the second daemon is a second thing that can silently die.
- vs **supervisor-superset:** overloads the worker-stop decision queue with escalation autonomy on a single epoch row — a steward bug or stale-epoch confusion takes down the plain supervisor too. Failure domains the code keeps separate must stay separate.
- vs **context-supervised-agent:** liveness-first thesis is honest, but its separate `steward_identity` + cloned `steward-liveness.ts` + meta-watchdog is heavier than fail-closed-via-existing-`supervisor_watchdog_scan` with little marginal safety at one host. We graft its phased ramp + fail-open default + loud counter without the daemon clone.
- vs **policy-router:** strongest safety story; we graft its proof gate, but DROP the user-editable `steward-policy.json` as the autonomy authority — config may only make routing more conservative; the human-reserved set stays a hard server floor no config can lift.

**Top risks:**
1. **The `id=1 CHECK` → `PRIMARY KEY(role)` widening** is the single riskiest edit — it rewrites the supervisor singleton and touches every `assertSupervisorOwner` call site. *Mitigation:* additive migration with backfill to `role='supervisor'`; gate the auto-act path behind `MERMAID_STEWARD_AUTO` (default off) so a migration bug can never silently fence the live supervisor.
2. **Proof gate is only as good as the predicates** — a weak/forgeable proof string lets the LLM through. *Mitigation:* predicates are server-executed shell/store checks (`git rev-list`, `tsc`, store state), never LLM-asserted booleans; re-validate at act time.
3. **`override_accept_todo` blast radius** — wrong override ships broken code as "accepted" and unblocks dependents on a lie. *Mitigation:* default DEFER + dual-proof + rate limit + loud session counter + `reset_todo` undo, shipped last (Phase 2 tail).
4. **Silent rot while away** — the real single-user failure. *Mitigation:* fail-open-to-human on stale heartbeat; "steward dead, N queued" escalation; one-click "everything touched since I left."
