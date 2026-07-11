# Bake-off: System Object primitive — A (unified) vs B (orthogonal)

Brainstorm artifact. No todos, no code. Judges the two design docs:
`design-A-unified-tree` and `design-B-orthogonal-trees`, both grounded in `research-system-object-model`.

## The single fork both designs agree on
There are two kinds of fact in play:
- **Durable / revisioned** — *the thing we're building* (a part, an Axis, a UI module): a spec, attributes, artifacts, a design/review lifecycle, a revision history that must survive for years.
- **Ephemeral / leased** — *the work*: a todo that is claimed, leased, retried, PID-watchdog'd, released. Born and dies inside one build cycle.

Both agents independently concluded: **these must not be the same row that gets reborn every cycle.** They differ only on *where the seam goes.*

| | A — Unified tree | B — Orthogonal trees |
|---|---|---|
| Structure | One `SystemNode` store; `Todo` absorbed | Two stores: `SystemObject` + today's `Todo`, untouched |
| Ephemeral work | Nullable `WorkFacet` sub-object on the node | Separate `Todo`, FK `systemObjectId` |
| Seam mechanism | "WorkFacet firewall" (null except mid-build) | "back-ref is a query, not a stored array" |
| Kills its own #1 risk by… | one id space → no drift | no stored back-ref → nothing to sync |
| Biggest weakness | stale lease dirties a durable node; firewall is a stateful invariant that can rot under concurrency | FKs rot (orphan/dangle on delete/split/merge); status spans two stores |

## Verdict: **B (orthogonal) is the spine — with two grafts from A.**

Why B wins as the primary:
1. **It changes almost nothing that already works.** `todo-store`, epic roll-up, the Planner promotion gate, agent-profile routing, the acceptance gate, the PID watchdog — all stay as-is. The cost is *one nullable FK column* (`Todo.systemObjectId`), mirroring the existing `link`/`blueprintId`/`targetProject` pattern. A asks us to migrate the work-graph onto a new node type; that's a large, risky refactor of the one subsystem currently load-bearing in production.
2. **Blast-radius containment is real, not hypothetical.** A crashed/stale lease is a thing that *actually happens here* (there's a PID-liveness watchdog precisely because of it). B keeps that churn in a disposable store; a durable revisioned part is never in the lease's blast radius. A's "firewall" is plausible but it's exactly the kind of "this field must be null except when…" invariant that fails under concurrency — the highest-risk part of A's own argument.
3. **A's best idea is portable; B's is not.** A's strongest move — *don't store a back-reference array, derive "which todos touch X" as a query* — was independently adopted by B and is the thing that defuses the "sync nightmare." So B already captured A's key insight. A's *remaining* differentiator (co-location in one store) is the part that carries the risk.

### Graft 1 — take A's lifecycle honesty
Model the SystemObject's **own** lifecycle (`designStatus` / `revision` / `reviewState`) as first-class and *fully distinct* from `TodoStatus`. Don't let work-status leak into the object. Both docs do this; make it explicit in the spec.

### Graft 2 — take A's composition grammar verbatim
Types as a **per-project-extensible registry** (the proven `agent-profiles` pattern: global + `.collab/project.json` merge), with `allowedChildTypes` as the composition grammar (Robot ⊃ Axis/Sensor; Axis ⊃ Motor/Encoder) and software types reusing the `api/ui/library` keys so an object's todo routes straight to the matching worker profile with **zero** mapping layer. Both agreed; it's the cheapest high-value piece.

## Resulting synthesized shape (for the next iteration)
- `SystemObject` store (new, per-project, bun:sqlite): `id, parentId, type, name, multiplicity, attributes, designStatus, revision, reviewState, links[] (satisfies/verifies/allocates), artifacts[]`. No claim/lease fields. No `workTodos[]` array.
- `Todo` unchanged + **one** nullable FK `systemObjectId`; epics carry `targetSystemObjectId` to name the subtree they build.
- Back-references are **derived queries**, never stored. One cross-boundary write only: work→object on completion (`onComplete`), one-directional, validated by the object store (the fact's owner).
- Types: registry w/ `allowedChildTypes`; software types = agent-profile keys.
- Multi-domain by construction: Robot subtree and SaaS subtree are the same primitive; the work-graph references both identically; BOM is derived by walking the subtree.

## What we did NOT decide (open, for human + next round)
1. **Instance vs type vs revision** — the 3-way split (reuse / where-used vs simplicity). Both flagged it; unresolved.
2. **BOM multiplicity truth** — 6 distinct Axis instances vs `multiplicity: 6` (eBOM vs mBOM).
3. **Constraint propagation semantics** down a subtree (inherit / override / must-satisfy).
4. **FK integrity policy** — soft-delete-to-obsolete, transactional FK-rewrite on split/merge (B's permanent maintenance surface).
5. **Tooling boundary** — ~~open~~ **largely answered by what already exists: bsync is the CAD integration.** `cad-gate-runner.ts` already consumes bsync analyzer metrics (validity, workspace volume, Jacobian condition number, DOF, min wall, min clearance, joint-axis directions) and turns them into a **deterministic, versioned, authoritative pass/fail verdict** (`CAD_GATE_THRESHOLDS_VERSION`) an agent cannot override; a VLM fitness judge (`cad-fitness-review`) runs after, advisory-only. This is exactly the research's "collab as digital-thread index/orchestrator that links OUT + a computable acceptance gate" model — already realized for CAD. Implication for the system-object design: a CAD-typed SystemObject's `reviewState`/`designStatus` has a *real acceptance oracle* (the bsync→gate-runner pipeline), not a hand-wave — the same lease→gate→release loop the worker already runs. Remaining sub-question: how the object's spec/contract thresholds (required DOF, envelope, distinct axes) are authored ON the SystemObject and fed to the gate.
6. **Skeptical external review still owed** — Grok leg failed: `~/.claude/settings.json` `env.XAI_API_KEY` (stale `...i7`) was injected into the MCP/server process and shadowed the good `...yk` in `~/.mermaid-collab/config.json` (env beats config.json). settings.json corrected to `...yk`; **server relaunch required** to pick it up (live process cached the bad key). A real adversarial pass on the synthesized shape is still unpurchased until then.
