# Design: The Recursive Typed "System Object" Primitive

> Lead Architect synthesis. Winner = **Concept 6 (Domain-Plugin / Federated)**, grafted with Concept 4's Type Registry, Concept 2's content-hash revision pin, and Concept 3/5's naming discipline (deferred as future phases). Brainstorm artifact — no code changes; this is the buildable blueprint.

---

## 1. VISION

mermaid-collab today is a **work-graph** product: a tree of todos (`parentId`) over a dependency DAG (`dependsOn[]`), executed by a coordinator/worker fleet under per-project agent profiles. A todo is a *transient unit of work* — it has a status ladder and a claim/lease. To become a company-wide multi-domain engineering platform (SaaS, CAD, robotics, requirements, electrical, BOM), we need a **second, durable primitive**: a recursive **typed system object** — a `Robot` that *has-a* `Axis` that *has-a* `Motor` — whose identity is a frozen, version-pinned referent that outlives any one task. The core insight (and the central category error to avoid): **an object is not a todo.** We add a thin, domain-agnostic federated core (TYPE + CHILDREN + EDGES + ARTIFACTS + GATES) where every domain plugs in its own types, artifact kinds, gates, and views — and the core never learns a single domain's name.

---

## 1b. THE REQUIREMENTS LAYER — the spec→Planner bridge (refinement, 2026-06-05)

**Framing (user):** this primitive is fundamentally a way to **spec a project** — per-project, possibly spanning multiple domains. The load-bearing output of the spec is **requirements**, and requirements are *what the Planner consumes to generate work across domains*. This elevates requirements from a deferred Phase-3 nicety (Concept 3's traceability spine) to a **first-class, early element**, because they are the Planner's input — not an afterthought.

**The role split this creates (clean, reuses existing roles):**

```
SPEC LAYER (new)             PLANNER (exists, unchanged)        WORKERS + GATES (exist)
requirements + objects  ──guides──▶  human-driven planning  ──▶  execute → verify
  "what & why"                       authors todos WITH the        "the doing" + "the proof"
  per-project,                       human; promotes to ready      verify-edge points back
  cross-domain,                      (existing approval gate)      at the requirement
  USER-CONFIRMED
```

**Critical nuance:** the spec **guides** the Planner — it does NOT generate todos and does NOT bypass the Planner. The human still plans through the Planner exactly as today (plan *with* the human; the human-approval gate; the Planner is the only role that promotes todos to `ready`). The spec is a **durable reference the Planner orients on**, a peer of constraints — not a new control path that emits work.

This slots into the Planner's existing shape with almost no new behavior:
- The Planner's **Step 1 (Orient)** already reads `get_active_constraints` + `list_decision_records` + the codebase. We simply add **"read the active system spec"** (confirmed requirements + relevant system objects) to that same orientation. Requirements become first-class orientation inputs — peers of constraints.
- The human + Planner still **author the todos**; the spec tells the Planner *what's required, across which domains, and what's been confirmed*, so todos trace back to requirements while a human still shapes and approves them.
- **Coverage is a check, not an engine:** "this approved requirement has no epic/todo satisfying it yet" is a Planner *prompt to the human*, never an auto-spawn.

The platform's Planner today starts from loose "goals." This gives it a **confirmed, durable, traceable spec to plan against**: Requirement → (allocate/satisfy) system objects across domains → **Planner (with the human) authors per-domain epics/todos guided by the spec** → workers execute → gates verify → verify-edge traces back to the requirement.

**Authoring + the confirmation gate (REUSE, do not build):** requirements may be authored by the **user OR proposed by the AI**, but **every requirement add/change is gated on explicit user confirmation.** This maps exactly onto the existing `decision-record-store` lifecycle — `proposed → approved → active` with `approvedBy` (decision-record-store.ts) — the *same* human-approval gate that constraints already use and that the Planner skill enforces before promoting todos to `ready`. Mechanics:
- An AI-proposed requirement lands `proposed`; the user's confirmation flips it `approved/active` and stamps `approvedBy`.
- A **change** to an approved requirement **supersedes** the old one (`supersededBy`) and re-enters `proposed` — so a spec the Planner already planned against never silently mutates; the change is an explicit, attributable, confirmed event.
- A requirement's spec is **machine-comparable** (`{ metric, op, target }`, e.g. `{workspace_reach_mm, '>=', 800}`) so a gate verdict can be *checked against it*, not merely attached.

**Cross-domain by construction:** one requirement (domain-neutral, e.g. "reach 800mm") allocates/satisfies across mechanical (Axis), electrical (Motor/Harness), and software (control API) subtrees — the Planner fans it into per-domain work via the existing agent-profile types. This is precisely why requirements must be cross-cutting, not nested under one domain's subtree.

**Structural choice — RESOLVED (focused bake-off, 2026-06-05): a separate requirements layer, implemented as a new `kind` on the decision-record store.** A two-agent bake-off (node-kind-in-the-object-tree vs separate-layer) was judged in favor of the **separate layer**:

- **Requirements are cross-cutting intent — exactly what `getActiveConstraints` already models.** The decision-record store already returns epic-level + project-level records that bear on the whole tree *without being tree nodes*. A requirement is "a constraint with a machine-comparable spec + typed edges." This matches the user's framing (requirements *guide* the Planner, peers of constraints) one-to-one.
- **Implementation = near-zero new machinery.** Extend `DecisionKind` with `'requirement'`; add one nullable `spec` JSON column (`{metric, op, target}`, null for the other three kinds); `initialStatus('requirement') = 'proposed'` (like constraints). The confirmation gate is then *literally* the existing `approveDecisionRecord` / `supersedeDecisionRecord` — no new lifecycle code. The Planner's Orient adds a `getActiveRequirements(project, epicId)` selector that mirrors `getActiveConstraints`.
- **Rejected the node-kind alternative** because a requirement has no natural tree parent (it would force a synthetic `requirements:Folder` fudge + an arbitrary domain nesting), it smears the `allowedChildTypes` composition grammar, and it forces a perpetual `WHERE typeId NOT LIKE 'requirements:%'` guard on every BOM/rollup query.
- **Grafts taken from the node-kind argument (its best ideas, kept inside the layer model):** (1) **all typed edges live in the ONE `system-objects.db` edges table** — a requirement is a foreign *id* endpoint (a decision-record id), the same one-directional asymmetric FK already accepted for `Todo.objectRef`; this keeps the edge table homogeneous and makes coverage a single LEFT JOIN and STALE-on-bump a single-store edges update. (2) **Requirements get the same content-hash revision + STALE-on-bump** as parts: changing `≥800`→`≥850` supersedes the requirement and marks its downstream satisfy/verify edges `stale`.

The confirmation gate and the spec→Planner bridge above are unchanged by this resolution.

---

## 2. ARCHITECTURE OVERVIEW

### The thin federated core

The core knows exactly five nouns and nothing about any domain:

- **TYPE** — every object pins a `SystemObjectType` from a registry (resolved like `resolveProfile`).
- **CHILDREN** — recursive composition (`parentObjectId`), validated against the type's grammar.
- **EDGES** — typed non-tree relationships (deferred to Phase 3, but the slot exists).
- **ARTIFACTS** — attachments resolved through an overlay over the CLOSED `ArtifactType` enum.
- **GATES** — acceptance verdicts produced by a predicate-bound gate registry.

A **core-purity test** (`core-purity.test.ts`) greps the core source for any domain literal (`"cad"`, `"robot"`, `"axis"`, `"saas"`, `"electrical"`, …). If the core ever mentions a domain by name, the test fails. This is the structural guarantee that domains are federated, not hard-coded.

### The DomainPlugin contract

A domain (cad, robotics, electrical, saas, requirements) is a `DomainPlugin` object contributing:

- `types[]` — `SystemObjectType` registry entries (with `attributeSchema`, `allowedChildTypes`, `requiredArtifacts`, `gateBinding`, `agentProfile`).
- `artifactKinds[]` — namespaced `domain:kind` strings resolved by an overlay layer over the closed enum (migration-free; no enum edit).
- `gates[]` — `GatePlugin`s keyed by an `appliesTo(object)` predicate.
- `views?` — optional fleet-graph node renderers.

Registration mirrors `resolveProfile`: **global base ⟵ org ⟵ `.collab/project.json` `plugins[]`**, merged so a project may only *narrow* (never widen) what global allows.

### Storage: a SEPARATE durable store

Durable type/instance/revision facts live in a **new** `.collab/system-objects.db` (cloning the `todo-store.ts` `bun:sqlite` pattern) — **NOT** new columns on `todos`. This is the fix for the Minimal-Overlay category error: a *released/frozen* object referent must not inherit the todo status ladder or the claim/lease blast radius. The work-graph links to objects via **one nullable `Todo.objectRef` column**, so spawned object-work still lives in the work-graph **under an epic** (preserving the every-todo-belongs-to-an-epic invariant).

```
                         .collab/project.json (plugins[], narrows global)
                                      |
        global base plugins ──► PLUGIN REGISTRY ◄── org layer
        (cad, saas, robotics…)        |
                                      v
   ┌─────────────────────────────── THIN CORE ───────────────────────────────┐
   │  TYPE        CHILDREN        EDGES        ARTIFACTS        GATES          │
   │   │             │             │              │              │            │
   │   │ resolveType │ validateChild│ (Phase 3)   │ artifactKind │ gate-runner│
   │   │             │             │              │  resolver    │ (registry) │
   └───┼─────────────┼─────────────┼──────────────┼──────────────┼────────────┘
       │             │                            │              │
       v             v                            v              v
  ┌──────────────────────────────────┐    ┌───────────────┐  ┌─────────────────┐
  │   .collab/system-objects.db       │    │ ArtifactManager│  │ runCadGate (#1) │
  │   (NEW, bun:sqlite)               │    │  (REUSED)      │  │ subprocess(adpt)│
  │  ┌──────────┬──────────┬────────┐ │    │ overlay maps   │  │ fail-closed     │
  │  │  types   │ instances│revisions│ │    │ domain:kind →  │  └─────────────────┘
  │  └──────────┴──────────┴────────┘ │    │ closed enum    │
  └───────────────┬──────────────────┘    └───────────────┘
                  │ objectRef (nullable FK, one direction)
                  v
        ┌─────────────────────────────────────────────┐
        │  todo-store.ts  (EXISTING, UNTOUCHED schema  │
        │  except +objectRef): epic → todo tree,       │
        │  dependsOn DAG, claim/lease IFF in_progress   │
        └─────────────────────────────────────────────┘
```

**Two stores, one firewall.** The work-graph owns *transient* facts (status, claim, lease). `system-objects.db` owns *durable* facts (type, composition, revision). They touch at exactly one seam: `Todo.objectRef`.

---

## 3. THE SCHEMA

### Who owns which fact

| Fact | Owner | Store / file |
|---|---|---|
| Type catalog (schema, grammar, gate binding, agent profile) | `SystemObjectType` registry | `system-objects.db:types` (seeded from plugins, resolved like profiles) |
| Object identity + composition tree | `SystemObject` instance | `system-objects.db:instances` |
| Version pin (content-hash) | `SystemRevision` | `system-objects.db:revisions` |
| Attachments (spec sheets, CAD, schematics) | `ArtifactManager<T>` | existing per-session artifact storage + overlay resolver |
| Acceptance verdict | gate registry | computed, not stored as a table; latest verdict cached on revision |
| The work to *build/change* an object | Todo | `todos` table + `objectRef` |
| Where-used / BOM | derived recursive CTE | never stored |

### Core instance (thin — no domain fields)

```ts
// system-object-store.ts
interface SystemObject {
  id: string;                 // stable referent identity
  typeId: string;             // → SystemObjectType.id
  typeVersion: number;        // PINNED at create; instance does not float
  parentObjectId: string | null;  // recursive composition (tree)
  qty: number;                // multiplicity within parent (BOM rollup)
  name: string;
  attributes: Record<string, unknown>; // validated against type.attributeSchema
  currentRevisionId: string | null;    // → SystemRevision
  // NOTE: NO status, NO claimedBy, NO leaseExpiresAt. By construction.
}
```

### Type registry entry (grafted from Concept 4)

```ts
interface SystemObjectType {
  id: string;                 // e.g. "robotics:Axis"
  version: number;            // instances pin this
  domain: string;             // plugin that contributed it
  attributeSchema: JSONSchema;         // validates SystemObject.attributes
  allowedChildTypes: string[];         // composition grammar
  requiredArtifacts: string[];         // artifactKinds that must attach before "released"
  gateBinding: string | null;          // gate id (resolved in gate registry)
  agentProfile: string | null;         // → resolveProfile(type, project)
}
```

Resolution: **global ⟵ org ⟵ project**, merged like `resolveProfile(type, project)`. A project may only **NARROW** `allowedChildTypes`/`requiredArtifacts` (subset), never add types or widen the grammar. (DROPPED from C4: lazy `migration.map` machinery and decision-record-gated type *mutation* — premature for single-user; deferred until a second team shares a catalog.)

### Revision = content-hash version-pin (grafted from Concept 2, ONLY this)

```ts
interface SystemRevision {
  id: string;
  objectId: string;
  contentHash: string;   // hash over {attributes, sorted child refs+qty, attached artifact hashes}
  createdAt: number;
  gateVerdict: 'pass' | 'fail' | 'unknown';  // last gate result for this exact content
}
```

A revision is the immutable, content-addressed snapshot. Identical content ⇒ identical hash ⇒ reuse. (DROPPED from C2: drift two-clock, effectivity windows, the heavy three-table PLM catalog.)

### The plugin interfaces

```ts
// domain-plugin.ts
interface DomainPlugin {
  domain: string;                         // "cad" | "saas" | "robotics" | ...
  types: SystemObjectType[];
  artifactKinds: ArtifactKind[];          // { kind: "cad:step", baseType: ArtifactType, ext, folder }
  gates: GatePlugin[];
  views?: FleetViewContribution[];
}

// gate-runner.ts  (generalizes runGate)
interface GatePlugin {
  id: string;
  appliesTo(obj: SystemObject, type: SystemObjectType): boolean;  // predicate routing
  run(ctx: GateContext): Promise<GateVerdict>;   // GateVerdict = { verdict, metrics?, detail }
}
```

### Todo ⟷ object link (under an epic)

```ts
// todo-store.ts — ONE nullable column via addColumnIfMissing (:176-185)
interface Todo {
  // ...existing parentId, dependsOn, type, claim/lease IFF in_progress...
  objectRef: string | null;   // → SystemObject.id  (work for an object, still under an epic)
}
```

The link is **one-directional**: a todo may point at an object; an object never points at a todo. This keeps the durable store free of any work-graph lifecycle.

---

## 4. THE WORK-VS-DURABLE FIREWALL

**Naming discipline (adopted from Concept 5's north star, applied now):** in the existing work-graph the invariant is `claim/lease non-null IFF status == in_progress` (todo-store.ts :574-589 context). That invariant **IS** the firewall between *transient work* and *durable referent*.

We make illegal states **unrepresentable in the new model without migrating the old store**:

- `SystemObject` has **no** `status`, `claimedBy`, or `leaseExpiresAt` columns — there is literally nowhere to put a lease on a durable object. A *released/frozen* referent therefore can never enter the lease blast radius (watchdog escalation, respawn backoff, claim expiry). It physically cannot be "claimed."
- All *work* on an object — design it, revise it, run its gate — is a **Todo** with `objectRef` set, living under an epic, carrying the full status ladder and lease semantics. Transience lives only where transience belongs.
- The seam is asymmetric: `Todo.objectRef → SystemObject` only. Deleting/archiving a todo never touches the object; freezing an object never strands a lease.

This is the precise repair of the Minimal-Overlay category error: instead of overloading the `type` string column on todos and hoping a "released" object behaves, we give durable objects a store with **no lifecycle surface area at all**.

---

## 5. MULTI-DOMAIN WORKED EXAMPLES

### Robot subtree (robotics + cad + electrical + BOM)

```
Robot  (robotics:Robot)  rev#a91…  gate: robotics:assembly → pass
├─ Axis  (robotics:Axis)         qty 6
│  ├─ Motor   (robotics:Motor)   qty 1   rev#7c2…
│  │  ├─ artifact  cad:step        (CAD model)        ──► runCadGate → pass (mass<thr)
│  │  └─ artifact  electrical:schematic (winding diagram)
│  ├─ Encoder (robotics:Encoder) qty 1
│  │  └─ artifact  electrical:datasheet  (spec sheet)
│  └─ Gearbox (robotics:Gearbox) qty 1   rev#11f…
│     └─ artifact  cad:step        ──► runCadGate → FAIL (interference)  [blocks release]
└─ Sensor (robotics:Sensor)      qty 2
   └─ artifact  electrical:datasheet
```

- Composition is grammar-checked: `robotics:Robot.allowedChildTypes = [Axis, Sensor]`; `Axis.allowedChildTypes = [Motor, Encoder, Gearbox]`. Adding a `saas:API` under an `Axis` is rejected by `validateChild`.
- Gates are **predicate-bound**: `runCadGate` (plugin #1) has `appliesTo = obj has a cad:step artifact`. It fires automatically on the Motor and Gearbox CAD models. The Gearbox FAIL (fail-closed) blocks the parent `Robot` revision from reaching `pass`.

### SaaS subtree (saas + test/lint gate)

```
Checkout Service  (saas:Service)   rev#3d0…  gate: saas:ci → pass
├─ API     (saas:API)      qty 1
│  └─ artifact  saas:openapi
├─ UI      (saas:UI)       qty 1
│  └─ artifact  saas:storybook
└─ Library (saas:Library)  qty 1   ──► saas:ci gate (test+lint) → pass
```

- `saas:ci` gate is a **subprocess adapter** over the manifest `gateCommand` (the existing `runGate` path kept as a fail-closed adapter — `parseTrailingVerdict`).

### Derived BOM (recursive CTE, never stored)

```sql
WITH RECURSIVE bom(id, typeId, qty, depth, path) AS (
  SELECT id, typeId, qty, 0, name FROM instances WHERE id = :rootId
  UNION ALL
  SELECT c.id, c.typeId, c.qty * p.qty, p.depth+1, p.path || ' / ' || c.name
  FROM instances c JOIN bom p ON c.parentObjectId = p.id
)
SELECT typeId, SUM(qty) AS total_qty FROM bom GROUP BY typeId ORDER BY typeId;
-- Robot → { robotics:Motor: 6, robotics:Encoder: 6, robotics:Gearbox: 6, robotics:Sensor: 2 }
```

`qty` multiplies down the tree. **Where-used** is the same CTE walked upward. Neither is ever a stored document.

---

## 6. HOW THINGS ATTACH

- **Human review** — reuse `escalation_create`/`await_human_decision` + `decision-record-store.ts`. A "release this revision?" decision attaches to the object via a work todo (`objectRef`) under the relevant epic; `getActiveConstraints` still governs.
- **Part spec sheets / electrical diagrams / CAD** — attached as `ArtifactManager<T>` artifacts, but typed via an **artifactKind overlay**: `electrical:datasheet`, `cad:step`, `saas:openapi`. The resolver (`artifact-kind-resolver.ts`) maps each namespaced `domain:kind` to a base `ArtifactType` + ext + folder, so the **closed enum is never edited** (migration-free).
- **Parts list** — the derived recursive-CTE BOM above. No table.
- **Acceptance gate** — `type.gateBinding` resolves to a `GatePlugin` in the registry; the predicate decides which objects it applies to. The latest verdict is cached on the revision (`gateVerdict`).

---

## 7. SIGNATURE MECHANICS

1. **Gate registry binding (generalizing `runGate`).** Today `runGate` (coordinator-live.ts:713) runs ONE manifest `gateCommand` subprocess + `parseTrailingVerdict` (:750), fail-closed. We generalize it into a `gate-runner.ts` registry of `GatePlugin`s keyed by `appliesTo(obj,type)`. `runCadGate` (cad-gate-runner.ts:144 — PURE, TESTED, currently NOT wired) registers as **plugin #1**. The subprocess gate becomes a fail-closed *adapter* plugin (`appliesTo = type has a gateCommand`). Resolution order is deterministic; first matching plugin wins, ties broken by registration order (core before domain, domain before project).
2. **Add-child composition-grammar validation.** A pure `validateChild(parentType, childType)` checks `childType ∈ parentType.allowedChildTypes` (after project narrowing). Called on every `addChild` to `system-object-store`. No grammar, no insert.
3. **Todo → object reference + type → agent-profile routing.** Object-work spawns a Todo with `objectRef` set, created **under an epic** (invariant preserved). The object's `type.agentProfile` feeds `resolveProfile(type, project)` so the right worker (CAD reviewer, SaaS engineer) is selected — reusing the existing profile machinery (agent-profiles.ts :73-87).
4. **How a plugin registers a type + artifactKind + gate.** A `DomainPlugin` is a single object: `{ domain, types[], artifactKinds[], gates[], views? }`. The plugin-registry merges it global→org→project; types seed `system-objects.db:types`, artifactKinds register in the overlay resolver, gates register in `gate-runner`.
5. **How a new domain onboards with ZERO core changes.** Drop a `plugins/<domain>/index.ts` exporting a `DomainPlugin`, list it in global base or `.collab/project.json` `plugins[]`. No core edit, no enum edit, no migration. `core-purity.test.ts` guarantees the core never gained a reference to it.

---

## 8. TECHNICAL PLAN

### New files

| File | Purpose |
|---|---|
| `src/services/system-object-store.ts` | `system-objects.db` (bun:sqlite, cloned from todo-store): types/instances/revisions tables, CRUD, recursive BOM CTE |
| `src/services/domain-plugin.ts` | `DomainPlugin` / `GatePlugin` / `ArtifactKind` interfaces + `SystemObjectType` |
| `src/services/plugin-registry.ts` | global⟵org⟵project merge (mirrors resolveProfile), narrowing-only enforcement |
| `src/services/gate-runner.ts` | predicate-bound `GatePlugin` registry; deterministic resolution |
| `src/services/artifact-kind-resolver.ts` | overlay: `domain:kind` → base ArtifactType + ext + folder |
| `src/plugins/cad/index.ts` | `runCadGate` as plugin #1; `cad:step` artifactKind; cad types |
| `src/plugins/saas/index.ts` | subprocess `gateCommand` adapter gate; saas:openapi/storybook; saas types |
| `src/plugins/{robotics,electrical,requirements}/index.ts` | Phase 4 |
| `src/services/__tests__/core-purity.test.ts` | grep core for any domain literal — fails if found |

### Reuse / new / delete vs real files

- **REUSE (untouched):** `artifact-manager.ts` (generic + free history), `decision-record-store.ts`, `agent-profiles.ts` `resolveProfile`, `project-manifest.ts`, fleet `useFleetGraph.ts`/`types.ts`.
- **EXTEND (additive only):** `todo-store.ts` +`objectRef` via `addColumnIfMissing` (:176-185); `coordinator-live.ts` `runGate` (:713) refactored to *call into* `gate-runner.ts` rather than inline the subprocess.
- **WIRE (the Phase-1 win):** `cad-gate-runner.ts` `runCadGate` — finally invoked live as gate plugin #1.
- **DELETE:** nothing. No rewrite. The closed `ArtifactType` enum (artifact-api.ts:18) stays closed — the resolver overlays it.
- **DEPENDENCIES:** none new (bun:sqlite already in use).

### Phased build order

- **Phase 1 — Gate registry (ships on today's code, ZERO durable schema).** Build `gate-runner.ts`; register `runCadGate` as plugin #1 (wire the pure/tested gate live); refactor `runGate` subprocess into a fail-closed adapter plugin. Add `core-purity.test.ts`. **This is also Grok's "simplest high-value" answer.**
- **Phase 2 — Type registry + `system-objects.db` + `Todo.objectRef`.** `system-object-store.ts`, `domain-plugin.ts`, `plugin-registry.ts`, `validateChild`, `artifact-kind-resolver.ts`. cad + saas plugins. BOM CTE.
- **Phase 3 — MBSE traceability edges + STALE-on-version-bump.** Typed non-tree EDGES; a verify-edge points at a Phase-1 gate verdict; a version bump marks downstream STALE. Rides on the Phase-1 gate registry.
- **Phase 4 — Multi-domain plugins (robotics/electrical/requirements) + fleet-graph views.** Discriminated object nodes alongside Epic|Todo|Worker.
- **North star (not scheduled):** eventual unified-graph absorption — adopt only after the durable store has proven out; never a sandboxless migration of the load-bearing todo-store.

---

## 9. WHY THIS OVER THE ALTERNATIVES

- **Not pure Minimal-Overlay** (extra columns on `todos`): the **category error**. A released, frozen referent would inherit the todo status ladder and claim/lease blast radius — a "released" object could be "claimed" by a worker and escalated by the watchdog. The separate store with no lifecycle columns makes that state unrepresentable.
- **Not unified-graph-first** (Concept 5): a sandboxless migration of the load-bearing `todo-store` is the **top operational risk**. We adopt its naming discipline now (the lease-IFF-in_progress firewall) but defer the absorption to a north star.
- **Not PLM-heavy** (Concept 2 full): drift two-clock, effectivity, three-table catalog impose enterprise friction on an often-single-user, local-first product. We keep only the content-hash revision pin.
- **Not MBSE-first** (Concept 3): traceability edges + STALE propagation are powerful but premature before the type/instance core exists. Designed to ride on the Phase-1 gate registry in Phase 3.

**Grok synthesis (ACCEPT / TEMPER / DISCOUNT):** ACCEPT Grok's "build the gate registry first" — it is Phase 1, high-value, zero schema, and finally wires the orphaned `runCadGate`. TEMPER the temptation to also unify stores immediately — we firewall instead of merge. DISCOUNT any push toward decision-record-gated type *mutation* and lazy migration maps as premature for single-user; deferred to the multi-team future.

---

## 10. TOP RISKS + OPEN QUESTIONS

1. **Keeping the core agnostic.** Mitigated by `core-purity.test.ts` grepping for domain literals — but it must cover the gate-runner and resolver too, and stay enforced in CI.
2. **Closed `ArtifactType` enum overlay.** The resolver must map every `domain:kind` to a valid base enum value with correct ext/folder/WS maps (the parallel maps at artifact-api.ts:18). Open Q: do we need a fallback base type for unmapped kinds, or fail-closed on unknown kinds?
3. **The `runCadGate`-not-yet-wired gap.** This orphan (pure + tested, never called) is Phase 1's first concrete win and the proof the registry pays off immediately.
4. **Instance / type / revision exactness.** `typeVersion` pins at create; `contentHash` must hash a *canonical* serialization (sorted children + qty + artifact hashes) or reuse detection breaks. Open Q: exact canonicalization spec.
5. **Org-layer governance deferred.** The merge order leaves an `org` slot, but org-level catalog governance (who may publish a type) is unbuilt — fine for single-user, must precede multi-team.
6. **The eventual unified-graph migration.** The biggest long-term unknown; deliberately unscheduled. Open Q: when (if ever) does the durable store earn absorption into the work-graph, and how is that done with a sandbox?
