# Design A — The Unified Tree

> Position paper. There is **one tree**. The *system object* is the only structural
> primitive. "Work" is not a second graph — a unit of work is a **facet of a system
> object**: the same node, viewed through its lifecycle. "What we are building" and
> "what work to do" are the same structure seen two ways.
>
> This deliberately argues *against* the research note's "orthogonal-but-linked, do
> NOT merge" recommendation, and shows the merge is not only possible but cheaper —
> *provided* we separate **node identity (durable)** from **a leased work-facet
> (ephemeral)** living on that node. That single discipline is the whole design.

---

## 0. The one-sentence thesis

A todo is what a system object *looks like while it is being brought into existence
or changed.* You do not "build a Robot, then separately track six todos." You create
the Robot node and its Axis children in a `proposed` lifecycle state; bringing an Axis
to `released` **is** the work. The DAG, the waves, the leases, the acceptance gate, the
agent-profile routing — all of it operates on nodes of the one tree. There is nothing
left over to put in a second graph.

---

## 1. Core schema

One record type. It absorbs `Todo` (todo-store.ts:19-52) and the proposed
`SystemObject` into a single node. Fields are grouped by *facet* so the durable
structure and the ephemeral work-lease are visibly separated on the same row.

```ts
type Lifecycle =
  | 'proposed'      // exists as intent; not yet planned/designed
  | 'planned'       // accepted into scope, sequenced (was: todo 'planned')
  | 'ready'         // deps satisfied, promotable by Planner only (gate preserved)
  | 'in_progress'   // a worker holds the lease and is building/changing it
  | 'in_review'     // built; awaiting acceptance gate + (optional) human review
  | 'released'      // accepted, revisioned, durable — the "done" of a real thing
  | 'blocked' | 'obsolete' | 'dropped';

interface SystemNode {
  // ── identity (durable) ────────────────────────────────────────────────
  id: string;
  project: string;
  parentId: string | null;        // ONE composition tree (was Todo.parentId + epic)
  type: string;                   // registry key: 'robot'|'axis'|'api'|'ui'|'requirement'|'part'|'epic'…
  name: string;
  order: number;
  multiplicity: number;           // BOM quantity on edge to parent (default 1)
  revision: string;               // PLM rev ('A'.. / semver); bumped on each release cycle

  // ── what it IS (durable spec) ─────────────────────────────────────────
  attributes: Record<string, unknown>;   // validated by type.attributeSchema
  artifacts: string[];                    // ArtifactManager ids: docs/diagrams/designs/partspec/electrical
  links: Array<{ rel:'satisfies'|'verifies'|'allocates'|'interfaces'; targetId:string }>;

  // ── lifecycle = the unification point ─────────────────────────────────
  lifecycle: Lifecycle;           // single status replacing TodoStatus AND designStatus
  dependsOn: string[];            // DAG over nodes (was Todo.dependsOn) — drives waves

  // ── work-facet (EPHEMERAL: only meaningful while in_progress) ──────────
  work: WorkFacet | null;         // null unless a build/change cycle is active

  // ── review / acceptance ───────────────────────────────────────────────
  acceptanceStatus: 'pending'|'accepted'|'rejected'|null;
  reviewState: 'none'|'requested'|'in_review'|'approved'|'changes_requested';

  createdAt: string; updatedAt: string;
}

// The ENTIRE ephemeral work-graph, isolated onto one nullable sub-object.
// When work completes and the node releases, this is cleared/archived to history —
// the durable node survives untouched. This is the durable/ephemeral firewall.
interface WorkFacet {
  changeKind: 'create' | 'revise' | 'fix' | 'verify';
  targetProject: string | null;   // repo the change lands in (todo-store.ts:41-45)
  ownerSession: string;
  assigneeSession: string | null;
  claimedBy: string | null; claimToken: string | null;
  claimedAt: string | null; claimLeaseMs: number | null;
  retryCount: number;
  openedAt: string;
}
```

Nothing in the current work-graph is lost — every `Todo` field has a home:
`parentId/dependsOn/order/targetProject/acceptanceStatus/claim*` all carry over verbatim;
`Todo.type` becomes the node's type (richer than before); `Todo.status` and the proposed
`designStatus` **collapse into one `lifecycle`** (that collapse is the thesis).

---

## 2. Lifecycle / work-state lives ON the node

The status field a worker reads and writes *is* the node's lifecycle. The mapping is exact:

| Today's `TodoStatus` | Unified `lifecycle` | Meaning on a system node |
|---|---|---|
| backlog / planned | proposed / planned | intent exists; in scope, not started |
| ready | ready | deps satisfied; **Planner-only** promotion gate (unchanged) |
| in_progress | in_progress | a worker holds `work.claimToken`; building this node |
| blocked | blocked | a dep or rejected acceptance holds it |
| done | released | accepted + revisioned; the thing now durably exists |
| dropped | dropped/obsolete | out of scope / superseded revision |

The `work` sub-object is populated only on the transition `ready → in_progress` (the
Coordinator opens a WorkFacet, sets the lease) and **cleared on `→ released`** (lease
archived to node history). So the node is durable; the *lease is a transient state of
the node*, not a separate entity. A released Axis simply has `work: null` and
`lifecycle:'released'` — it still exists, exactly as a PLM part does after its build
order closes. This directly answers the research note's strongest objection ("a released
Axis still exists after its build todos are done"): yes — and it sits in `released` with
no open work-facet. The lifecycle *is* what survives.

**Revisions reuse the same machinery.** Changing a released Axis = bump `revision`,
re-open a WorkFacet with `changeKind:'revise'`, transition `released → in_progress`. No
new todo entity is created; the node re-enters the same lifecycle loop. The build/change
cycle is idempotent and reusable — which a two-tree model has to special-case.

---

## 3. Types and allowed-children (registry, not enum)

Identical mechanism to agent-profiles (agent-profiles.ts:54-87): a **global registry of
type definitions, extended per-project** via `.collab/project.json`. We deliberately reuse
the agent-profile keys for software types so a node *is* routable.

```ts
interface NodeType {
  key: string;                       // 'robot'|'axis'|'api'|'ui'|'library'|'requirement'|'part'|'epic'
  domain: 'software'|'mechanical'|'electrical'|'requirements'|'organizational';
  attributeSchema: JSONSchema;       // validates SystemNode.attributes on write
  allowedChildTypes: string[] | '*'; // composition rule, validated on add-child
  agentProfile?: AgentProfileType;   // type → worker profile, when this node spawns work
  requiredArtifacts?: string[];      // part ⇒ 'partspec'; axis ⇒ 'electrical'
  isContainer?: boolean;             // pure roll-up node (epic) vs buildable leaf
}
```

- `allowedChildTypes` is the composition grammar: `robot ⊃ {axis,sensor,controller,harness,epic}`;
  `axis ⊃ {motor,encoder,driver}`; `api ⊃ {endpoint,library}`. Validated the way `PATH_RULES`
  classify today, but the rule lives on the type def.
- `agentProfile` closes the loop the research note only *links*: a node of type `ui` resolves
  through `resolveProfile('ui', project)` (agent-profiles.ts:73) when its WorkFacet spawns — the
  thing-being-built and the agent-that-builds-it share one key. With two trees this is a join;
  here it is a field read.

---

## 4. Mapping table — today's concept → unified equivalent

| Today | Unified-tree equivalent | Preserved how |
|---|---|---|
| `Todo` row | A `SystemNode` whose `lifecycle ≠ released` and/or has an open `work` facet | every field carried over (§1) |
| Epic | A `SystemNode` with `type:'epic'`, `isContainer:true` | roll-up reused (§5) |
| **Epic-belongs invariant** | Every node has a `parentId` chain ending at a `type:'epic'` (or a domain root that *is* a container) | one validation, same rule |
| `dependsOn[]` + wave scheduling | `SystemNode.dependsOn[]`; waves = topo-levels over `ready` nodes | identical algorithm, same field |
| Planner promotes to `ready` | Only the Planner sets `lifecycle:'ready'`; Coordinator never self-promotes | gate unchanged (todo-store.ts:560-568) |
| Agent-profile routing | `node.type → NodeType.agentProfile → resolveProfile()` | field read, not a join |
| Claim / lease / retry | `WorkFacet.claim*/retryCount` | verbatim, scoped to the work-facet |
| Acceptance gate | Runs on `in_progress → in_review`; `acceptanceStatus` on node; rejected ⇒ `blocked` | verbatim |
| `targetProject` (cross-repo) | `WorkFacet.targetProject` | verbatim — cross-domain work still routes per-repo |
| Decision records / constraints (`epicId` scope) | scope key becomes `nodeId`; constraints **propagate down the one tree** to children | strictly more powerful (§6) |
| Artifacts (docs/diagrams/designs/spreadsheets) | `node.artifacts[]` via ArtifactManager; + `partspec`,`electrical` types | base class reused (artifact-manager.ts:44) |
| Fleet graph (Epic/Todo/Worker nodes) | One node taxonomy keyed by `type`; worker = a node in `in_progress` with a live `work` lease | same React Flow surface, one node kind |

### 4.1 Wave scheduling — unchanged, proven

The Coordinator's loop is byte-for-byte the same: select nodes where `lifecycle==='ready'`
and all `dependsOn` are `released`, claim them by writing a `WorkFacet`, spawn a worker
per the node's resolved profile. The epic roll-up (todo-store.ts:570-579) still fires:
when a container's every non-dropped child reaches `released`, the container releases and
recursion walks upward. The *only* change is the words ("done"→"released", "todo"→"node");
the dependency math, the promotion gate, and the roll-up are untouched.

---

## 5. Worked example A — Robot (hardware + control software in ONE tree)

```
robot:ArmBot                     [planned]   rev A
├─ epic:Bring-up Axis 1          [container]
│  └─ axis:J1                    [in_progress] rev A   profile→cad
│     ├─ motor:J1-Motor          [released]    rev B   artifacts:[partspec#m1]
│     ├─ encoder:J1-Enc          [in_review]   rev A   artifacts:[partspec#e1, electrical#sch1]
│     └─ driver:J1-Drv           [ready]       rev A   dependsOn:[J1-Motor]   ← wave edge
├─ sensor:WristForce             [proposed]    rev A
├─ harness:MainHarness           [planned]     artifacts:[electrical#harn1]
└─ epic:Control Firmware
   └─ library:motion-ctl         [in_progress] rev A   profile→library   targetProject=/repos/fw
      └─ requirement:R-12 "≤48V rail"  links:{allocates→axis:J1}   ← constraint propagates to J1 subtree
```

- The whole product is one tree: mechanical (`axis/motor/encoder/harness`), electrical
  (`electrical` artifacts on harness/axis), and firmware (`library`, built in another repo via
  `WorkFacet.targetProject`).
- `driver:J1-Drv` is `ready` with a dep on the released motor — that is a literal wave edge;
  the Coordinator schedules it exactly as a todo today.
- `requirement:R-12` is just a node of `type:'requirement'`; its `allocates` link + the
  tree-propagated voltage constraint flow into the J1 subtree (§6). The BOM is *derived* by
  walking the subtree summing `multiplicity` over `part`-domain leaves → a generated spreadsheet.

## 6. Worked example B — SaaS app (one tree, same loop)

```
app:Checkout                      [planned]
└─ epic:Coupon support
   ├─ api:coupons-endpoint        [in_progress] profile→api   targetProject=/repos/checkout-api
   │  └─ requirement:R-7 "idempotent POST"  links:{verifies→test:coupon-e2e}
   ├─ ui:CouponField              [ready]       profile→ui    dependsOn:[api:coupons-endpoint]
   └─ library:money               [released]    rev 2.1.0
```

Same node type, same lifecycle, same Coordinator. `ui:CouponField` is `ready` and depends on
the API node → standard wave. Each node resolves to its agent profile by `type`
(`api→api`, `ui→ui`) with no join. A SaaS project and the Robot project are **the same DB and
the same loop**, differing only in their type-registry and attached artifact kinds — which is
exactly the company-wide-platform goal.

### 6.1 Constraint propagation (one tree makes this natural)

Because there is a single parent chain, a constraint attached to a node has an unambiguous
scope: **its subtree**. `R-12 "≤48V rail"` on the Robot applies to every descendant Axis/Driver.
Semantics we adopt (must be explicit — see weakness #2):
- `inherit` (default): child sees the parent constraint as active.
- `must-satisfy`: child's attributes are validated against it (a sub-driver rated 60V ⇒ lint error).
- `override`: child may narrow but not widen (documented, requires human approval — reuses the
  decision-record constraint-approval path, decision-record-store.ts:15).

A two-tree model cannot do this cleanly: its constraints scope to *epics* (work), not to the
*structure*, so "applies to the whole Axis subtree" requires re-deriving structure from work links.

---

## 7. Honest tradeoffs and mitigations

The fusion has real costs. Stating them plainly:

**Weakness 1 — Durable node vs ephemeral lease on the same row (the big one).**
A released, revisioned part and a hot leased task now live in one record. Risk: a stale or
crashed lease "dirties" a durable node; history/audit of the *thing* gets tangled with the
churn of *work on the thing*.
*Mitigation:* the `WorkFacet` firewall (§1). All ephemeral fields live in one nullable
sub-object that is **null except during an active build/change cycle** and is archived to node
history on release. The durable node's identity/spec/revision never depend on `work`. A dead
lease is cleared by the watchdog (PID-liveness already exists, commit 63a59bd6) without touching
durable state. This is the single discipline that makes the merge safe — and it is one nullable
column, not a second table.

**Weakness 2 — Lifecycle overload.** One `lifecycle` enum must serve both "work status"
(in_progress/blocked) and "design maturity" (released/obsolete/revision). A node can be a
*released rev A* while *rev B is in_progress*.
*Mitigation:* lifecycle is the state of the **current/head revision**; superseded revisions move
to node history with their own frozen lifecycle. Re-opening a WorkFacet with `changeKind:'revise'`
bumps `revision` and transitions head to `in_progress`. So "released A + building B" is "head
node, rev B, in_progress, with a rev-A history entry." No second status field needed.

**Weakness 3 — Multiplicity vs distinct instances.** "6 Axes" as `multiplicity:6` (one
reviewable node) vs six rows (each individually serviceable/leasable) is a genuine fork, and work
naturally wants distinct rows while BOM wants the collapsed count.
*Mitigation:* store distinct nodes when any of {independent lifecycle, independent review,
independent work-lease} is needed; otherwise `multiplicity:n` on one node. A node can be "expanded"
(materialize n children) on demand when one instance first needs its own work-facet. eBOM = the
tree as stored; mBOM = the derived multiplicity-expanded view.

**Weakness 4 — Type-registry / schema governance.** With everything in one tree, an
`attributeSchema` migration touches durable nodes mid-flight.
*Mitigation:* versioned type schemas (`NodeType.key@v`); nodes pin the schema version they were
written under; migrations are explicit, node-by-node, and gate through the existing
constraint-approval path. (Equally a problem for two trees — not unique to unify.)

**Weakness 5 — UI conflation.** One tree can hide the "what are we building vs what's the work"
distinction users sometimes want separately.
*Mitigation:* one graph, two **lenses** over the same nodes — a "Structure" lens (composition,
revisions, artifacts; hides `work`) and a "Fleet/Work" lens (lifecycle color + live leases; the
current fleet surface, fleet/types.ts). Same nodes, two filters — cheaper than keeping two stores
in sync and *guaranteed* consistent because there is only one source.

---

## 8. Why unified beats two trees

1. **No sync problem, by construction.** The research note's own #1 risk is "the two trees drift
   out of sync / users can't tell which to edit." Unify deletes that risk: there is one store, one
   id space, one place to edit. The two-tree model spends its complexity budget on a join
   (`workTodos[] ↔ systemObjectId`) and an invariant ("keep them consistent") that has no enforcer.
2. **Routing is a field read, not a join.** `node.type → agentProfile` (§3) vs "look up the linked
   object's type, then resolve." Less indirection, fewer failure modes.
3. **Constraints scope to structure for free** (§6.1). The whole point of constraint propagation is
   "applies to this part and everything under it" — that *is* the subtree, which only the structure
   tree has. Two trees must re-derive it.
4. **Revisions reuse the work loop** (§2). Changing a released thing is the same lease/gate/release
   cycle, not a new entity type. Two trees must invent "a todo that revises an object" and re-link it.
5. **Everything already points one way.** Today `Todo` *already is* a typed tree+DAG with
   `parentId/dependsOn/type/targetProject/claim*` and epic roll-up (todo-store.ts). The unified node
   is `Todo` with a richer `type`, a durable spec, and the status renamed `lifecycle`. We are not
   building a second structure — we are admitting the structure we have *is* the system tree, and
   giving its nodes a durable spec and a clean ephemeral work-facet.

The honest core: two trees is the *safe* answer and the right call if we cannot enforce the
durable/ephemeral firewall. Unified is the *simpler* answer and the better call *because* that
firewall is one nullable sub-object plus a watchdog we already run — and in exchange we delete the
sync invariant, the routing join, and the revision special-case entirely.
