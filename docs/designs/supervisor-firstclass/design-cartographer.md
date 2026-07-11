# The Cartographer — per-project reverse spec-sync

> **Status:** design (winner: `gated-proposal-inbox`, grafted per judge). Local-first, single-user, **per-project**.

## 1. Vision + Name

The forward flow is built: requirements (a spec) → Planner **Orients** on them → human + Planner author todos → workers build → gates verify → a verify-edge traces back to the requirement. The spec is authored **forward and manually only**. The gap is the **reverse**: keep the spec honest about what is *actually* being built (work-graph) and bootstrap a spec for a repo that has code but none.

**Name: Cartographer.** The territory (code + work-graph) already exists; the Cartographer draws the *map* (spec = requirements + system-objects + edges) and flags where the existing map disagrees with the ground. It is the **dual of the Planner** (who navigates *by* the map) and never usurps the Planner's authoring authority. Surveyor is too literal; Reverse-Planner names the mechanism, not the value.

**The product is the GATE, not the inference.** Every signal the system would infer from is *already recorded* (`Todo.objectRef`, the `coverage` LEFT JOIN, `staleObjectIds`, epic `parentId`/`dependsOn` clusters). The hard problem is **not drowning the human**: a reverse-planner that emits one proposal per uncovered object trains the human to bulk-dismiss the Requirements Inbox — and real proposals die with the noise, rotting the spec *faster* than no tool at all. So the design is a **single human-gated proposal pipeline** fed by **interchangeable, hallucination-ranked inference plugins**, with a **pre-write batch sheet** that lets the human reject *before* anything touches the DB. The Cartographer earns each interruption.

## 2. Role model, scoping, relation to other roles

**Cartographer is per-project and stateless** — a pure function of `project` (the cwd root), threading the same `project` arg as `decision-record-store` (`openDb`), `system-object-store` (`getStoreDb`), and `todo-store`. No global identity, no `register_supervisor`, no daemon registration. Two projects = two independent invocations over two `.collab/*.db` sets.

**It is not a new global-feeling role.** Per the fold (planner-reverse-mode): the **`sync` / `health` path is implemented as an optional Planner Step 1.5 (Reconcile)** — it runs the deterministic detectors on the Orient read *already in context* and surfaces candidates into the **existing Step-4 plan-approval gate**. This inherits the Planner's settled answers (per-project, human-invoked skill, no daemon, one gate) and adds zero new role/identity. The **`bootstrap` (code→spec) cold-start gets one explicit verb** because it does not fit mid-plan.

| Role | Lifecycle | Identity | Relation to Cartographer |
|---|---|---|---|
| **Planner** | on-demand skill | per-project | **It IS the Planner.** Forward = Orient→Plan→approve; reverse = Reconcile→propose→*same* approve. Cartographer produces the `proposed` records the Planner later consumes once human-approved. |
| **Coordinator** | per-project daemon | per-project | **None / orthogonal.** Cartographer never touches `ready`/claim/execution. Only timing dependency: don't reconcile mid-execution churn (objectRefs in flight → false orphans). |
| **Steward / Supervisor** | global daemon/session | global, role-keyed (`register_supervisor`) | **Explicitly unlike.** No global state, no role registration, no always-on observe loop. |

## 3. Trigger model — on-demand, **no daemon**

Reject the daemon (the judge dropped `coverage-drift-daemon`). Three grounded reasons:
1. **Drift is slow.** Steward/Coordinator daemons earn their cost reconciling *live sessions* that drift per-heartbeat. Spec-vs-reality drift accrues over a work session, not a tick — a timer buys only churn plus a process to babysit, plus a Coordinator-quiesce interlock and watchdog for no gain.
2. **The proposal target is human attention,** present only at planning time. A proposal generated at 3am goes stale before it's read. Generate *when the human is at the wheel*.
3. **Reuse the pull-based gate that exists.** Proposals are `proposed` decision-records in the Requirements Inbox — already a surface the human opens. A daemon bolts a push channel onto work that doesn't need one, and its timer-driven auto-escalation is the very flood it claims to avoid.

**Entry points:**
- **Planner Step 1.5 (Reconcile)** — runs the *deterministic* detectors automatically inside every Orient pass. Fires nothing → prints "spec in sync," Planner proceeds, zero LLM, zero cost. Fires → drafts candidates that ride into the Step-4 gate.
- **`/cartographer sync`** — explicit Journey-A run (e.g. after a `/vibe-go` wave settles).
- **`/cartographer bootstrap`** — Journey B (code→spec), one-shot cold-read, never automatic.
- **`/cartographer health`** — read-only summary, proposes nothing (also the Step-1.5 / Step-0 callout payload).

## 4. Inference — pluggable detectors, ranked by hallucination risk (lowest first)

Each plugin is a **deterministic pre-filter that gates an LLM step**. The deterministic layer bounds the candidate count *before* any LLM sees data — three of four plugins need no LLM at all. All candidates funnel into one ranked, deduped, capped, provenance-stamped stream.

### Mode 1 — TODOS → SPEC (`sync` / Step 1.5)

Read seam (all existing, all per-project): `listTodos(project,{includeCompleted})`, `getActiveRequirements`, `listDecisionRecords({kind:'requirement'})`, `listObjects`, `listEdges({kind:'satisfy'})`, `coverage`, `staleObjectIds`.

**Plugin A — `driftCheck` (zero LLM, highest signal, ship first).** `staleObjectIds(project)` already returns objects whose satisfy/verify proof went stale on a content-hash bump and was never re-authored — a recorded structural fact: "Requirement R was satisfied by object O; O changed; R may be stale." Proposal = a supersede **candidate** (created `proposed`, tagged "supersedes R"). The Cartographer **never calls `supersedeDecisionRecord` itself** — the actual supersede + `markStaleForRequirement` fires only from the human's Inbox-approve handler.

**Plugin B — `inverseCoverage` (zero LLM).** `coverage()` gives the forward gap (active requirements with no satisfy/verify path). The new query is its inverse: a `done` todo with `Todo.objectRef != null` whose object has **no active satisfy edge**.

> **CRITICAL edge-key semantics (only this concept got it right):** the `satisfy` edge stores the built object on **`aboutObjectId`** (not `srcId`), and `coverage` matches the requirement via `dstId` with `status='active'` and stale excluded. The inverse-coverage query MUST therefore be:
> ```sql
> SELECT t.objectRef FROM todos t
> LEFT JOIN edges e
>   ON e.aboutObjectId = t.objectRef AND e.kind='satisfy' AND e.status='active'
> WHERE t.status='done' AND t.objectRef IS NOT NULL AND e.id IS NULL
> ```
> If the todo's epic has **exactly one** active requirement → propose `satisfy(project, objectRef, reqId)` directly (structural fact, near-zero hallucination — **the dominant output**). Zero or many → **don't guess**; downgrade to a Plugin-C question.

**Plugin C — `todoCluster` (LLM, gated — the dangerous one).** A todo is not a requirement. A cluster (shared epic `parentId`, or a `dependsOn`-connected component) qualifies only when **all** hold: ≥3 todos, mostly `done`/`in_progress` (never reverse-spec speculative `planned` work), shares a structural anchor, and **zero active requirement `linkedTodos`-links into it**. Only then does an LLM read the cluster's titles + `files` and draft **one** requirement title + `spec {metric, op, target}` — **and only if a measurable target is genuinely inferable. If not, propose a `constraint` instead. Never fabricate a metric number; a hallucinated `{metric,op,target}` is worse than no requirement.** Write on approval: `createDecisionRecord(project,{kind:'requirement', epicId, title, rationale, spec, linkedTodos, authorSession:'cartographer'})` → lands `proposed`.

### Mode 2 — CODE → SPEC (`bootstrap`, LLM, structural-signals-first)

Adopt the inviolable grounding rule verbatim (the hallucination firewall):
1. **Boundaries → object tree (safest, propose generously).** `package.json`/workspace members, top-level `src/` dirs, MCP tool registrations, entry points (`bin`/`main`/server bootstrap) → `upsertType(project, …)` with a small fixed vocabulary (`service`/`module`/`domain`/`endpoint`), then `createObject(project,{typeId,name,parentObjectId})` mirroring the directory/composition hierarchy. **Every proposed object carries `provenance = <real file or dir path>`; an object with no backing path is DROPPED, not guessed.**
2. **Tests/docs as evidence → requirements (propose stingily).** Test `describe`/`it` blocks are behavioral assertions already written down — the best first-pass requirement source (`it('rejects unapproved constraint')` → a requirement). README/CLAUDE.md headings → constraints. **Each requirement anchored to a concrete test or explicit doc line, or DROPPED.**
3. **Map requirements to objects** → propose `allocate(project, reqId, objectId)` where obvious.
4. **Cap hard:** ≤1 object-type per top-level module, ≤~10 requirements. Object tree generously (trivially fixed), requirements stingily (load-bearing). Human approves the *skeleton* before any depth.

## 5. Proposal surface + human-gate + provenance + supersede

**One channel, no new gate, no new store.** Everything lands as `proposed` decision-records (requirement/constraint) and proposed-tier objects/edges, surfaced in the **existing** `RequirementsInbox.tsx` (approve/edit/reject already exist) and `SpecSheetPane.tsx`.

**The pre-write batch sheet (grafted from `on-demand-skill`).** The skill/Step-1.5 computes the *full* candidate set, ranks/caps/dedupes, and presents **one** review pass listing each candidate with its kind, **provenance**, confidence, and the exact write it will perform — **rendered through the existing Inbox ghost rows / SpecSheet ghost nodes, NOT a parallel `render_ui` surface** (avoids UX divergence). The human approves/edits/rejects **per line, before any DB write.** Only survivors are written. This is strictly stronger anti-flood than "land ghosts then drain," and it removes the need for a `dismissed` marker *on the happy path* — `dismissed` persists only for cross-run idempotency of things the human explicitly killed.

- **Requirements / constraints** → ghost-styled in the Inbox via the discriminator `authorSession:'cartographer'` (**field already exists — zero schema change**) → source badge + **mandatory provenance line** ("inferred from T-1, T-2, T-3" / "from src/x/foo.test.ts"). Without provenance the human can't triage and will dismiss-flood.
- **Objects / edges** (bootstrap tree, satisfy-edges) → **ghost nodes in `SpecSheetPane.tsx`** so the human sees the *shape* before approving. Zero-migration MVP: a `cartographer:` name-prefix rendered dashed. Cleaner (Phase 3): one small migration — a `proposed` boolean on `instances`/`edges`, promoted by clearing the flag.
- **Escalation card** (`escalation_create`, BR-4 `escalation-ui-schema.ts`) reserved for the **one** case where silence has a cost: a Plugin-A drift/stale supersede on an *active* requirement the Planner is about to plan against. Everything else waits passively. **One card per run with counts**, never one-per-proposal.

**Human-gate law (non-negotiable, already enforced by the store):** nothing the Cartographer emits is ever `active`. `initialStatus()` returns `proposed`; promotion is exclusively `approveDecisionRecord(project, id, approvedBy)`. **Supersede-on-change** (approving-with-edits, or any change to an active requirement) creates the successor and fires `supersedeDecisionRecord` + `markStaleForRequirement` **from the Inbox approve handler** — the Cartographer only feeds the proposed successor. The spec the Planner plans against never silently mutates.

## 6. Noise control / anti-flood (the spine)

1. **Triage before write** (batch sheet) — the Inbox never fills with un-glanced proposals. Load-bearing.
2. **Deterministic gate before any LLM** — no structural delta → no LLM call → no spend → no card. Three of four plugins never call an LLM.
3. **Dedupe + persisted rejection** — before any write, scan `listDecisionRecords({kind, status:'proposed'})` and skip near-duplicates (same `epicId` + `linkedTodos`/`objectRef` overlap). A rejected proposal stays dead across runs (`dismissed` marker) so re-runs never re-flood.
4. **Rank + cap, don't dump** — ranked shortlist (top K=5), `driftCheck > inverseCoverage > todoCluster`. A run that *could* emit 40 emits 5 and notes "35 more, lower confidence."
5. **Quiet by default** — nothing clears the bar → "spec is in sync," zero writes. A reverse-planner that usually does nothing is working correctly.
6. **When NOT to propose** (codified in SKILL.md): speculative `planned`-only clusters; objects under active churn (recent revision bump — let settle); anything already proposed/rejected; clusters already requirement-linked; `[spike]`/`[chore]` or `Inbox`/`Bugfix-inbox` epics (skip entirely); satisfy-edges where the epic has zero or many active requirements (ask, don't guess); during active Coordinator execution (run Mode 1 only against a quiesced graph); bootstrap items with no artifact/path anchor.

## 7. Beyond the two asks

1. **Drift/STALE surfacing (Plugin A) first** — surfaces the *already-built* `staleObjectIds`/`markStaleFor*` machinery as supersede proposals. Highest value, lowest hallucination.
2. **Inverse coverage (Plugin B)** — completes the bidirectional `coverage` story; the missing-edge proposal is the single highest-signal, lowest-risk output and should dominate.
3. **Provenance on every proposal** — todo ids / `file:test`. Mandatory triage enabler.
4. **Read-only `health` summary** — `#uncovered requirements`, `#orphan objects`, `#stale edges` from `coverage` + `staleObjectIds`. Lets the human gauge drift magnitude and decide whether to reconcile; the natural Step-1.5 / Planner Step-0 callout.
5. **Per-run observability** — detector counts to a per-project `.collab` log (reuse the `attempts/*.json` pattern), so "found nothing new" vs churn is visible without a daemon.

## 8. Technical plan

**Reuse (zero change):** `createDecisionRecord` / `approveDecisionRecord` / `supersedeDecisionRecord` / `getActiveRequirements` / `listDecisionRecords` / `initialStatus` (the proposed→approved gate — **adds zero new gate**); `createObject` / `upsertType` / `newRevision` / `listObjects`; `satisfy` / `allocate` / `derive` / `coverage` / `staleObjectIds` / `listEdges` / `markStaleForObject` / `markStaleForRequirement` (edges key on **`aboutObjectId`**); `listTodos` + `Todo.objectRef`/`parentId`/`dependsOn`/`status`; `escalation_create` + `escalation-ui-schema`; per-project openers `openDb`/`getStoreDb`; `RequirementsInbox` / `SpecSheetPane` / `SpecCoverageCard` / `RequirementChip`; the **Planner skill + its Step-4 gate**.

**New:**
- `src/services/cartographer.ts` — pure detector functions `specHealth(project)`, `driftCandidates(project)`, `inverseCoverage(project)`, `todoClusters(project)` → typed `ProposalCandidate[]` (`stale-proof` | `missing-satisfy-edge` | `uncovered-requirement` | `unspecd-cluster`) carrying `provenance`, `confidence`, and a `write` thunk. **Zero writes.** Unit-tested like the existing `*-store.test.ts`.
- MCP verbs: `cartographer_sync`, `cartographer_health`, `cartographer_bootstrap`, plus `propose_edge` / `list_system_objects` for edge proposals.
- `skills/cartographer/SKILL.md` — `sync` / `bootstrap` / `health`; `allowed-tools`: Read/Grep/Glob + `list_session_todos`, `list_decision_records`, `get_active_requirements`, `create_decision_record`, `supersede_decision_record`, `escalation_create`, `cartographer_*`. Codifies §6 "when not to propose."
- `skills/planner/SKILL.md` — **Step 1.5: Reconcile** between Orient (Step 1) and Plan (Step 2): run the deterministic detectors on the in-context read; surface into the Step-4 gate.
- `RequirementsInbox.tsx` — `authorSession:'cartographer'` ghost badge + provenance line + batch-dismiss-by-source.
- `decision-record-store.ts` — a `dismissed` marker for persisted cross-run rejection.
- `SpecSheetPane.tsx` — ghost-node rendering + "suggested edges" affordance.
- Optional one migration: `proposed` boolean on `instances`/`edges` (true ghost nodes; deferred to Phase 3).
- Per-project run log via the `.collab/attempts` pattern.

**Phased order (each ships standalone; Phase 1 is the 80/20):**
- **Phase 1 — drift + inverse-coverage (deterministic, no LLM, no daemon, no new gate).** `cartographer.ts` detectors + `cartographer_sync`/`cartographer_health` returning the ranked structural shortlist (missing satisfy-edges; stale supersede candidates). `authorSession` ghost badge + provenance + batch-dismiss in `RequirementsInbox.tsx`. **Dogfood this alone — zero hallucination; if only Phase 1 ships, the honest-spec win is delivered.**
- **Phase 2 — `todoCluster`→requirement (LLM, gated) + the fold.** Plugin C behind the structural bar; provenance; dedupe + persisted `dismissed`. `skills/cartographer/SKILL.md`; wire Planner **Step 1.5**.
- **Phase 3 — `bootstrap` (code→spec).** Structural read → ghost object tree + artifact-anchored requirements, capped, every node path-anchored. `SpecSheetPane.tsx` ghost nodes + optional `proposed`-boolean migration + source filter in the Inbox.
- **Phase 4 — observability + the single Plugin-A escalation card.** One `escalation_create` per run (drift-on-active only); per-project run log.

## 9. Why over alternatives, top risks

**Why gated-proposal-inbox (winner) + grafts.** It is the cleanest articulation of the real product (the **gate**, not the inference), and the only concept that got the `aboutObjectId` edge-key semantics exactly right — getting that wrong silently breaks the dominant Phase-1 output. Grafted: the **pre-write batch sheet** (`on-demand-skill`) as a strictly stronger anti-flood; the **Planner Step 1.5 fold** (`planner-reverse-mode`) to avoid a new global-feeling role and inherit the Planner's settled per-project/no-daemon/one-gate answers; the **verbatim path/artifact grounding rule** (`codebase-cartographer`) as the bootstrap hallucination firewall. **Dropped:** the daemon and its timer-driven auto-escalation (the flood it warns against); its lone good idea (journal observability) survives as the cheap `.collab` run-log. **Dropped:** a bespoke parallel `render_ui` batch surface — render through the existing Inbox/SpecSheet instead.

**Top risks:**
1. **Edge-key correctness.** The inverse-coverage query MUST key `satisfy` on `aboutObjectId` (with `coverage` matching the requirement via `dstId`, stale excluded). Get this wrong and Phase 1 silently mis-reports orphans. *Mitigation:* unit-test against `system-object-edges.test.ts` fixtures first.
2. **Bootstrap hallucination.** Mode 2 is the highest-variance mode. *Mitigation:* the inviolable drop-if-unanchored rule + the ≤10 cap + ship it last (Phase 3), only after Phase 1 proves the human triages rather than dismiss-floods.
3. **Step-1.5 bloating the Planner pass.** Detectors must stay pure/cheap and quiet-by-default; if they ever block or chatter mid-plan, the human disables Reconcile. *Mitigation:* deterministic-only in-pass; LLM synthesis only on explicit `/cartographer sync` or an opt-in prompt.
