# System Object & Project-Spec Primitive — Definitive UI Design

> **North star:** a requirement is a *promise* — a CHIP `{metric · op · target}`. Proposed in a glance, approved in one key, changed only via a DIFF (re-sign), and always answerable: *"is it covered?"*

---

## 1. VISION

You **author** the system spec in **Studio** (a Spec Sheet artifact: object tree on the left, promise-chips on the right), you **confirm** the daily flow of proposed/changed requirements in **Bridge** (a RequirementsInbox that drains by keyboard, sibling to NeedsYouZone), and you **glance** at coverage everywhere (a SpecCoverage card in FleetVitals, a Proposed(N) badge on the ModePill reachable from any mode). The requirement is a signed promise: it enters proposed, is approved in one key, and only ever changes through a DIFF that supersedes and re-signs. Crucially, you **never touch the fleet map** — the system-object tree is an authoring/spec model and must never become a FleetGraph node-kind; coverage is answered inline off the `Todo.objectRef` join, not by drawing a second canvas. This is a single hybrid: the **confirm loop from Concept 3** married to the **authoring artifact from Concept 1**, with a thin satisfy-drag graft from Concept 5.

---

## 2. WHERE IT LIVES

| Surface | Mode | Host component | Reuse target |
|---|---|---|---|
| **RequirementsInbox** | Bridge | left column, sibling **below** `NeedsYouZone` | `BridgeEscalationInbox` shell + `DecisionCard` verbatim |
| **Proposed (N) badge** | any mode | `ModePill` (⌘1/2/3) | `CommandBarBadge` |
| **SpecSheetPane** | Studio | `SplitEditorHost` → `PaneContent` (ArtifactTree `kind:'spec'`) | `ArtifactTree`, `EditorToolbar`, adopted `deriveSystemNodes`/`systemToMermaid` |
| **SpecCoverage card** | Bridge | `FleetVitals` (right of vitals stack) | `FleetVitals` + `funnel.ts` `FUNNEL_SEGMENTS` tints |
| **satisfy-drag** (todo→chip) | Plan | `PlanWorkspace` rail | `PlanPanel` drag handlers; emits a `satisfy` edge on `Todo.objectRef` |
| **constraint-peer chip** | Plan | Planner orientation rail | thin `RequirementChip` (read-only), peer of constraint chip |

---

## 3. THE CONFIRM LOOP (the heartbeat) — RequirementsInbox

The daily pulse. Lives in Bridge's left column directly below `NeedsYouZone`. It reuses the `BridgeEscalationInbox` shell and renders each item with `DecisionCard` verbatim (a `RequirementCard` variant feeding the same options/recommended/status/ui shape).

**States:** `proposed` (new promise awaiting signature) · `approved` (signed, leaves the inbox) · `changed` (a DIFF re-enters at the **top** — supersede the old, re-sign the new).

**Keyboard drain** (identical muscle memory to escalations): `1`/`↵` approve · `e` edit (opens composer inline) · `3` reject · **auto-advance** to next card. Drain top-to-bottom; changed items always jump to top so re-signs are never buried.

**DIFF / re-sign:** when a requirement's `{metric·op·target}` changes, it is NOT silently mutated. The old chip is superseded; a `changed` card surfaces showing `was {≤200ms} → now {≤150ms}` and demands a fresh signature. This keeps the spec a chain of signed promises, never a mutable field.

**Proposed(N) badge:** a `CommandBarBadge` on the `ModePill` shows the inbox depth from *any* mode (amber), so a Studio author or Plan user knows there are promises to sign without switching first.

```
BRIDGE · left column
┌───────────────────────────────┐
│ NEEDS YOU                  ● 2 │  ← red (open escalations only)
│  [DecisionCard] [DecisionCard] │
├───────────────────────────────┤
│ REQUIREMENTS INBOX         ▲ 4 │  ← amber (proposed/changed)
│ ┌───────────────────────────┐ │
│ │ ⟳ CHANGED · re-sign       │ │  ← changed → top
│ │ latency  was ≤200ms       │ │
│ │          now ≤150ms       │ │
│ │ [1 approve] [e edit] [3 ✕]│ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ proposed: throughput      │ │
│ │ {rps · ≥ · 500}           │ │
│ │ rec ▸ approve  [1 ↵] e 3  │ │
│ └───────────────────────────┘ │
│  … auto-advance …             │
└───────────────────────────────┘
```

---

## 4. THE SPEC SHEET (authoring) — Studio artifact

A new ArtifactTree entry `kind:'spec'`, opened in `SplitEditorHost`. Studio is the **object-tree editing model** — the only place the system-object tree is mutated.

- **Left — object tree:** rendered via the adopted **`deriveSystemNodes`** (currently orphaned in `supervisor/systemNodes.ts` → we own it). Sectioned/typed like `ArtifactTree`. Selecting an object scopes the right pane.
- **Right — promise chips + BOM rollup:** each requirement is a `RequirementChip` `{metric·op·target}`. Below them, a **BOM rollup** (bill-of-materials) summarizes child objects/coverage for the selected node.
- **Inline `+ promise` composer:** press `n` → a three-field composer `metric / op / target`. On commit it creates a `proposed` requirement that flows to the Bridge RequirementsInbox for signature (author proposes, you confirm — the loop closes across modes).

```
STUDIO · SplitEditorHost — Spec Sheet [kind:'spec']
┌──────────────┬────────────────────────────────┐
│ OBJECT TREE  │ Pump-A2  ▸ promises             │
│ (deriveSystem│  ┌──────────────┐ ┌───────────┐ │
│  Nodes)      │  │latency ≤150ms│ │rps ≥ 500  │ │
│ ▾ System     │  └──────────────┘ └───────────┘ │
│   ▾ Pump-A2 ◂│  + promise  (n)                 │
│     • Valve  │  ┌ metric ─┬ op ─┬ target ┐     │
│   ▸ Sensor   │  │ pressure│  ≤  │ 4 bar  │ ↵  │
│ ▸ Subsys-B   │  └─────────┴─────┴────────┘     │
│              │ ── BOM ROLLUP ──────────────    │
│              │ 3 objects · 2/3 covered (amber) │
└──────────────┴────────────────────────────────┘
```

---

## 5. COVERAGE & THE FLEET

**One read-only SpecCoverage card** in `FleetVitals` answers *"is the system covered?"* at a glance, tinted with `funnel.ts` `FUNNEL_SEGMENTS` (covered / partial / uncovered). It is derived inline — no second canvas, no new node-kind.

**Coverage is cheap and inline:** memoized on the `Todo.objectRef → requirement` join. No full-tree walk per change, no new WS channel. `supervisorStore.loadCoverage()` pulls a flat rollup; the card and the BOM share the same memoized selector.

**satisfy-drag (Plan, P3):** dragging a Todo onto a `RequirementChip` writes a `satisfy` edge (sets/links `Todo.objectRef`). This is thin consumption only — requirements appear as **peers of constraints** in the Planner's orientation rail (a single read-only chip), NOT new Plan sub-tabs, NOT a coverage ledger in Plan.

**Non-negotiable:** the object tree NEVER becomes a FleetGraph node-kind. FleetGraph stays the single fleet map with its `Epic|Todo|Worker` discriminated union and two-clock topology/data layout. Coverage is answerable without a second map because the answer is a *number on a card* and a *tint on a chip*, not a drawn graph.

---

## 6. ONE-RED / STALENESS

**One-red discipline:** RED is reserved for **open escalations / needs-you ONLY**. An approved-but-uncovered requirement is **AMBER** — in the inbox, on the SpecCoverage card, on the BOM rollup, and on the planner peer-chip. Uncovered does NOT earn red (we explicitly temper Concept 3's instinct that "uncovered earns red"). Amber says *promise made, not yet kept*; red still means *a human must act now*.

**Staleness signal (spec-vs-code drift):** the Spec Sheet must never become a silent second source of truth. Each requirement carries a `signedAt` / `objectRev` stamp; when the underlying object (or its satisfying Todo's artifact) changes after the signature, the chip shows a **stale glyph** (`~ drift`) — neutral grey-dashed, NOT amber/red. A stale chip prompts a re-sign through the same DIFF path. This makes drift *visible and resolvable* rather than corrosive.

---

## 7. SIGNATURE INTERACTIONS (keyboard-first)

1. **`1`/`↵` — sign a promise.** Approve the top inbox card; auto-advance. The entire daily loop is a one-key drain.
2. **`n` — propose a promise.** In the Spec Sheet, open the `metric/op/target` composer; commit sends it to the Bridge inbox.
3. **`e` — re-sign via edit.** Edit an inbox requirement inline → emits a `changed` DIFF that re-enters at top.
4. **Proposed(N) badge click / mode-switch** — from any mode, jump to Bridge with the inbox focused.
5. **drag Todo → RequirementChip (Plan)** — write a satisfy edge; coverage tint updates inline.

---

## 8. TECHNICAL PLAN

### Components — new vs reuse vs delete (against real files)

| Component | Action | Real file / target |
|---|---|---|
| `RequirementsInbox` | **new** | `ui/.../supervisor/bridge/` (mirror `BridgeEscalationInbox`) |
| `RequirementCard` | **new variant** | wraps `bridge/focal/DecisionCard.tsx` verbatim shape |
| `SpecSheetPane` | **new** | Studio `PaneContent`, ArtifactTree `kind:'spec'` |
| `RequirementChip` | **new** (atom) | one-card-language: `rounded-lg border bg-white/gray-900 p-3` |
| `SpecCoverageCard` | **new** | inside `FleetVitals`, uses `FUNNEL_SEGMENTS` |
| `deriveSystemNodes`/`systemToMermaid` | **adopt** (orphaned) | `supervisor/systemNodes.ts` |
| `ProjectScopeSection` | already **gone** | requirement card lifts lifecycle from `DecisionCard` |
| `focal/catalog.ts` | **extend** | add closed JSON-render entry for requirement ui |
| Concept 2 fleet-merge / ⌘4 mode / Plan sub-tabs | **never build** | — |

### Data & store
- `system-objects.db` (**new**), `Todo.objectRef` (**new** join key).
- New REST actions on `supervisorStore`: `loadRequirements`, `loadCoverage`, `loadSystemObjects`, `loadBom`, `decideRequirement` (mirrors `decideEscalation`).
- **NO new WS.** Coverage/BOM derive inline, memoized on the `Todo.objectRef` join (P1 acceptance: cheap, no full-tree walk, no per-change recompute).
- **Deps:** none (ui/ is Bun-managed — `bun add` only if ever needed; not needed here).

### Phased build order
- **P0 — inbox heartbeat:** `RequirementsInbox` + `RequirementCard` + `decideRequirement` + Proposed(N) badge. Reuses DecisionCard/escalation drain wholesale. Ships the daily loop first.
- **P1 — spec sheet + coverage:** `SpecSheetPane` (adopt `deriveSystemNodes`), `+ promise` composer, `SpecCoverageCard`, **inline-cheap memoized coverage**, **staleness signal**.
- **P2 — BOM rollup + peeks:** BOM in Spec Sheet, coverage peeks on chips.
- **P3 — satisfy-drag + planner constraint-peer chip:** Plan-side thin consumption.

---

## 9. WHY OVER ALTERNATIVES

**ACCEPT (judge winner):** the hybrid — confirm-loop in Bridge (Concept 3 heartbeat, P0) + authoring in Studio (Concept 1 Spec Sheet, P1/P2) — because it reuses the *existing* confirmation machinery (DecisionCard, escalation drain, NeedsYouZone sibling) so the daily cost is one already-learned keystroke, while keeping authoring where the object-tree editing model already lives (ArtifactTree/SplitEditorHost).

**TEMPER:** Concept 3's "uncovered earns red" → amber instead (one-red discipline). Concept 5's satisfy-edge → kept but thinned to a drag + a single peer chip, no sub-tabs, no Coverage-Ledger, no object-tree-in-Plan.

**DISCOUNT / DROP:**
- **Concept 2 (fleet-map merge)** — non-negotiable violation of "FleetGraph is the only fleet map." Never prototype. A second canvas fractures the one mental model of the fleet.
- **Concept 4 (4th mode ⌘4)** — mode-switch tax + abandonment risk; a 4th mode for a single-user tool is dead weight. Coverage rides existing surfaces instead.
- **Concept 5's heavy Plan fusion** (4 sub-tabs, Coverage-Ledger, object-tree-in-Plan) — the object tree must not leak into Plan; Plan stays planning.

**Grok critique folded in:** (i) coverage/BOM must derive inline and cheap off the objectRef join — no new WS, no full-tree walk; (ii) an explicit staleness signal so the Spec Sheet never becomes a silent second source of truth. Both are P1 acceptance criteria above.

---

## 10. TOP RISKS

1. **Abandonment** — a high-ceremony "sign every promise" feature in a single-user tool may go unused. *Mitigation:* P0 ships only the one-key drain on existing muscle memory; no new ceremony until it earns its keep.
2. **Spec-code staleness** — the gravest failure is a trusted-but-wrong spec. *Mitigation:* the `signedAt/objectRev` drift glyph + DIFF re-sign path makes drift visible, not silent.
3. **Scaling one-Spec-Sheet-per-project** — a single flat sheet won't scale to large object trees. *Mitigation:* `deriveSystemNodes` sectioning + object-scoped right pane + memoized BOM rollup; revisit virtualization if needed.
4. **Author/monitor coherence** — authoring (Studio) and confirming (Bridge) split across modes risks incoherence. *Mitigation:* the cross-mode Proposed(N) badge + the proposed→inbox flow tie them into one loop; both render the same `RequirementChip` and DecisionCard shape so the promise looks identical wherever it appears.
