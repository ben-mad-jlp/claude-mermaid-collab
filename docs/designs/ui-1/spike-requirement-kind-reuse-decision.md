# Spike — requirement-kind fits Escalation/DecisionCard shape? (reuse-or-fork)

**Todo:** 67e5ec5b · de-risk the P0 reuse bet · gates leaf H's build approach.
**Ref:** design-system-object-ui §3, §9.

## TL;DR — **Split decision: REUSE the render layer, FORK the inbox container.**

The "reuse vs fork" question is not one decision — there are two independent layers, and they answer differently:

| Layer | File(s) | Verdict |
|-------|---------|---------|
| **JSON-render catalog + Renderer + DecisionCard body** | `focal/catalog.ts`, `focal/Renderer.tsx`, `focal/DecisionCard.tsx` | ✅ **REUSE as-is — no new catalog entry needed** |
| **Inbox container (`BridgeEscalationInbox`)** | `BridgeEscalationInbox.tsx` | ❌ **FORK — cannot reuse verbatim** |

So leaf H should: **render a requirement with the existing closed catalog, but mount it in a new `RequirementInbox`/`DecisionRecordInbox` container bound to the decision-record store, not reuse `BridgeEscalationInbox`.**

---

## Why the render layer REUSES cleanly (no catalog fork)

The closed catalog (`catalog.ts`, 10 elements, `z.strict()`, ≤40) already carries every visual a requirement needs. The requirement's data maps onto existing elements with **zero new element types**:

| Requirement piece | Existing catalog element |
|-------------------|--------------------------|
| chip `{metric, op, target}` | `KeyValue{pairs}` (or inline `Text`) — e.g. `metric: p95_latency_ms`, `op: <=`, `target: 200` |
| `source` / `rationale` | `Text` + `Callout{tone:'info'}` |
| proposed → approved action | `OptionButton{optionId:'approve', recommended}` (+ a 2nd `OptionButton` for "request changes") |
| supersede **CHANGED diff** (old spec vs new) | `CompareTable{columns,rows}` for old-vs-new metric rows, **or** `DiffView{filename,before,after}` for a literal before/after block |

`DecisionCard.tsx` consumes `escalation.ui` through `parseUiSpec()` → `<Renderer>`, falling back to `options[]`. That render path is **kind-agnostic** — it renders whatever validated `JsonRenderSpec` it's handed. Feed it a requirement-shaped spec and it Just Works. **No catalog entry to add.** (Only reach for a new element if product wants a dedicated "requirement chip" affordance richer than `KeyValue` — not required for H.)

## Why the inbox container must FORK

`BridgeEscalationInbox` is welded to the **Escalation** type and its resolve path; a requirement lives in a **different store with a different lifecycle**:

- **Different store/type.** Inbox takes `Escalation[]` (`supervisor-store.ts` L40–71: `options/recommended/ui/status:string`). A requirement is a `DecisionRecord` (`decision-record-store.ts` L20–46): `kind:'requirement'`, `status:'proposed'|'approved'|'active'|'superseded'`, `spec:{metric,op,target}`, `approvedBy`, `supersededBy`. It carries **no `options`/`recommended`/`ui`** natively — those must be *projected* from the record at render time.
- **Different terminal action.** Escalation resolves via `decideEscalation` (pick optionId → done, stateless). A requirement advances an **approval state machine** (`proposed → active`, later `→ superseded` with `supersededBy`) via `approve_decision_record` / `supersede_decision_record`. `BridgeEscalationInbox`'s "pick option 1–9 / jump-to-worker" semantics are the wrong verbs.
- **Supersede has no home in the Escalation schema.** `supersededBy` / CHANGED-diff is a first-class requirement concept with no Escalation field.

A fork here is **small**: a new container that (1) selects `DecisionRecord[]` where `kind==='requirement' && status==='proposed'`, (2) projects each record into a `JsonRenderSpec` (KeyValue chip + optional CompareTable/DiffView for supersede), (3) reuses `<Renderer>` / `DecisionCard` for the body, (4) wires Approve/Supersede to the decision-record verbs. The expensive, bug-prone part (the validated render catalog) is reused; only the thin data+action shell is new.

## What leaf H needs (the gate output)

1. **Reuse** `focal/catalog.ts` + `focal/Renderer.tsx` + `focal/DecisionCard.tsx` render path **verbatim**. No new catalog element required.
2. Add a **projector**: `DecisionRecord(requirement) → JsonRenderSpec` (KeyValue for `{metric,op,target}`; CompareTable **or** DiffView for the supersede CHANGED view; OptionButton(s) for approve / request-changes).
3. **Fork** a `RequirementInbox` (or generalized `DecisionRecordInbox`) container — do **not** reuse `BridgeEscalationInbox`. Bind it to the decision-record store + `approve_decision_record`/`supersede_decision_record`, mirroring `BridgeEscalationInbox`'s card layout/empty-state for visual consistency (one-card language).

**Net:** reuse the bet's expensive half (the closed JSON-render catalog — it fits requirements with no extension), fork only the cheap half (the store-bound inbox shell). This de-risks H: the catalog is confirmed sufficient; the new surface area is a small, well-scoped container.
