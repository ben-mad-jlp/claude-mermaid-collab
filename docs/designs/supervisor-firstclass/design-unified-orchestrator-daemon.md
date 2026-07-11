# Unified Orchestrator Daemon — one always-on daemon, a per-project autonomy ladder, Grok for judgment

> **Status:** design (proposed). Local-first, single-user. **Supersedes** decision `eb3c3e60` (Coordinator/Supervisor as separate *processes*) — the mechanical/judgment split survives as *passes within one daemon*, not separate processes/sessions.
> **Retires** the **Steward** role entirely and the **Supervisor** as a long-lived Claude Code session.
> Reviewed with Grok (skeptical principal-engineer framing); synthesis recorded in §9.

## 1. Problem / motivation

Today three "above-the-worker" roles exist with three different lifecycles:

- **Coordinator** — deterministic, per-project, **already a server-side daemon**. Claims `ready` work-graph todos → spawns ephemeral Claude Code worker sessions (tmux) → runs the acceptance gate.
- **Supervisor** — a long-lived **Claude Code session** that reconciles supervised sessions (nudges idle ones with ready work) and escalates decisions to the human.
- **Steward** — a long-lived **Claude Code session** (meta-role) that drains the escalation queue: triages each escalation into `{stale, verified-done, now-buildable, genuine-decision, needs-design}` and acts via steward verbs (`reset_todo`, `override_accept_todo`, `await_human_decision`) behind a server-side **proof gate**.

The Supervisor and Steward being **long-lived LLM sessions** is the source of an entire class of operational pain we have repeatedly fought: tmux **bare-shell** spawns, heartbeats, epoch fences, remote-control, watchdogs, session liveness. A stateless judgment call over HTTP has none of that.

**Thesis:** collapse all three into **one always-on server-side daemon** with a single **per-project autonomy ladder**. The Coordinator becomes the deterministic *floor* of that ladder; the ex-Steward triage and the Supervisor reconcile become *passes* in the same daemon; the irreducible judgment is a **Grok (xAI) API call with a read-only tool-loop** — never a spawned session. Workers remain the only spawned Claude Code sessions.

## 2. The model: one daemon, one per-project dial

A single always-on daemon (the **Orchestrator**). Each tick it iterates registered projects and, per project, runs only the passes that project's **level** enables:

| Level | What the daemon does for that project | LLM? |
|---|---|---|
| **off** | ignores the project | — |
| **build** | **Coordinator pass**: claim `ready` todos → spawn workers → run gate. Every escalation → human. No nudging, no LLM. | no |
| **nudge** | build **+ deterministic reconcile**: nudge idle sessions that have ready work; auto-close the *safe* buckets (`stale`, gate-verified `done`). | no |
| **propose** | nudge **+ Grok classifies** the judgment buckets and **suggests** verbs into the human-gated inbox; the human confirms. Nothing acts autonomously. | Grok |
| **consult** | propose **+ auto-resolves the *confident* buckets** via the steward verbs (behind the proof gate); only genuine `decision` / `needs-design` (and anything uncertain) reach the human. | Grok |

Ascending: **off → build → nudge → propose → consult**. Set **per project**, served by **one daemon process**.

- **Coordinator is the `build` floor** — still 100% deterministic, just hosted in the unified tick instead of a separate construct. (Same per-project on/off the Bridge already exposes, folded into the ladder.)
- **Steward is gone.** Its triage taxonomy survives as the `propose`/`consult` passes; its verbs + proof gate are reused by the daemon.
- **Supervisor session is gone.** Its reconcile/nudge survives as the `nudge` pass.

### Accepted coupling
`build` is the floor, so "triage a project I'm *not* building" is not its own level — you'd leave such a project at `nudge` (or `build` with decisions to you). For single-user this is fine. If decoupled build-vs-judgment is ever needed, the ladder splits into two per-project axes (`build: on/off` × `autonomy: off/nudge/propose/consult`); we start with the single ladder.

## 3. Roles → passes (what runs, deterministically vs Grok)

| Pass | Scope | Determinism | Replaces |
|---|---|---|---|
| **Build** (claim/spawn/gate) | per-project | deterministic | Coordinator (unchanged logic) |
| **Reconcile** (nudge idle w/ work; close safe buckets) | per-project | deterministic | Supervisor session's loop |
| **Triage** (classify + resolve/escalate) | per-project escalation queue | Grok judgment, daemon-executed verbs | Steward session |

Workers (per-todo execution) remain ephemeral Claude Code sessions spawned by the Build pass — unchanged.

## 4. Grok integration — tool-loop, not a frozen packet

The biggest risk (Grok's #1, §9) is that a single-shot call fed one serialized packet is **context-starved** vs a session agent that could grep/read/run-the-gate. Mitigation: **give Grok read-only tools inside the daemon** and let it investigate; the **daemon executes** the tool calls and the final verb.

- **Read-only tools exposed to Grok:** `get_todo(id)`, `deps_status(id)`, `is_merged(branch)`, `gate_clean(project)`, `recent_audit(project)`, `get_escalation(id)`, `list_linked_todos(reqId)`. (All already exist as deterministic server functions.)
- **Grok returns a structured verdict** `{ bucket, confidence, verb?, args?, rationale, provenance }` — it never calls a mutating verb directly.
- **The daemon executes** the verb (`reset_todo` / `override_accept_todo` / `await_human_decision` / surface-to-inbox).
- **The proof gate still re-validates the act** server-side (HEAD..master == 0 / tsc-clean / grep / dep-done). A no-proof act is rejected and re-routed to the human — unchanged.
- **Fail-open on uncertainty:** the proof gate validates the *act*, not the *classification* (Grok's #2). So any verdict below a confidence threshold, or any `decision`/`needs-design`, goes to the human — the daemon never auto-resolves a low-confidence classification.

## 5. Bucket taxonomy — deterministic vs judgment

| Bucket | Decided by | At `nudge` | At `consult` |
|---|---|---|---|
| `stale` (time + liveness) | deterministic | auto-close | auto-close |
| `verified-done` (gate-backed, clear done marker) | deterministic | auto-close | auto-close |
| `now-buildable` | deterministic **iff** deps/gate tracking is strong; else Grok | surface | propose→resolve if confident, else → human |
| `genuine-decision` | Grok classifies → **human** | → human | → human |
| `needs-design` | Grok classifies → **human** | → human | → human |

**North star (Grok's best simplification):** strengthen the work-graph/gate model so the deterministic buckets *stay* deterministic. Grok is the exception, not the workhorse — every escalation it has to judge is a hint the explicit model is missing a rule.

## 6. What stays human

- **Planning** is human-initiated. The daemon never authors roadmaps/plans. (The Planner role/skill is unchanged; `propose`/`consult` surface *decisions for* planning, they don't plan.)
- **Genuine design decisions** and `needs-design` always reach the human, at every level.
- **Confirmation at `propose`** — the default recommended level — nothing acts without the human clicking confirm (reuses the Cartographer/RequirementsInbox human-gated proposal surface).

## 7. Single daemon, per-project config, scheduling

- **One daemon**, started with the server; survives `/clear` (it is not a session).
- **Per-project config**: `{ level: 'off'|'build'|'nudge'|'propose'|'consult' }` persisted alongside the existing per-project coordinator/watch config (the unified project list).
- **Tick**: for each registered project, run the enabled passes for its level. Build/reconcile are cheap + deterministic; Grok triage only fires at `propose`/`consult` AND only when the deterministic pre-filter produced an undecided escalation (so quiet projects cost zero LLM).
- **Cost control**: rate-limit autonomous resolutions per project per tick; Grok only on undecided escalations; "quiet by default."

## 8. UI

- The per-project **ladder** replaces: the Bridge coordinator on/off pill, the steward off/auto/dogfood slider, and the supervisor on/off. One control per project (a 5-stop segmented slider `off · build · nudge · propose · consult`), shown on the project's Bridge row.
- The global Steward/Supervisor cards are retired. A single **daemon health** indicator (always-on) replaces the role cards.
- `propose` verdicts land in the existing human-gated inbox (ghost rows), same pattern as the Cartographer.

## 9. Grok consult — synthesis (ACCEPT / TEMPER / DISCOUNT)

Grok reviewed the proposal skeptically. Verdicts:

1. **"Context packet is a severe downgrade vs an agentic session."** — **TEMPER.** True *only* for a frozen one-shot. Mitigated by the **read-only tool-loop** (§4): Grok investigates, daemon executes. Recovers most agency without a session.
2. **"Proof gate validates the *act*, not the *classification*; plausible-but-wrong triage slips through."** — **ACCEPT (load-bearing).** → **fail-open on uncertainty** + the **`propose` level** (human confirms) as the default. `consult` only auto-resolves high-confidence deterministic-adjacent buckets.
3. **"Collapsing Steward+Supervisor loses two different error domains."** — **DISCOUNT for single-user**, but **keep the point**: they survive as **distinct passes** (reconcile vs triage) in one daemon — different code paths, shared dial. Not one blurred responsibility.
4. **"`consult` looks autonomous → attention decay."** — **ACCEPT.** The missing intermediate is exactly **`propose`**. Guardrails on `consult`: rate limits + a periodic "what did I auto-resolve" review surface.
5. **Grok's simpler alternatives** — **ACCEPT as direction**: (a) make the work-graph strong enough that most triage is deterministic (our north star §5); (b) a *local non-session* tool-loop for triage (that *is* Grok-with-tools-in-daemon); (c) start with propose-only / surface-don't-resolve (that *is* the `propose` default).

Net: the review did not refute the direction; it produced the **4th level (`propose`)**, the **tool-loop**, and **fail-open** — all folded in above.

## 10. Top risks + mitigations

1. **Misclassification of `now-buildable` vs `needs-design`** (the act-not-classification gap). → fail-open on uncertainty; `propose` default; proof gate on the act; strengthen deterministic rules so fewer cases reach Grok.
2. **Context packer quality** — a weak context loses nuance. → tool-loop (Grok pulls what it needs) + structured, not summarized, inputs.
3. **Silent autonomy / attention decay at `consult`.** → rate-limit autonomous resolutions; periodic human review surface; `propose` as the recommended default.
4. **Model distribution shift** (Grok judging work produced by Claude workers). → keep judgment narrow (only the genuine-decision boundary); everything structural stays deterministic.
5. **Daemon = single point** for build + reconcile + triage. → passes are isolated; a triage failure must never block the deterministic Build/Reconcile passes (fail-open to human, keep building).

## 11. Phased plan

- **Phase 1 — Unify the shell (no Grok).** One daemon loop + per-project `level` config + the 5-stop UI slider. Map `build` → today's Coordinator pass; `nudge` → port the Supervisor reconcile loop into a deterministic pass. **Retire the Steward + Supervisor sessions** (and their spawn/heartbeat/epoch machinery). Escalations at `build`/`nudge` all → human. Deterministic buckets (`stale`, `verified-done`) auto-close at `nudge`.
- **Phase 2 — `propose` (Grok-in-the-loop, human-gated).** Grok classifier with the read-only tool-loop; verdicts surfaced as ghost proposals in the inbox; human confirms; daemon executes confirmed verbs behind the proof gate.
- **Phase 3 — `consult` (bounded autonomy).** Auto-resolve high-confidence buckets; fail-open on uncertainty; rate limits + the auto-resolution review surface.
- **Phase 4 — North-star hardening.** Push triage cases back into deterministic work-graph/gate rules; measure how often Grok is actually needed; shrink the judgment surface.

## 12. Open questions

1. Should `nudge` **auto-close** the safe buckets (`stale`, `verified-done`) or only **surface** them? (Leaning auto-close for `stale`, surface-then-confirm for `verified-done` until trust is established.)
2. Single ascending ladder vs two axes (`build` × `autonomy`)? (Start single; split only if a real need appears.)
3. Grok model/cost at "always on" — budget per project per tick; cache verdicts by (escalation, todo-revision) so re-ticks don't re-spend.
4. Naming: "Orchestrator" (absorbs Coordinator+Supervisor+Steward) vs keeping "Supervisor". (Leaning **Orchestrator** since "Supervisor" is now overloaded.)
5. Decision record to file + memory updates: retire `project_build_time_steward_role` framing for the *runtime* steward; supersede `eb3c3e60`.
