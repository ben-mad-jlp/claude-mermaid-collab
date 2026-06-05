# mermaid-collab — Roadmap

> Snapshot of the collab work-graph, exported 2026-06-05. The **authoritative** source is the live work-graph (`.collab/todos.db`, served by the collab UI); this is a committable, human-readable mirror. Regenerate when the plan changes materially.

## Guiding principles & roles (active decisions)

- **Build-time Steward** (`20106f26`) — a first-class meta-role *above* PCS: it runs real work *through* the system, observes friction, and fixes-now or files. Not a PCS role; don't frame a working session as "the supervisor."
- **Deterministic-daemon-first** (`eb3c3e60`) — mechanical/computable work runs as deterministic server **daemons** (no context, no token cost, testable); the **LLM** is reserved for irreducible judgment (writing code, planning with the human, escalate-or-not). Coordinator & Supervisor stay **separate**: the supervisor's mechanical loop becomes a daemon, with an on-demand LLM session for the escalate-this-stop-or-not decision.
- **Canonical vocabulary** (`45a0d906`) — **workspace** (durable namespace) vs **session** (live runtime); **pool → slot → worker**; **type** is the routing key; **profile** is the composed identity (distinct from type).
- **Every work todo belongs to an epic** (`373a2d52`, constraint, active) — epics are roots; no floating top-level work todos; an Inbox epic is the capture default.
- **collab stays domain-agnostic** (`cf58d76a`) — domains (bsync/build123d) plug in via a per-project manifest + a Coordinator-side gate.
- **Supervisor failover = epoch fence, not hot standby** (`be762c9c`).

Status legend: **ready** (claimable) · **planned** (scoped, gated) · **todo** · **blocked** · **in_progress**.

---

## EPIC: Architecture hardening (`34a22538`) — in_progress
From the architecture review (`review-collab-architecture`). The structural + code-debt work.

| Todo | Status | Pri | Notes |
|---|---|---|---|
| Worktree isolation — integration-branch recombination (`40d38438`) | ready | 1 | **LINCHPIN.** Shared tree causes cross-lane gate contamination + committed-history divergence. Gates the setup.ts refactor + safe parallelism. |
| Supervisor ownership fence (epoch) (`2dd13c65`) | ready | 1 | Server-enforced; prevents split-brain on respawn. |
| Watchdog daemon ↔ supervisor decision handoff (`b76f7869`) | ready | 1 | dep: `2dd13c65`. Durable decision queue; daemon acts, LLM only judges. |
| Coordinator self-liveness (`1cb49878`) | ready | 1 | Heartbeat the tick loop; detect/restart a wedged coordinator. |
| MCP artifact writes don't broadcast → UI no live-refresh (`8a838986`) | ready | 1 | BUG. Emit WS events from the shared tool fns (DRY). |
| setup.ts → handler registry (`6066b12a`) | ready | 2 | dep: `40d38438`. Kill the 2,200-line tool switch; derive ListTools from a registry. |
| Unified session-runtime read model (`86799634`) | ready | 2 | One join over the 3 stores; stop cross-store liveness stitching. |
| One-command deploy script + sidecar-dies-with-app (`d0d59599`) | ready | 2 | Fixes the detached-sidecar footgun + verified deploy. |
| Enforce 'every work todo has an epic' (`c0cecc3e`) | ready | 2 | Declared epic kind + Inbox default + add_session_todo guard. |
| Planning-reconciliation spike (`a3f2c930`) | todo | 1 | Harness built; needs real-run validation. |
| ConnectionStore durable persistence (`7d031efb`) | todo | — | Await a final flush on before-quit. |
| Reuse FleetGraph for the Implementing task view (`38669eb7`) | planned | 2 | One graph, not two. |

## EPIC: CAD dogfood & bsync seam (`d61c73de`) — in_progress
build123d integration: verification, prep, and the collab↔bsync session-model seam. Many target `build123d-ocp-mcp`.

| Todo | Status | Pri | Notes |
|---|---|---|---|
| Deterministic CAD gate-runner (`cfde885f`) | ready | 1 | Authoritative verdict, not agent self-report. |
| Stable per-(project,session,todo) bsync session_id (`7ef13930`) | ready | 1 | #1 blocker for parallel CAD; stomp fix. |
| Binary artifact (STEP/PNG) gate + review path (`49352848`) | ready | 1 | dep: `28d016aa`. Text-diff gate can't see CAD deliverables. |
| DfM analyzers (wall/draft/undercut/min-feature) (`eab5f87c`) | ready | 2 | deps: `b5dcce4e`, `56e4969d`. |
| Viewer wsPort reconcile + STEP multi-instance quirk (`32125394`) | ready | 2 | dep: `b5dcce4e`. Papercuts. |
| Pin/refresh bsync session vs idle-GC (`00ff43f2`) | blocked | 2 | deps: `b5dcce4e`, `7ef13930`. |
| sweep-collision analyzer (motion envelope) (`61f06bde`) | todo | — | dep: `56e4969d`. |
| cad/ocp agent profile carrying bsync context (`1eb8095d`) | planned | 2 | Cold-start context + tool allowlist. |
| Machine-checkable interface contract (`69dff093`) | planned | 2 | The contract schema the gate-runner validates. |

## EPIC: Vocabulary unification (`1f75ebe9`) — planned
Adopt the canonical terms (`spec-canonical-vocabulary`, decision `45a0d906`).

| Todo | Status | Pri | Notes |
|---|---|---|---|
| Unify routing key: type = pool-type (`b3b81bdb`) | ready | 1 | **Prereq for the Profiles epic.** |
| Pool / Slot / Worker — retire lane + pool session (`3db13225`) | ready | 2 | Internal rename. |
| Vocabulary lint (`5f9aefde`) | ready | 2 | Fail CI on retired synonyms. |
| session → workspace migration (`142824b0`) | planned | 2 | Needs a migration design first (persisted paths + public API). |

## EPIC: Composable agent-profile taxonomy (`5f6ab046`) — planned
Capability × tech-packs × project-context (`e8fddf63`, `5a7af2f2`).

| Todo | Status | Pri | Notes |
|---|---|---|---|
| L1 Capability layer (`fe016a6f`) | ready | 2 | dep: `b3b81bdb` (type-unify). |
| L2 Tech-pack library (`925db497`) | ready | 2 | dep: `b3b81bdb`. |
| L3 Compose-at-launch (`daff4708`) | planned | 2 | deps: L1, L2. |
| L4 Auto-proposer (`fd052733`) | planned | 2 | dep: L3. |

## EPIC: #7 Fitness gate (`7fc8bac5`) — in_progress
HEADLINE FINDING: the pipeline verifies CORRECTNESS, not FITNESS. The judgment-layer bookends.

| Todo | Status | Pri | Notes |
|---|---|---|---|
| #7a CAD design-exploration stage (`c7221332`) | ready | 1 | diverge→judge→synthesize the design → contract. |
| #7b Fitness/design-review gate (`8f92621f`) | ready | 1 | A judgment gate; the judge SEES the render. |

---

## Cross-cutting dependency notes

- **`40d38438` (worktree isolation) is the linchpin** — it gates `6066b12a` (setup.ts) and is the precondition for raising the backend pool above 1 (safe parallelism) and for merge-integrity.
- **`b3b81bdb` (type-unify) gates Profiles L1/L2** — vocabulary before the taxonomy builds on it.
- **`2dd13c65` (epoch fence) gates `b76f7869`** (decision handoff).
- Several CAD/SEAM items depend on `b5dcce4e` (target-repo seam) and `28d016aa` (render verb) in `build123d-ocp-mcp`.

## Key design docs (in the collab work-graph)

`review-collab-architecture` · `design-collab-system-overview` · `glossary-collab-terms` · `spec-canonical-vocabulary` · `design-supervisor-failover` · `design-watchdog-daemon-decision-handoff` · `design-setup-ts-registry` · `design-session-runtime-read-model` · `design-deploy-script`.
