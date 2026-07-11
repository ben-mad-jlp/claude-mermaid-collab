# Research: The Recursive "System Object" Primitive

> Design-research note. Brainstorm only — no code, no todos. Goal: assess turning
> mermaid-collab ("collab") into a company-wide engineering platform that drives
> whole projects across domains (SaaS, CAD, robotics, requirements, electrical,
> BOM, human review, spec-sheet storage), anchored on a recursive **typed system
> object** primitive (each object has a TYPE and CHILDREN: Robot, Axis, Sensor,
> API, UI, Library, …).

---

## 1. Grounding in the existing codebase

Collab already has most of the machinery this idea needs. The new primitive should
*generalize and connect* existing tables, not replace them.

### 1.1 Work-graph: todos, epics, deps, profiles

`src/services/todo-store.ts` — per-project `bun:sqlite` DB at `<project>/.collab/*.db`,
single source of truth on local disk (`:9`). The `Todo` interface (`:19-52`) already
carries nearly every field the system-object idea wants to bolt on:

- `parentId` + `dependsOn[]` (`:29-30`) → todos already form a typed tree + DAG.
- `type: string | null` (`:39-40`) → **agent-profile type** (frontend/backend/api/ui/library).
  This is the exact echo of the user's preset object types.
- `targetProject` (`:41-45`) → a todo can be *implemented in a different repo* than the
  one tracking it. This is already cross-domain/cross-repo plumbing.
- `link: TodoLink {blueprintId, taskId}` (`:14-17`, `:32`) → todos link to blueprint/task-graph nodes.
- claim/lease fields (`claimedBy/claimToken/claimLeaseMs`, `:47-51`) → workers lease nodes of the tree.
- **Epic roll-up** (`:570-573`): an epic auto-closes when every non-dropped child is done;
  "an epic with zero non-dropped children is never auto-closed." Epics are todos that act as
  roots — matching the MEMORY invariant *"every work todo must belong to an epic; epics are roots."*

`TodoStatus` (`:12`): `backlog | planned | todo | ready | in_progress | blocked | done | dropped`.
Note `ready` is the promotion gate — only the Planner promotes to `ready`; the Coordinator never self-promotes.

### 1.2 Artifact types & storage

`src/routes/artifact-api.ts:18` defines the closed artifact enum:
`ArtifactType = 'diagram' | 'document' | 'snippet' | 'design' | 'spreadsheet' | 'embed'`
with parallel maps for file extension (`:21`), directory (`:30`), and create/update event names (`:39`, `:48`).
Plus `image` and `component` exist as related managers.

Storage is per-session on disk (confirmed live):
`<project>/.collab/sessions/<session>/{documents,diagrams,designs,snippets,spreadsheets}/`
plus `collab-state.json`, `metadata.json`, `update-log.json`.

`src/services/artifact-manager.ts` is the generic CRUD+version-history base class
(`ArtifactManager<T extends ArtifactRecord>`, `:44`). Storage convention (`:36-43`):
`{basePath}/{id}.{ext}` + `.history/{id}.history` + `.{id}.meta.json` sidecar for the human name.
**Every artifact already has: id, name, lastModified, version history.** A system object that
"stores spec sheets" can reuse this base verbatim (a `partspec` artifact type = a PDF/embed).

### 1.3 Agent-profile TYPE registry (the strongest precedent)

`src/config/agent-profiles.ts` is the closest existing thing to "preset object types":

- `AgentProfileType = 'default' | 'frontend' | 'backend' | 'api' | 'ui' | 'library'` (`:32`).
- `AGENT_PROFILES` registry (`:54-61`) maps each type → `{allowedTools, model?, runtimeMode?, contextPrompt?}`.
- `resolveProfile(type, project)` (`:73`) merges a **per-project manifest override** (`.collab/project.json`)
  over the global profile (`:78-86`) — so a project ships its own types (e.g. build123d's `cad`) without
  collab knowing about them. **This is already a type-registry-with-per-project-extension pattern.**
- `inferProfileType(files)` (`:102`) infers type from touched file paths via ordered `PATH_RULES` (`:94-100`);
  multi-domain → `default`.

Key takeaway: collab already has **(a) a typed enum, (b) a registry mapping type → behavior,
(c) per-project schema extension, (d) type inference.** The system-object types want the same
four mechanisms — but describing *the thing being built*, not *the worker building it*.

### 1.4 Decision records & constraints (PCS)

`src/services/decision-record-store.ts`: project-scoped `decision | constraint | assumption` records,
lifecycle `proposed → approved → active → superseded` (`:18-19`). Constraints need **human approval**
to go active (`:15`). Fields (`:21-36`) include `epicId` (null = project-level), `linkedTodos[]`,
`alternatives[]`, `supersededBy`, `approvedBy`. This is the existing home for "parent constraints"
and is already epic-scoped — a system object's constraints could reuse this table with a new
`systemObjectId` scope alongside `epicId`.

### 1.5 Fleet / graph model

`ui/.../fleet/types.ts`: the fleet graph is a typed node/edge graph with discriminated nodes:
`EpicNodeData | TodoNodeData | WorkerNodeData` (`:9`, `:26`, `:35`, `:44`). Epics render as
expandable framed containers whose children nest via `parentId` (`:15-24`) — **collab already
renders a recursive typed-container graph in the UI.** `useFleetGraph.ts` recomputes topology only
on structural change and repaints status in place. A "system object tree" view is a near-identical
React Flow surface with a different node taxonomy.

### Summary of reusable primitives

| Need (system-object) | Existing primitive | Location |
|---|---|---|
| Recursive typed tree + DAG | `Todo.parentId` + `dependsOn[]` | todo-store.ts:29-30 |
| Preset TYPE field | `Todo.type`; `AgentProfileType` | todo-store.ts:39; agent-profiles.ts:32 |
| Type → behavior registry + per-project extension | `AGENT_PROFILES` + manifest merge | agent-profiles.ts:54-87 |
| Type inference | `inferProfileType(files)` | agent-profiles.ts:102 |
| Roots / "belongs to a parent" invariant | Epic roll-up | todo-store.ts:570-573 |
| Attached artifacts (docs/diagrams/spec sheets) | `ArtifactManager` + per-session dirs | artifact-manager.ts:44; artifact-api.ts:18 |
| Constraints / decisions, human-approved | decision-record-store | decision-record-store.ts:18-36 |
| Cross-repo / cross-domain work | `Todo.targetProject` | todo-store.ts:41-45 |
| Recursive typed graph UI | Fleet graph nodes | fleet/types.ts:9-47 |
| Human review / escalation | escalation_* tools + decision relay | (MCP escalation tools) |

---

## 2. Prior art / mental models

| Model | What it contributes |
|---|---|
| **SysML / MBSE block hierarchy** | The canonical "system as a tree/graph of typed blocks with ports, parts, and value properties." Blocks ≈ system objects; *Block Definition Diagram* (type/definition) vs *Internal Block Diagram* (instance composition + connectors) maps cleanly to a **type registry vs instance tree** split. SysML4 also adds requirements + allocation as first-class — directly relevant. |
| **BOM (bill-of-materials) tree** | A pure recursive parent→child quantity tree. Contributes: **quantity/multiplicity** on the edge (a Robot has 6 Axes), rolled-up cost/mass, and the engineering vs manufacturing BOM distinction (logical design tree vs physical buildable tree). |
| **PLM part hierarchy** | Revision/lifecycle control per part (`released/obsolete`), effectivity, where-used queries, and attaching **spec sheets/CAD files as managed documents** to a part. Mirrors collab's artifact version-history + status. |
| **ROS node/component graph** | A *runtime* composition graph (nodes, topics, lifecycle states). Contributes: a system object is not just static structure — it has **typed ports/interfaces** and a runtime/operational state distinct from its design state. |
| **ECAD/MCAD assembly tree** | Assembly→subassembly→part nesting with reference designators; net/connectivity for electrical. Contributes: the **same recursive container** spans mechanical assembly and electrical schematic; "electrical diagram" is an artifact attached to an Axis/Harness object. |
| **Requirements traceability (req → component → test)** | The digital thread: every requirement *allocates to* a component and *verifies via* a test. Contributes: system objects need **typed cross-links** (satisfies/verifies/allocates), not just parent/child — and these links are what make "human review" and audit meaningful. |
| **Digital thread / digital twin** | The unifying frame: one identity per real thing, linking requirement → design → as-built → operational data over the lifecycle. Contributes the *ambition* — collab's system object aspires to be the digital-thread node that all artifacts, work, and reviews hang off. |

Synthesis: the design wants **BOM's recursive multiplicity tree**, **SysML's type-vs-instance +
ports + requirement allocation**, **PLM's per-node revision/lifecycle + attached managed documents**,
and **traceability's typed cross-links** — layered onto collab's existing todo/artifact/decision tables.

---

## 3. Candidate design

### 3.1 Core schema

```ts
interface SystemObject {
  id: string;
  project: string;
  parentId: string | null;        // recursive composition (null = root of a system)
  type: string;                   // registry key: 'robot' | 'axis' | 'sensor' | 'api' | 'ui' | ...
  name: string;
  multiplicity: number;           // BOM quantity on the edge to parent (default 1)
  order: number;

  // typed spec — shape validated against the type's schema (see 3.2)
  attributes: Record<string, unknown>;

  // dual lifecycle (SysML/ROS insight): design maturity vs operational status
  designStatus: 'proposed' | 'in_design' | 'in_review' | 'released' | 'obsolete';
  revision: string;               // PLM rev ('A','B' / semver)

  // typed cross-links (traceability) — NOT parent/child
  links: Array<{ rel: 'satisfies'|'verifies'|'allocates'|'depends'|'interfaces'; targetId: string }>;

  // attachments reuse existing primitives
  artifacts: string[];            // artifact ids (documents/diagrams/designs/spreadsheets/partspec/electrical)
  requirements: string[];         // requirement-object ids (requirements ARE system objects, type='requirement')
  workTodos: string[];            // Todo ids implementing/building this object
  reviewState: 'none' | 'requested' | 'in_review' | 'approved' | 'changes_requested';

  createdAt: string; updatedAt: string;
}
```

Reuse map: `parentId/order` ← todo-store; `type` ← agent-profiles registry pattern;
`artifacts[]` ← ArtifactManager ids; `workTodos[]` ← `Todo.id` (and `Todo.link` back); `reviewState`
← escalation/decision-relay; `designStatus` revision ← PLM/decision-record lifecycle.

### 3.2 How preset TYPES work — **registry, not closed enum**

Follow agent-profiles exactly (`agent-profiles.ts:54-87`): a **global registry of type definitions**,
**extensible per-project** via `.collab/project.json`. Each type definition is a *schema-per-type*:

```ts
interface SystemObjectType {
  key: string;                         // 'robot','axis','sensor','api','ui','library','requirement','part'
  domain: 'software' | 'mechanical' | 'electrical' | 'requirements' | 'cross';
  attributeSchema: JSONSchema;         // validates SystemObject.attributes
  allowedChildTypes: string[] | '*';   // composition rule: Robot ⊃ {axis,sensor,controller,harness}
  requiredArtifacts?: string[];        // e.g. part ⇒ a 'partspec'; axis ⇒ an 'electrical' diagram
  defaultLinks?: string[];             // e.g. component ⇒ expects ≥1 'satisfies' to a requirement
}
```

- **Closed enum? No.** A closed enum cannot span SaaS+CAD+robotics and cannot be extended by a
  project. **Registry + per-project schema-per-type** is the right call — it's the proven
  agent-profiles mechanism applied to "what we're building" instead of "who builds it."
- **Composition constraints** come from `allowedChildTypes` (a Robot contains Axes/Sensors;
  an Axis contains Motor/Encoder/Driver). Validated on add-child — the same way `PATH_RULES`
  classify, but here the rule lives on the type def.
- Software types (`api/ui/library`) deliberately **reuse the agent-profile type keys** so a
  system object of type `ui` can resolve directly to the `ui` worker profile when its `workTodos`
  spawn — closing the loop between "the UI we're building" and "the agent that builds UI."

### 3.3 Relation to the existing work-graph — **the crux: two orthogonal trees, linked**

Recommendation: **keep them orthogonal, link them — do NOT merge.**

- The **system-object tree** answers *"what are we building?"* (durable structure of the product:
  Robot ▸ Axis ▸ Motor; App ▸ API ▸ Endpoint). It is long-lived, revisioned, and survives across
  many work cycles.
- The **work-graph (epics/todos)** answers *"what work, in what order, by whom?"* (ephemeral,
  claimed, leased, completed, rolled-up). It churns constantly.

They are different lifecycles (a released Axis still exists after its build todos are `done`),
so collapsing them would force one to inherit the other's lifecycle awkwardly. Instead:

- A todo gains an optional `systemObjectId` (mirroring existing `link`/`blueprintId`/`targetProject`
  pattern, todo-store.ts:32/38/45) → "this work builds/changes that object."
- A system object's `workTodos[]` is the reverse index.
- **Epics map to subtrees**: the "everything belongs to an epic" invariant (todo-store.ts:570) is
  preserved by letting an epic *target a system object subtree* — work on the Robot's Axis subtree
  rolls up to one epic. This reconciles the MEMORY invariant with the new tree cleanly.
- Decision-record constraints already carry `epicId`; add `systemObjectId` scope so "parent
  constraints" (max payload, voltage rail, API contract) attach to the object and **propagate to
  child objects** — a true SysML-style constraint allocation.

### 3.4 Reviews, spec sheets, electrical diagrams, parts lists

- **Human review request**: `reviewState` on the object + an escalation (existing `escalation_create`
  / decision-relay path). Reviewing a *released* revision = PLM-style sign-off; the approver lands in
  `approvedBy` (decision-record pattern). The fleet/graph UI already renders `danger`/escalation state,
  so a review-pending object is a small extension of an existing node decoration.
- **Part spec sheets**: a new artifact type `partspec` (PDF/embed) under the existing ArtifactManager
  base — `attributes` of a `part` object hold the structured fields (mfr, P/N, rating); the sheet is
  the attached source-of-truth document with version history for free.
- **Electrical diagrams**: an attached `diagram`/`design` artifact (or a new `electrical` type) on an
  Axis/Harness/Board object. Same recursive container as mechanical — no new tree.
- **Parts list (BOM)**: *derived*, not stored. Walk the subtree, sum `multiplicity` per leaf `part`
  type → a generated `spreadsheet` artifact (collab already has `create_spreadsheet`). The BOM is a
  **view over the tree**, which is exactly the BOM mental model.

### 3.5 Multi-domain spanning

One primitive, many type-registries:

- **SaaS**: `app ▸ {api, ui, library, service}` — types reuse agent-profile keys; `workTodos`
  resolve to matching worker profiles; artifacts are designs/diagrams/snippets; `targetProject`
  routes work to the right repo.
- **Robotics**: `robot ▸ {axis ▸ (motor, encoder, driver), sensor, controller, harness}` — artifacts
  are CAD designs + electrical diagrams + partspecs; constraints (payload/voltage) propagate;
  a `cad` worker profile (already supported via project manifest) builds CAD `workTodos`.
- **Requirements**: `requirement` is just another object type, linked via `satisfies`/`verifies`
  to components and tests across both domains — the digital thread is the union of these typed links.

A robot project and a SaaS project are then the **same database with different type registries and
different attached artifact kinds** — which is precisely the "company-wide platform" goal.

---

## 4. Hardest open questions / risks

1. **Object vs work-graph boundary discipline (the crux).** Orthogonal-but-linked is clean in theory,
   but every feature will tempt a merge ("just make the Axis a todo"). Risk: the two trees drift out of
   sync, or users can't tell which tree to edit. Needs a hard, enforced rule for *what lives where* and
   a single UI that shows both layers without conflating them.

2. **Type registry governance & evolution.** Per-project schema-per-type extension is powerful but
   unbounded — who owns the global types, how do `attributeSchema` migrations work when a type changes,
   and how do two projects with divergent `axis` definitions interoperate company-wide? Without
   versioned type schemas this becomes an un-migratable swamp (the PLM "attribute explosion" failure mode).

3. **Instance vs type vs revision (the three-way split).** SysML/PLM keep type-definition,
   instance-in-assembly, and revision distinct. Collapsing them (as the seed "object has a type and
   children" implies) is simple but loses where-used, reuse of a shared library component across two
   robots, and revision effectivity. Deciding how much of that 3-way model to adopt up front is the
   biggest scope risk — too little blocks reuse, too much reproduces a PLM system.

4. **Multiplicity & BOM truth.** If a Robot "contains 6 Axes," are those 6 distinct objects (6 rows,
   each individually reviewable/serviceable) or one object with `multiplicity: 6`? Both are needed in
   different views (logical eBOM vs physical mBOM). Picking one storage model and deriving the other is
   non-trivial and affects review, work-routing, and cost roll-up.

5. **Constraint propagation semantics.** "Parent constraints flow to children" sounds clean but needs
   real rules: does a child *inherit*, *override*, or *must-satisfy* a parent constraint? Wrong
   semantics silently produces invalid designs (a sub-Axis exceeding the Robot's voltage rail). This is
   the SysML allocation problem and has no cheap answer.

6. **Cross-domain artifact/tooling sprawl.** CAD, ECAD, and spec-sheet rendering are heavy, domain-specific
   surfaces; collab's strength is lightweight mermaid/markdown/React artifacts. Over-reaching into
   full CAD/ECAD editing risks diluting the core. Likely answer: collab is the **index + digital-thread
   + work-orchestrator**, and *links out* to domain tools (build123d, KiCad) rather than embedding them.
