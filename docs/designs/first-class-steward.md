# First-Class Steward — Definitive Design

> Committable mirror of the collab session doc `design-first-class-steward` (session `supervisor-firstclass`), produced by the `design-exploration` workflow (5 concepts → adversarial judge → synthesis).
>
> **Winner:** `minimal-flag` (judge total 44/50, #1 single-user-fit). Grafted: policy-router's server-side proof gate + hard human-reserved floors; context-supervised-agent's phased autonomy ramp + fail-open-to-human + loud override counter. **Dropped:** the cloned `steward_decision` queue, the cloned `steward-liveness.ts` daemon, the supervisor-superset shared-epoch overload — all premature multi-writer machinery at one host.
>
> Decision record: `3a122bc2`. Constraint: `020b7ab1` (active). Plan: `docs/plans/2026-06-06-first-class-steward.md`.

---

## 1. VISION

The Steward is a **stand-in for the absent human** that keeps the agent fleet flowing while you are away. Its safe job is **un-sticking work the system wrongly stalled** (re-queueing false blockers); its forbidden job is **deciding what the work should be or declaring it finished on its own say-so**.

For a local-first single-user product the contended resource is **human attention**, and a steward is a proxy for it. So the Steward is **not** a new subsystem — it is *one role flag on the existing supervisor identity*, a routing tag on escalations, and the existing steward skill looping on the verbs we already shipped. **The steward LLM session IS the daemon**; escalations ARE the durable, deduped, restart-surviving queue — no second one is built.

The one-line invariant: **a steward acts only when the server can re-derive its verdict from ground truth; absence of proof is a hand-back, never a license for judgment.** Restore-state → auto; create-truth → human; uncertain → fail closed to the human.

## 2. ROLE MODEL + REGISTRATION

Reuse `supervisor_identity`. Relax the singleton from `id=1 CHECK` to **`PRIMARY KEY(role)`** (max two rows: `supervisor`, `steward`) + `role TEXT NOT NULL DEFAULT 'supervisor'`.

- `setSupervisorIdentity(…, role='supervisor')` — `INSERT OR REPLACE` keyed by role, bumps `epoch = prev+1`. Default arg keeps every caller untouched.
- `assertSupervisorOwner(epoch, role='supervisor')` — per-role fence; throws `SupersededError` (role-labelled) on stale/absent epoch.
- `touchSupervisorIdentity(epoch, role)` — fenced heartbeat (reuse 30s/60s constants).
- Registration: `register_steward(project, session)` → `setSupervisorIdentity(role:'steward')`. Running the skill registers the session (req 1).
- **Steward ↔ Supervisor = independent parallel epochs, NOT a parent fence.** The steward acts on supervisor-domain state only through already-fenced act-verbs under its OWN steward epoch. Hierarchy = which escalations route to it + DOM order, never fencing. A second steward registering bumps the epoch → the first's next fenced write throws `SupersededError` and stops cold (the kill-switch + human-reclaim, free).

## 3. ESCALATION FORWARDING + ANSWER/ACT LOOP

**Transport:** reuse the existing `escalation_created` WS broadcast + dedup. The skill polls `escalation_list` filtered to `routedTo='steward'`; the WS event is a wake-hint. Escalations ARE the queue.

**Routing — deterministic, server-side, at create-time, by KIND.** Add escalation columns `routedTo`, `operatorGated`, `proof`, `stewardAttempts`; extend `ESCALATION_KINDS` (+`needs-design`, `assumption-invalidated`, `operator-gated`); pure `routeOf(kind, operatorGated)` in `createEscalation`:

| kind / flag | routedTo |
|---|---|
| `operatorGated=1`, `approval`, `decision`, `assumption-invalidated` | **human** |
| `blocker`, `question`, `needs-design` | **steward** |

> **HARD SERVER FLOORS:** a future `.collab/steward-policy.json` may only make routing *more* conservative; it can NEVER lift the human-reserved kinds (or an override with in-tree gate failure) into AUTO. Floors live in server code.

**Answer/act loop — the skill IS the daemon, acting only on a server-re-validated proof string:**

| Bucket | Verb | Proof (server re-validates) |
|---|---|---|
| STALE blocker | `reset_todo` | `git rev-list --count HEAD..master==0`, grep-hit for fixed symbol, or `tsc` clean |
| NOW-BUILDABLE | `reset_todo`→ready | dep `done/accepted` in store AND leaf (no `needs-design`) |
| VERIFIED-DONE false-reject | `override_accept_todo` | **default DEFER**; auto only if deliverable provably in-tree AND gate failure is *foreign* |
| needs-design | `update_session_todo`→planned + "run vibe-blueprint" | never designs; re-parks |
| keep-flowing | `start/stop_coordinator` | coordinator stale/stopped |

Then `escalation_resolve`. No-proof → flip `routedTo='human'` (re-surfaces tagged "deferred by steward"). **The keystone rail: the SERVER, not the LLM, enforces the proof gate** — the act-verb handlers, under a steward epoch, reject any call lacking the machine-checkable proof and re-route to human.

## 4. LIVENESS / CONTEXT SUPERVISION OF THE STEWARD

Three layers, all REUSE:
1. **Heartbeat:** skill calls `touchSupervisorIdentity(role:'steward')` each loop; liveness math = `SUPERVISOR_STALE_AFTER_MS`.
2. **Context self-clear:** the steward is just `(project, session)` — uses `checkpoint_ready` → `supervisor_clear_session`; `supervisor_watchdog_scan` includes it (role-agnostic).
3. **Who watches the watcher — FAIL-OPEN-TO-HUMAN, not a second daemon.** Bottoms out at the always-on server: when the steward is stale/dead, routing flips everything to human, the panel shows `crashed`, and ONE escalation surfaces "steward dead, N queued." It does NOT spawn a replacement LLM.

## 5. HAND-BACK BOUNDARY

**Never auto-decided** (enforced by routing + handler proof gate): irreversible (delete/force-push/migration; `override_accept` of work whose gate failed inside its own files); outward-facing (deploy/publish/external write/spend — `operatorGated=1`); true product decisions (`kind='decision'`); `approval`/`assumption-invalidated`; anything lacking its deterministic proof.

**Human reclaim (each durable, one keystroke):** (1) **Supersede** — run the skill in your own session → epoch bump → autonomous steward's next fenced write throws → stops cold. (2) **Pause** — `steward_pause`/`steward_resume` (router stops forwarding). (3) **Undo a bad override** — `reset_todo` clears the acceptance; one-click in the panel.

## 6. LEFT-COLUMN UI + ROLE HIERARCHY

New `StewardPanel.tsx` (clone of `SupervisorPanel`'s 3-state front door), mounted in `Sidebar.tsx` **above** `<SupervisorPanel>`; backed by `GET /api/supervisor/steward-identity`. Leads with liveness; the override-count is loud.

```
┌─ SIDEBAR ───────────────────────────────────┐
│ ╔ ◆ STEWARD          ● LIVE  epoch 4  hb12s ╗ │  ← NEW top slot (RED if stale)
│ ║   stand-in for you                        ║ │
│ ║   queue: 3 steward · 1 → you              ║ │
│ ║   ⚠ override-accepts this session: 0      ║ │  ← the scary metric, loud
│ ║   ✓ reset_todo T-812  HEAD..master==0     ║ │
│ ║   ↩ deferred T-770 → you (no proof)       ║ │
│ ║   [ Pause ]   [ Take over ]               ║ │
│ ╚═══════════════════════════════════════════╝ │
│ ┌ ▣ SUPERVISOR        ● running  epoch 7    ┐ │  ← existing, now 2nd
│ └───────────────────────────────────────────┘ │
│ ── NeedsYouZone ────────────────────────────  │
│   ⚑ decide: rebase vs merge?   [direct]       │  ← never seen by steward
│   ↩ accept T-770?      [steward sent this]    │  ← provenance tag
└────────────────────────────────────────────── ┘

Role ladder:  Steward ▸ Supervisor ▸ Coordinator/Planner ▸ workers
```

## 7. SAFETY RAILS + FAILURE MODES + OBSERVABILITY

**Rails (priority):** (1) server-enforced proof, not LLM trust; (2) `override_accept` confidence-gated + rate-limited (default DEFER; cap/hr); (3) hallucinated-resolve detection (verdict vs store); (4) fail-open-to-human on death/supersede/pause; (5) thrash guard via `stewardAttempts` (>K → escalate systemic); (6) full audit (`recordSupervisorAudit` `steward_*` + proof + escalationId).

**Failure modes:** crash mid-triage → un-flipped escalations re-polled idempotently; write race → last-write-wins + per-role fence; loop on un-actionable → `stewardAttempts` cap; proof stale between judge and act → handler re-validates at act time.

**Observability (loud panel):** queue depth/age; auto-action feed *with proof*; deferred count; **override-accept count this session (the scary metric)**; liveness/epoch; one-click "everything the steward touched since I left."

## 8. TECHNICAL PLAN (summary)

- **Store** (`supervisor-store.ts`, mostly EDIT): `role` column + `PRIMARY KEY(role)` (additive migration + backfill); `role` param on the 4 identity fns; escalation `routedTo`/`operatorGated`/`proof`/`stewardAttempts` + extended kinds; `routeOf`; `setStewardPause`/`isStewardPaused`/`incrementStewardAttempts`.
- **MCP** (`setup.ts`): `register_steward`, `steward_pause`/`resume`/`pause_status`; proof gate + rate-limit + hallucinated-resolve on `reset_todo`/`override_accept_todo` under a steward epoch; `escalation_created` includes `routedTo`.
- **Routes**: `GET /api/supervisor/steward-identity`.
- **UI**: `StewardPanel.tsx`; `NeedsYouZone`/`escalationSelectors` provenance + override metric; `supervisorStore` poll.
- **Skill** (`skills/steward/SKILL.md`): register on entry; heartbeat each loop; proof-required ladder; tighten override + genuine-decision rules.
- **Gate the entire auto-act path behind `MERMAID_STEWARD_AUTO` (default OFF).**

**Phased build:** P0 skill-only (zero schema) → P1 role+routing migration → P2 server proof gate → P3 UI → P4 reclaim+liveness. (See the plan doc.)

## 9. WHY OVER ALTERNATIVES + TOP RISKS

Minimal-flag is the only concept right-sized for local-first single-user and matches the real seams (role column on the existing identity, `routeOf` at `createEscalation`, the `escalation_created` broadcast, escalations-as-queue, skill-as-daemon → no spawner). Phase 0 ships a genuine steward day one with zero schema.

**Top risks:** (1) the `id=1 CHECK`→`PRIMARY KEY(role)` widening — mitigated by additive migration + backfill + `MERMAID_STEWARD_AUTO` default-off; (2) proof only as strong as its predicates — server-executed (`git`/`tsc`/store), never LLM-asserted, re-validated at act time; (3) `override_accept` blast radius — default DEFER + dual-proof + rate limit + loud counter + `reset_todo` undo, shipped last; (4) silent rot while away — fail-open-to-human + "steward dead, N queued" + "everything touched since I left."
