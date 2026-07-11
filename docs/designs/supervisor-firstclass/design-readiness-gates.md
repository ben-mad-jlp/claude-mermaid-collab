# Design: First-Class Non-Code Gates (todo 220c08a7)

## Vision

A todo's claimability conflates two questions the work-graph treats as one: **"are my code-deps done?"** and **"is the world actually ready for me to run?"** The unblock pass (`todo-store.ts` L650-657) answers only the first, promotes to `ready`, the Coordinator claims it, the worker false-fails (it can't provision env or invent a design), and the steward hand-parks it back to `planned` — repeatedly (222f40ff, 1082a56f, 9fd5fce8). The park survives only because the unblock pass skips non-`blocked` rows — an implicit, undurable convention.

The fix is **not a new subsystem**. A non-code prerequisite is **a `assigneeKind='human'` gate-todo, under the human epic d3e2a341, that the work-todo `dependsOn`**. This is the only model that requires **zero change to the two readiness predicates**: `depSatisfied` (L601-604) already keys on `status==='done'` regardless of `assigneeKind`, so an open human dep keeps the dependent `blocked` (never deps-done, never promoted, never claimed, never false-failed), and completing the human gate-todo auto-flips the dependent to `ready` via the **existing** unblock pass on the same `completeTodo` tick. One readiness truth; the auto-promote bug is structurally impossible to reintroduce.

We graft two things onto this spine: (1) a **decision-record binding** so design/decision gates self-clear when the Planner approves a record (no manual flip), and (2) a **deferred, claim-filter-only liveness probe** for the one genuinely-mechanical case (yolox `:8082`). We explicitly drop a new `waiting`/`gated` status, a stored `gateClearedAt` bit, an `evalSpec` registry, and an async `listClaimableTodos` rewrite.

## The Model

A gate is a normal `Todo`:
- `assigneeKind: 'human'`, `parentId = d3e2a341` (human epic)
- `title` prefixed `[GATE] …` (convention — drives the "blocking what" view + any UI badge)
- `status: 'ready'` (a human gate-todo is actionable immediately; it has no code-deps of its own)

The gated work-todo gains a `dependsOn` edge to that gate-todo. **That edge is the gate.** Nothing else changes.

The two readiness chokepoints stay byte-for-byte identical:

```
listReadyTodos (L554-562):  status==='ready' ∧ assigneeKind==='agent' ∧ every depSatisfied
unblock pass   (L650-657):  status==='blocked' ∧ !rejected ∧ every depSatisfied → ready
```

A human gate-dep is `depSatisfied` only when the human marks it `done` (L603). So a work-todo with an open gate-dep has `depsDone === false` → stays `blocked`, never promoted (unblock pass), never returned by `listReadyTodos`, never claimed by the Coordinator, never false-fails. The instant the human marks the gate-todo `done`, the **next** `completeTodo` unblock pass sees all deps satisfied and auto-promotes `blocked → ready`. No re-parking, ever.

**Why no new status (rejecting Option C / `waiting`):** a `waiting` member duplicates `blocked`'s semantics ("approved but not actionable"), forces every reader — UI lanes, MCP allowed-status sets, planner-reconcile, `computeWaves` — to learn a second not-actionable state, and re-introduces a state the steward moves todos *into* by hand. The dep-edge keeps exactly one definition of "actionable." `blocked` with an open human dep already IS "deps-done-ish but not runnable," surfaced via a derived label.

**Why no stored cleared-bit (rejecting `gateClearedAt`):** a persisted bit can drift from world truth (non-monotonic). The human's done-stamp (already attributed via `completedBy = local:<hostname>`, L623-625) for human/design gates, and a re-derived probe for liveness, are both self-truthing.

## Lifecycle (set / surface / auto-clear)

1. **Set** — Planner/steward identifies a non-code prerequisite and calls `createGate(project, { workTodoId, title, description, gateKind? })`: creates the human gate-todo under d3e2a341 and appends its id to the work-todo's `dependsOn`. Pure composition of existing `createTodo` + `updateTodo`. No schema, no migration.
2. **Surface** — code-deps finish; the unblock pass runs but the work-todo's gate-dep is still open → it stays `blocked`. A reverse-edge view `listGatesBlocking(project)` / `listGatedBy(project, gateTodoId)` scans `dependsOn` to render *"[GATE] :8082 up + checkpoint staged — blocking: A2b, A4"* in the B3 human inbox the operator already watches. The Coordinator never claims it; the worker never false-fails.
3. **Auto-clear** — the operator does the real-world thing and marks the gate-todo `done` (one action in the inbox) — OR, for design/decision gates, approves a bound decision-record (see Integration). Either path runs `completeTodo` on the gate, which fires the **existing** unblock pass → the work-todo flips `blocked → ready` automatically → Coordinator claims it next tick. The steward never re-parks.

## The Three Worked Cases

**(a) yolox A2b — operator-env (`:8082` backend + trained checkpoint + sample images).** Create `[GATE] yolox :8082 up + checkpoint + sample images staged` (`gateKind='operator'`) under d3e2a341; A2b `dependsOn` it alongside its code-deps. When the code-deps land, A2b's gate-dep is still open → stays `blocked`. Operator brings the rig up, stages data, marks the gate `done` → A2b auto-promotes. **If `:8082` is flaky-at-claim-time** (provisioned once but the process may be down), *additionally* set the Phase-4 `claimGuard='http:8082/health'` so A2b is only claimed while the service actually answers — never re-parked on a flicker.

**(b) A4 — design-gated.** Create `[GATE] A4 navigation redesign landed` (`gateKind='design'`) bound to a decision-record id. Two clear paths: the human marks the gate done after the design lands, OR the Planner runs `approve_decision_record` (which already flips `proposed→active`) and a post-hook completes the bound gate-todo. Either way A4 stays `blocked` "waiting on design" — the worker never invents a design — then auto-promotes.

**(c) dataset/artifact-pinning — trained checkpoint hash / sample-image set.** Create `[GATE] checkpoint sha256:… + image set v3 pinned` (`gateKind='dataset'`) with the pinned ref in its `description` (or `objectRef` → SystemObject for a durable artifact). Operator stages and pins the artifact, marks the gate done. The pin is auditable because it's a real node. If the artifact is "pinned but may move," add a `claimGuard` instead of/in addition to the human gate.

## Integration

**Human-todo epic (d3e2a341).** Gate-todos *are* the human todos under it — no parallel collection. They inherit the claim-boundary exclusion (L559), cross-kind `depSatisfied`, the B3 inbox view, completion attribution (`completedBy`, L623-625), and epic roll-up for free. `gateKind` (an optional display-only flag, not read by any predicate) is just a sub-classification of "human todo."

**Steward routing (coordinator-daemon `escalateRejected`/`escalateExhausted`, L42/L86/L148).** Today these `reset_todo`-re-park to `planned` and ping the human — per incident, forever. New behavior: when the escalation is classified operator-gated / needs-design, call `createGate(...)` **once** (create the gate-todo + dep edge) instead of re-parking. The retry/false-fail loop is then structurally prevented (the dependent has an unsatisfied human dep), and the gate self-clears. A recurring manual chore collapses to a one-time graph edit. `escalate*` keep firing for *genuine* failures; a properly-gated todo never reaches them because it's never claimed.

**Decision-records (`proposed→active`).** For `gateKind ∈ {design, decision}`, the gate-todo carries a `decisionRef` (a thin field, or recorded in `description`). In `approveDecisionRecord` (decision-record-store.ts L180), after marking the record `active`, complete any gate-todo bound to it via `completeTodo(project, gateTodoId, 'accepted')` — which runs the same unblock pass. "Design landed / human decided" thus flows through the identical promotion machinery; no third mechanism, and it removes the one weak auto-clear (human-remembers-to-flip) for the design case. Wire as a thin `decisionRef` on the gate-todo + a post-hook, **not** a parallel `gatedBy` axis on the work-todo.

## Technical Plan

**Reuse (no change):** `dependsOn`, `depSatisfied` (L601-604), the unblock pass (L650-657), `listReadyTodos` (L554-562), `claimTodo` (L440), `computeWaves`, the human epic + B3 inbox, attribution (L623-625), decision-record `proposed→active` + `approveDecisionRecord`.

### Phase 1 — convention + surfacing (ship first; no schema, no migration)
- `createGate(project, { workTodoId, title, description, gateKind? })` in `todo-store.ts` — `createTodo` (assigneeKind='human', parentId=d3e2a341, status='ready', `[GATE]` title) then `updateTodo(workTodoId, { dependsOn: [...existing, gateId] })`; ensure the work-todo is `blocked`.
- `listGatesBlocking(project)` and `listGatedBy(project, gateTodoId)` — reverse-edge scans over `dependsOn` for "blocking what" / "waiting on you".
- **Tests** (extend `todo-store` suite): gate-dep holds dependent `blocked` (deps-done-on-code-only but human gate open); completing the gate auto-promotes the dependent on the same `completeTodo` (assert `.promoted` includes it, assert **no `reset_todo` needed**); a gate-todo is excluded from `listReadyTodos`; reverse-edge views return correct pairs; regression: a plain agent-only-dep todo still goes `blocked → ready` directly.

**Phase 1 alone ends the re-park loop for operator/design/dataset gates** — pure composition, zero migration, lowest risk.

### Phase 2 — decision-record → gate-todo auto-complete binding
- Thin `decisionRef: string | null` on the gate-todo (`addColumnIfMissing(db, 'todos', 'decisionRef', 'decisionRef TEXT')`, pattern L208-225; thread through row-mapper L262, INSERT L337-348, UPDATE L405-413, `CreateTodoInput`/`UpdateTodoPatch`). Nullable → backfills null → no behavior change for existing rows.
- Post-hook in `approveDecisionRecord` (decision-record-store.ts L180): after `active`, find gate-todos with `decisionRef === recordId` and `completeTodo(project, id, 'accepted')`.
- **Tests** (extend `decision-record-store` suite): approving a bound record completes the gate-todo and auto-promotes its design-gated dependent in the same call.

### Phase 3 — steward routing
- In `escalateRejected`/`escalateExhausted` (coordinator-daemon.ts L42/L86/L148): on operator-gated/needs-design classification, call `createGate(...)` once instead of `reset_todo` re-park.
- Optional display-only `gateKind: 'operator'|'design'|'dataset'|null` flag + UI badge in the human inbox.
- **Tests:** a gated rejection produces a gate-todo + dep edge, the dependent is `blocked` (not re-claimed), and `reset_todo` is never called.

### Phase 4 — claim-filter-only liveness probe (DEFER until a real flaky service appears)
- Nullable `claimGuard: string | null` on `Todo` (`addColumnIfMissing`, same pattern). Names a probe, e.g. `http:8082/health`, `mcp:build123d`.
- One line in `listReadyTodos` **after** L560: `if (t.claimGuard && !probeOk(t.claimGuard)) return false;` — **FILTERS, never mutates status/retryCount**. Re-derived every tick.
- `probeOk(key)` in a new ~30-line `gate-probes.ts`: `http:HOST/PATH` cached health-check, `mcp:NAME` connection check. **Unknown key → true (fail-open)** so a typo never wedges work.
- **Tests** (extend `worker-pool`/coordinator harness with a stub probe): a `claimGuard` todo is `ready` but absent from `listReadyTodos` while probe=false, present when true; a false→true→false flip never changes status or retryCount.

**Migration safety:** Phases 2 and 4 each add one nullable column via the existing idempotent `addColumnIfMissing`; backfill = null = inert. Phase 1 adds no column. Existing tests pass unchanged.

## Why Over Alternatives

- **vs. `gated`/`waiting` status (runnable-substate):** dropped — duplicates `blocked`, forces every status reader/UI/MCP/planner/`computeWaves` to learn a new state, re-introduces a hand-managed state, and changes the unblock pass (adds a second symmetric re-pass). Highest blast radius, least gain. The open human dep already holds `blocked` for free.
- **vs. `gateKind` predicate column + `gateClearedAt` (readiness-kind-field):** dropped the stored cleared-bit — it drifts from world truth and must be enforced at BOTH chokepoints (a missed seam re-promotes). We keep `gateKind` only as a display flag read by no predicate.
- **vs. `gatedBy` decision-record predicate + `evalSpec` registry (decision-record-dep):** we graft its best idea (gate IS an approved decision) as a thin `decisionRef` binding, but reject a second readiness axis on the work-todo and the `evalSpec` spec-eval registry as too much new surface for single-user local-first.
- **vs. async `listClaimableTodos` rewrite (readiness-predicate):** we adopt its best idea (re-derive liveness every tick, no stored bit) but as a thin **sync** claim-filter line, not a rewrite of the sync claim path.

The grafted design adds **zero new readiness logic** — gating falls entirely out of the existing `dependsOn`/`depSatisfied`/unblock-pass triad, so it provably cannot reintroduce the auto-promote bug. The only new code is creation ergonomics, surfacing, a decision-record bridge, and a deferred filter-only probe.

## Top Risks

1. **Modeling discipline** — Phase 1 relies on the Planner/steward actually creating the gate edge. Mitigation: Phase 3 makes the steward do it automatically on escalation, so the human isn't the single point of failure.
2. **Stale gate-todos** — a gate-todo whose work-todo is dropped lingers in the human inbox. Mitigation: the `listGatedBy` reverse view surfaces orphans (gate blocking nothing); cheap to GC.
3. **decisionRef drift** — a gate bound to a superseded record never auto-completes. Mitigation: treat `superseded` like `active` in the post-hook, or let the human mark the gate done (the fallback path always works).
4. **Probe fail-open masking a real outage (Phase 4)** — an unknown/typo'd `claimGuard` claims against a dead service. Mitigation: fail-open is deliberate (never wedge work); pair with the human gate-todo for anything that must hard-block.

## Key Files
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/todo-store.ts` — `createGate` + reverse-edge views (Phase 1); `decisionRef` column (Phase 2); `claimGuard` column + `listReadyTodos` filter line after L560 (Phase 4). Predicates L554-562 and L650-657 unchanged in Phases 1-3.
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/decision-record-store.ts` — `approveDecisionRecord` L180 post-hook completing bound gate-todos (Phase 2).
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/coordinator-daemon.ts` — `escalateRejected`/`escalateExhausted` L42/L86/L148 → `createGate` instead of re-park (Phase 3).
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/coordinator-live.ts` — consumes `listReadyTodos` L322; no change unless Phase 4.
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/gate-probes.ts` — NEW, Phase 4 only (~30 lines).
