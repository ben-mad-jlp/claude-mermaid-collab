# Design B — Orthogonal-but-Linked Trees

> Position paper. The system-object tree and the work-graph are **two distinct
> structures with two distinct lifecycles**, joined by reference — not merged.
> This document argues that separation honestly, specifies the schema + link, and
> is candid about the cost (it's a join you must keep healthy).

Companion diagram: `{{diagram:design-B-orthogonal-trees}}`

---

## 0. The thesis in one sentence

> The **system-object tree** is the durable, revisioned *"what we're building"*
> (digital thread / BOM / MBSE composition). The **work-graph** (epics → todos →
> deps) is the ephemeral, leased *"what work to do"* — it stays exactly as today's
> primitive. They are **joined by reference** (`todo.systemObjectId`,
> `epic.targetSystemObjectId`), never fused.

Fusing them is a **category error**: a *thing* and the *doing of work on a thing*
have orthogonal lifecycles. An Axis exists, released and serviceable, long after
every todo that built it is `done`. A todo is born, claimed, leased, completed,
and garbage-collected within one work cycle. Force them into one row and you must
either give the Axis a `claimToken` (meaningless) or resurrect a `done` todo every
time someone touches the part (churn). Keep them apart and each keeps its own
natural lifecycle.

---

## 1. Two lifecycles, side by side

| Axis | System-object tree | Work-graph (unchanged) |
|---|---|---|
| Question answered | *What are we building?* | *What work, in what order, by whom?* |
| Lifetime | Long-lived; outlives many work cycles | Ephemeral; one cycle then archived |
| Change model | **Revisioned** (rev A → B); PLM-style | **Leased / claimed**; status churn |
| State enum | `designStatus`, `reviewState`, `revision` | `TodoStatus` (`backlog…done`), `acceptanceStatus`, claim/lease |
| Identity | One identity per real thing (digital-thread node) | One identity per unit of work |
| Owner of truth | The product's *structure & maturity* | The *plan & its execution* |
| Backed by | (new) `system-object-store` | (existing) `todo-store.ts`, **untouched** |

The work-graph primitive in `src/services/todo-store.ts` does **not change**. The
`Todo` interface (todo-store.ts:19) keeps its `parentId`, `dependsOn[]`, claim
fields, epic roll-up (todo-store.ts:570), `type` (agent-profile), and
`targetProject`. We add exactly **one optional field** to it. Everything else is a
new, parallel store.

---

## 2. The SystemObject schema (separate from Todo)

A new store, `src/services/system-object-store.ts`, modeled on the per-project
`bun:sqlite` pattern todo-store already uses (one DB per project, local disk =
source of truth).

```ts
interface SystemObject {
  id: string;
  project: string;
  parentId: string | null;          // recursive COMPOSITION (null = root of a system)
  type: string;                     // registry key: robot|axis|sensor|part|api|ui|library|requirement|…
  name: string;
  multiplicity: number;             // BOM quantity on the edge to parent (default 1)
  order: number;

  attributes: Record<string, unknown>;   // typed spec; shape validated vs the type's attributeSchema

  // DURABLE lifecycle (this is what makes it NOT a todo)
  designStatus: 'proposed' | 'in_design' | 'in_review' | 'released' | 'obsolete';
  revision: string;                 // PLM rev ('A','B' / semver)
  reviewState: 'none' | 'requested' | 'in_review' | 'approved' | 'changes_requested';

  // typed cross-links (traceability) — NOT parent/child
  links: Array<{ rel: 'satisfies'|'verifies'|'allocates'|'interfaces'|'depends'; targetId: string }>;

  artifacts: string[];              // ArtifactManager ids (document/diagram/design/spreadsheet/partspec/electrical)

  createdAt: string; updatedAt: string;
}
```

### What is deliberately NOT on this schema

- **No `claimedBy/claimToken/claimLeaseMs`** — objects are not leased. Work is.
- **No `dependsOn[]` for scheduling** — composition (`parentId`) and traceability
  (`links`) are structural facts, not an execution DAG. The DAG lives in the
  work-graph.
- **No `workTodos[]` array.** This is the most important omission and the heart of
  "derive, don't duplicate" — see §4.

### The link field added to Todo (the *only* schema change to the work-graph)

```ts
// add to existing Todo (todo-store.ts:19), mirroring link/blueprintId/targetProject:
systemObjectId: string | null;     // "this work builds/changes that object" (null = no object)
```

And one field added to an epic (epics are just root todos, so this is the same
field used on a parent todo, given a dedicated read when the todo is an epic):

```ts
// epic.targetSystemObjectId === the systemObjectId set on the epic-todo itself
// "this epic's work targets that object's subtree"
```

That's the entire wire. **One nullable foreign key on each side of the join, and
zero duplicated arrays.**

---

## 3. Types and allowed-children (registry, not enum)

Reuse the agent-profiles mechanism (`agent-profiles.ts:54-87`) verbatim, applied
to *the thing being built* rather than *the worker*: a global registry of type
definitions, **extensible per-project** via `.collab/project.json`.

```ts
interface SystemObjectType {
  key: string;                         // robot|axis|sensor|part|api|ui|library|requirement
  domain: 'software' | 'mechanical' | 'electrical' | 'requirements' | 'cross';
  attributeSchema: JSONSchema;         // validates SystemObject.attributes
  allowedChildTypes: string[] | '*';   // composition rule: robot ⊃ {axis,sensor,harness,controller}
  requiredArtifacts?: string[];        // part ⇒ a 'partspec'; harness ⇒ an 'electrical'
}
```

- **Why a registry, not a closed enum?** A closed enum cannot span SaaS + CAD +
  robotics and cannot be extended by a project. The registry + per-project
  `resolveProfile`-style merge (agent-profiles.ts:73) is already proven in this
  codebase for `cad` (build123d). We apply the identical pattern.
- **`allowedChildTypes`** is validated on add-child — a Robot may contain
  Axis/Sensor/Harness; an Axis may contain Motor/Encoder/Driver. A `ui` object
  may not contain a `motor`.
- **Software types reuse the agent-profile keys** (`api|ui|library`). That is the
  bridge: when a `ui` object's linked todo spawns, the todo's `type='ui'` resolves
  straight to the `ui` worker profile. The object *type* and the worker *profile*
  share a namespace by design, so routing is free.

---

## 4. Who owns which fact (single source of truth per fact)

The link is only safe if **each fact lives in exactly one place** and the other
side *derives* it. This is the discipline that prevents the two-tree drift the
research doc names as the #1 risk.

| Fact | Sole owner | The other side… |
|---|---|---|
| Composition (Robot ⊃ Axis ⊃ Motor) | **Object tree** (`parentId`) | n/a |
| Revision, designStatus, reviewState | **Object tree** | work-graph reads, never writes structure |
| Requirement allocation / traceability | **Object tree** (`links`) | n/a |
| Attached artifacts (CAD, partspec, electrical) | **Object tree** (`artifacts[]`) | n/a |
| Plan structure (epics → todos → deps) | **Work-graph** (`todo-store`) | object tree never stores a DAG |
| Claim / lease / acceptance | **Work-graph** | object never leased |
| **"which todos touch object X"** | **DERIVED** | `SELECT * FROM todos WHERE systemObjectId = X` |
| **"which object does this epic target"** | **Work-graph** (`epic.targetSystemObjectId`) | object tree derives its work view from the reverse query |

The crucial line: **the object stores no `workTodos[]` array.** "Which work touched
this Axis" is a *query over the foreign key*, computed on read. There is no array
to keep in sync, so there is nothing to drift. The object tree is the **index**;
the work-graph points *into* it; the back-reference is always a live query.

### The one write that crosses the boundary (and how it stays clean)

Completing work may legitimately advance an object's *durable* state — e.g.
finishing the "review J2 release" todo flips Axis J2 to `reviewState=approved,
designStatus=released`. This is a **single, explicit, audited transition**, not a
continuous sync:

1. The todo carries `systemObjectId = J2` and a declared *effect* (e.g.
   `onComplete: { reviewState: 'approved' }`).
2. On `complete_todo`, the work-graph emits an event; a small reconciler applies
   the declared transition to the object via the object-store API and writes an
   audit row (reusing the decision-record `approvedBy` pattern,
   decision-record-store.ts:33).
3. The object-store **validates** the transition (you cannot go to `released`
   while a child is `in_review`). Illegal transitions are rejected, surfacing as
   an escalation rather than silently corrupting state.

So the boundary has exactly **one** direction of state-write (work → object), it
is **explicit** (declared per-todo, not inferred), and it is **validated** by the
owner of the fact. No bidirectional sync loop exists.

---

## 5. Invariants preserved

- **"Every work todo belongs to an epic" (MEMORY invariant).** Unchanged. Epics
  are still root todos and still roll up (todo-store.ts:570). The new twist: an
  epic *additionally* sets `targetSystemObjectId` to name the subtree it builds.
  A stray bug still goes under `[EPIC] Bugfix inbox`; it simply *also* points at
  the object it fixes. The work-graph invariant is wholly independent of whether a
  `systemObjectId` is present (it's nullable).
- **Only the Planner promotes to `ready`; the Coordinator never self-promotes.**
  Unchanged — the object tree has no say in the promotion gate. It can *inform* a
  planner ("this Axis is `in_review`, don't schedule the dependent harness yet")
  but it cannot flip a `TodoStatus`.
- **Agent-profile routing.** Unchanged and *strengthened*: a `ui` object's todos
  carry `type='ui'`, resolving via the existing `resolveProfile`
  (agent-profiles.ts:73). `targetProject` still routes cross-repo work — a robot
  project's `cad` todos run in the build123d repo.
- **Constraints / decision records.** Add a `systemObjectId` scope alongside the
  existing `epicId` (decision-record-store.ts:24) so a constraint ("payload ≤ 5kg",
  "48V rail") attaches to an object and can propagate to children — still
  human-approved to go `active` (decision-record-store.ts:15).

---

## 6. Worked example A — Robot

**Object tree** (durable):

```
Robot (rev B, in_design)
├─ Axis J1 (rev A, released)
│   ├─ Motor  (part; partspec.pdf)
│   └─ Encoder(part; partspec.pdf)
├─ Axis J2 (rev A, in_review)        ← work happening here
└─ Harness  (harness; electrical.mmd)
Requirement "Payload ≤ 5kg" --satisfies--> Axis J1
```

**Work-graph** (ephemeral), targeting the J2 subtree:

```
[EPIC] Bring up Axis J2      (epic.targetSystemObjectId = J2)
├─ todo: model J2 bracket    (type=cad,        systemObjectId=J2, targetProject=build123d-repo, done)
├─ todo: wire J2 harness     (type=electrical, systemObjectId=Harness, in_progress)
│     dependsOn ▸ model J2 bracket
└─ todo: review J2 release   (type=default,    systemObjectId=J2, ready)
      dependsOn ▸ wire J2 harness
      onComplete ▸ J2.reviewState=approved, J2.designStatus=released
```

When "review J2 release" completes: the work-graph rolls the epic up
(todo-store.ts:570) **and** the reconciler flips J2 to `released` (validated:
allowed because J2's parts are released). The epic and its todos are now archivable;
**Axis J2 remains, released, in the object tree.** Next quarter's "J2 firmware
update" epic targets the *same* J2 object — no part is reborn.

**BOM is derived, not stored:** walk the subtree, sum `multiplicity` per leaf
`part` → generate a `spreadsheet` artifact. The parts list is a *view*.

---

## 7. Worked example B — SaaS (same primitive, different registry)

**Object tree** (durable):

```
App "Billing" (in_design)
├─ API "billing-api"  (type=api; openapi.yaml)
│   └─ Endpoint "POST /charge" (type=api)
├─ UI  "Checkout"     (type=ui; design artifact)
└─ Library "money"    (type=library)
Requirement "PCI-DSS scope" --satisfies--> API "billing-api"
```

**Work-graph** (ephemeral), targeting the Checkout subtree:

```
[EPIC] Ship Checkout v2     (epic.targetSystemObjectId = UI "Checkout")
├─ todo: build checkout form (type=ui,      systemObjectId=Checkout, in_progress)
├─ todo: add /charge endpoint(type=api,     systemObjectId="POST /charge")
└─ todo: extract money lib   (type=library, systemObjectId="money", targetProject=shared-libs-repo)
```

The work-graph references the SaaS object tree **identically** to the robot tree —
same `systemObjectId` FK, same epic targeting, same roll-up. The *only*
differences are the type registry (`api/ui/library` vs `axis/part/harness`) and
the kinds of attached artifacts. **One platform, two domains, one join.**

---

## 8. Honest tradeoffs and mitigations

The orthogonal design is not free. Its costs are real and worth stating plainly.

| Cost | Why it hurts | Mitigation |
|---|---|---|
| **It's a join you must maintain** | A `systemObjectId` can dangle if its object is deleted/merged. | **Referential integrity** in the object-store: deleting an object with live (non-`done`) todos is blocked; a periodic `validate_session_links`-style sweep flags dangling FKs. Soft-delete objects (`obsolete`) rather than hard-delete. |
| **Two places to look** | A user asking "what's the state of J2?" must consult both trees. | **Derived views, not two windows.** The object node renders its live work query inline ("3 todos · 1 in_progress"). The fleet graph already renders nested typed containers (fleet/types.ts) — extend it so an object node *expands* into its derived work-graph. One surface, two layers, never conflated. |
| **Stale references after refactor** | Splitting an Axis into two objects orphans todos pointing at the old id. | Object split/merge is an explicit operation that **rewrites the FK** on referencing todos in the same transaction (cheap because the back-reference is a query, so only the FK column moves). |
| **The cross-boundary write (work→object)** | A bug here corrupts durable state from ephemeral work. | The write is **declared per-todo**, **one-directional**, and **validated by the object-store** (the fact's owner). Illegal transitions escalate, never silently apply (§4). |
| **Discipline erosion** | Every feature tempts "just make the Axis a todo." | A hard, documented rule: *durable/revisioned/reviewed → object; leased/scheduled/claimed → todo.* The schemas physically lack the other's fields (an object has no `claimToken`; a todo has no `revision`), so the wrong choice is mechanically awkward, not just discouraged. |

---

## 9. Why orthogonal beats one unified tree

1. **Lifecycle honesty.** A unified node must carry *both* a `claimLeaseMs` and a
   `revision`; most nodes leave half their fields null. Orthogonal nodes are each
   fully meaningful.
2. **No resurrection churn.** A released part is touched by many work cycles over
   years. A unified tree either reopens the part's node each time (churn,
   destroying its `done`/`released` history) or accretes a tangle of sub-todos
   under a "part" that is not work. Orthogonal: the part is stable; new epics
   point at it.
3. **The existing primitive is preserved.** `todo-store.ts`, the epic roll-up, the
   Planner promotion gate, agent-profile routing, and `targetProject` cross-repo
   work all keep working **with one added nullable column.** A merge would force a
   rewrite of the most load-bearing, daemon-driven part of the system.
4. **Clean multi-domain span.** The same FK joins a robot subtree and a SaaS
   subtree identically (§6, §7). A unified tree would have to reconcile BOM
   multiplicity, revision effectivity, and lease semantics in one schema — the PLM
   "attribute explosion" failure mode.
5. **Derivation kills the sync nightmare.** Because the back-reference is a query
   (§4), there is no array to keep consistent — the thing most likely to drift in
   a merged design simply does not exist here.

**The honest counter:** orthogonality's price is that the digital thread is now a
*join*, and joins can break or go stale, and humans must learn which tree owns
which fact. We pay that with referential integrity, soft-deletes, FK-rewrite on
split/merge, and a single derived UI surface — but it is a real, ongoing tax, and
the single biggest weakness of this approach.

---

## 10. The biggest honest weakness (stated alone, for the judge)

> The link is a **foreign key, and foreign keys rot.** Every object delete, split,
> merge, or rename is an opportunity to orphan a todo or dangle a reference; every
> "what's the status of X" question spans two stores. We mitigate with referential
> integrity, soft-delete, transactional FK-rewrite, derived (never duplicated)
> back-references, and one unified expand-in-place UI — but we are choosing a
> maintained join over a single tree on purpose, and that join is permanent
> surface area. The bet is that two clean lifecycles joined by one nullable FK is
> cheaper, forever, than one tree carrying two lifecycles' worth of mostly-null
> fields and reopening durable nodes on every work cycle.
