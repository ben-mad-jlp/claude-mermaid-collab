# Grok Consult — PCS Direction + Overall Structure

Three consults (model grok-4.20-reasoning), skeptical-reviewer framing. Verbatim takeaways + my (Claude) synthesis weighing them against this product's actual context (local-first, largely single-user dev tool where "watch Claude code in tmux" is core value — NOT a multi-tenant SaaS).

## Consult 1 — PCS orchestration redesign

Grok's core thesis: **the design is over-abstracted and makes orchestration itself LLM-native, which is the root mistake.** Ranked risks:

1. **Cross-machine claim:** per-project SQLite CAS does NOT prevent double-claim across federated machines. (Risk #1.)
2. **Stale plan-level approval:** coordinator confidently builds on a falsified roadmap → "impressive-looking wasted work."
3. **Control plane built on the thing it controls:** tmux fire-and-forget nudges + event+tick = recursive fragility.
4. **Role drift:** Supervisor vs Coordinator are near-identical watch-loops that drift.
5. **Cost:** resident idle LLM per project indefensible past a few projects.
6. **Todo overloading:** human checklist vs work-graph are different things.

Grok's alt: deterministic central service + real DB + **non-LLM executor daemon**; LLMs only for actual work; Supervisor logic = code + rules + escalation UI; keep tmux for WORKERS but not as control plane; System Map = real UI from the service.

## Consult 2 — Overall product structure

Weak points (by breakage): single Bun process; tmux+keystroke+PID control plane; per-project SQLite fragmentation; Electron sidecar lifecycle/env; "federation" = loose coupling with hope.
Missing: secrets mgmt; authN/Z beyond one shared token; schema migrations; observability/tracing; crash recovery/reconciliation; multi-user concurrency; backpressure on ~200 MCP tools; backup/export/tenancy.
Secrets+config bugs = symptoms of an absent config/secrets/lifecycle architecture (not one-offs). Right layer: OS keychain + config service with precedence + Settings UI + server decoupled from Electron.
Federation: per-peer SQLite truth + unauth proxy = divergence, split-brain, security hole. Blockers ranked; foundation must change before orchestration redesign.

## Consult 3 — Planning concurrency (multiple topics per project, one Planner)

My proposal challenged: separate unit-of-truth (plan graph) from unit-of-conversation; stateless thread-scoped planner seeded per-pass; epics=parentId threads.

Grok's verdict: **over-engineered; the graph cannot be the LLM's memory substrate (category error).** Key points:

- Stateless per-pass re-seeding just relocates the summarization problem and **loses cross-thread memory** → locally coherent epics that globally diverge.
- **Cross-epic semantic divergence is the largest failure mode.** Needs explicit mechanism: first-class **decision records + active constraints** as graph nodes that every pass reads + updates.
- Single-writer + versioning is NOT enough — the race is **semantic** (A builds on "Y done", B changes Y's approach; serialized writes store an invalid edge). Need a **reconciliation pass** (LLM seeded with both subtrees + constraints → merged graph), CRDT-style commutative ops + reconciliation, not just audit logs.
- Stateless threads = reinventing N transcripts; "working context" (the why) lives in the transcript, not the graph. Admit transcripts are primary, graph is derived index.
- Simpler model: **one resident planner + linear transcript**, mandatory graph checkpoint + constraint list each turn, `/focus <epic>` swaps prompt slice + pulls relevant subgraph + recent decisions, aggressive summarization at token thresholds → updated constraints + epic summaries. Or: Planner as a "project IDE" (epics=documents), LLM invoked in "edit epic + propose graph deltas" mode with retrieval context.
- Biggest risk: semantic divergence across epics. **Cheapest de-risk: build the reconciliation pass FIRST as a standalone function, run on 5 real concurrent workflows, before any multi-thread PlannerView UI.**

---

## My (Claude) synthesis — what to ACCEPT, TEMPER, DISCOUNT

**ACCEPT (change the plan):**

- **Non-LLM Coordinator + deterministic Supervisor core** (consult 1) — kills cost/role-drift/tmux-control-plane/idle-LLM at once. Workers stay LLM in tmux.
- **Bound approval staleness** — re-validate on worker material-change + version the plan (consult 1).
- **Config/secrets is a real architectural gap** (consult 2) — config service + keychain + Settings UI; decouple server from Electron. Next major work.
- **Narrative is primary memory; graph holds structure+status only** (consult 3). Don't make the graph the planner's memory.
- **One resident Planner +** **`/focus`, decision-records + constraints as nodes, aggressive summarization** (consult 3). Drop the "stateless thread-scoped planner" — it was wrong.
- **Reconciliation pass for true-parallel editing; build + test it FIRST** (consult 3).

**TEMPER (valid, but Grok assumed SaaS scale):**

- Cross-machine claim → single-writer-per-project routing makes local CAS sufficient; no Postgres/etcd.
- Todo overloading → one store + work-graph/claim columns + UI locking.
- Single Bun process → fine at this N; harden crash-recovery rather than split.
- Reconciliation pass → required for true-parallel, **deferred for solo context-switching** (resident planner + `/focus` + decision-records suffices there).

**DISCOUNT (multi-tenant SaaS, not now):**

- Multi-user authZ/ACLs, tenancy, Postgres, OTel, backups-as-blocker. Note; graduate only if hosted/multi-user.
- "tmux/register_claude_session is theater" overstated for single-user; the narrow valid point is: don't use tmux nudges as the *orchestration control plane*.

**Net:** orchestration brains → deterministic server code; LLMs where judgment lives (planning with human + the work); planner is one narrative session with topic-focus + summarized decision/constraint records; graph is the structural index; reconciliation pass is the concurrency keystone to prototype first. Foundation (config/secrets + single-writer routing + claim CAS) before the rest.
