# Bridge Layout & Graph Visualization Redesign

**Direction: STACKED-ZONES (priority-stack), grafting implementation discipline from adaptive-split, escalation-flow rigor from needs-you-led, and the one-selector escalation-badge invariant from one-graph-zoned.**

Winner of the judge round (60 pts). This is the definitive buildable design. It resolves all seven operator signals on the existing stack — `react-resizable-panels` + `@xyflow/react`, no new deps, no new WS events, honoring one-red, never-jump, and reuse-not-rewrite.

---

## 1. VISION

The Bridge is a glance, not a dashboard. A single local operator — a player-coach who is occasionally the bottleneck — looks at it to answer two questions fused into one: **"does anything need me?"** and **"is the work flowing?"** Everything else is drill-down.

So the Bridge is authored as **one vertically-ordered priority stack**, narrow-first:

> **Z1 Needs-You → Z2 Fleet state → Z3 Graph → Z4 Plan summary**

The operator's eye always travels the same top-down priority on every viewport. The most urgent thing — open escalations — is **structurally first in the DOM and never behind a tab**. On wide screens the top two zones fold into a left instrument column and the one `FleetGraph` claims the right via the already-shipped draggable split. On narrow screens the zones simply stay stacked (Z1 sticky) and the graph's dagre flips **LR → TB** so dependency flow runs *down the scroll* instead of sideways off-screen.

There is **no rail** because Needs-You *is* Z1. There is **no mobile afterthought** because the narrow stack is the source layout and desktop is its reflow. There is **one graph** — Bridge, Implementing task view, and (filtered) plan navigation all mount the same `FleetGraph`. There is **one earned red** — escalations only — coordinated across four surfaces from a single selector.

**Deliberate stance vs. the brief:** we DROP the manual horizontal/vertical orientation toggle. Viewport-derived orientation is sufficient and the priority stack already encodes the right arrangement at each width; a user toggle is a control + persisted state to maintain for marginal benefit. (Revisit only if wide-monitor operators actually demand a tall reading column.) The only persisted layout control is the draggable split ratio — and we keep **independent ratios per orientation** (`-h` / `-v` storageIds, grafted from adaptive-split).

---

## 2. STRUCTURE + LAYOUT

### The canonical stack (priority order, top = most urgent)

- **Z1 — Needs-You strip.** Open escalations as compact A/B/C-preview cards (the one earned red). Empty state = calm tick line. Always first in DOM, always visible (sticky on narrow, pinned top-of-column on wide). This is the rail's *content* promoted to zone status.
- **Z2 — Fleet/run state.** `FleetVitals` + active-worker roster (liveness glyphs, who's on what). Neutral / funnel palette only. **Fixed** — not a floating dismissable HUD (we reject graph-canvas's draggable HUD as creeping panel-host territory).
- **Z3 — Graph stage.** The one `FleetGraph`. Dominant by area on every viewport. Hosts the artifact dock (nested SplitPane) and the focal DecisionCard overlay.
- **Z4 — Plan summary.** A progress-oriented **wave-kanban** (Ready-Now lane + segmented progress bar + bottleneck tag) — NOT mermaid, NOT a second graph engine.

### Reflow rule — one stack, two arrangements, no orientation toggle

Orientation is **derived from viewport** via the existing `useIsDesktop()` matchMedia switch in `SplitDeck` (which also guarantees `FleetGraph` mounts exactly once — never double-mounted, preserving its live subscriptions).

**WIDE (≥1024px):** Z1+Z2 reflow into the **left instrument column** (Z1 pinned top, Z2 below, column scrolls). Z3 graph takes the **right** stage via the existing `SplitPane` (default 38/62, draggable, `storageId="bridge-deck-split-h"`, dagre **LR**). Z4 Plan is a peer surface reached via a CommandBar `[Bridge | Plan]` segment, rendering the wave-kanban full-width — Plan is not crammed into the column.

**NARROW (<1024px):** the literal stack — Z1 (sticky `top-0`), Z2, Z3 (graph, dagre **TB**, fills viewport height, stacks down-scroll), Z4 below. **The `[Panel | Graph]` tab toggle is DELETED.** That toggle is exactly the documented worst-case failure (journey a): an escalation firing in the hidden tab is invisible. Stacking makes Z1 and Z3 co-visible by construction — the whole point.

### Wide wireframe — Bridge mode, artifact pane closed

```
+----------------------------------------------------------------------------+
| [Project v]   * 4 live  o 2 inflight   [! 2 need you]   [Bridge|Plan]  [art]| CommandBar (badge=red)
+-------------------------------+--------------------------------------------+
| Z1 NEEDS YOU --- pinned top   | Z3  FLEET GRAPH  (dagre LR)        [L0 L1   |
| +---------------------------+ |     +------+   +------+               L2]   |
| |! pick auth lib . w/api-3  | |     |epic A|-->| todo |===>(o w-api3) | Fit |
| |  >A jwt  >B session  rec A| |     +------+   |o ring|  animated claim     |
| |                       J   | |               +------+   edge = accent     |
| +---------------------------+ |     +------+   +------+                     |
| |! schema review . w/db-1   | |     | todo |-->| todo |   o idle worker     |
| +---------------------------+ |     +------+   +------+   (stall=no edge)    |
| - - - - - - - - - - - - - - - |                                            |
| Z2 FLEET                      |   [minimap]                                |
| vitals: 62% ####. . ctx 41%   |                          < draggable split  |
| workers:                      |                            (38/62 persist)  |
|  (*) w-api3  impl  > auth      |                                            |
|  (*) w-db1   review > schema   |                                            |
|  ( ) w-ui2   idle             |                                            |
+-------------------------------+--------------------------------------------+
```

### Wide wireframe — artifact viewer open (Z3 becomes a nested SplitPane)

Click a worker node -> dive (sets `currentSession`) + the graph stage splits to dock the artifact viewer beside the still-live graph. The graph **never unmounts**.

```
+-------------------------------+---------------------+----------------------+
| Z1 NEEDS YOU (pinned)         | FLEET GRAPH (LR)    | ARTIFACT VIEWER      |
|  ! pick auth lib . w/api-3    |  +------+ =>(o api3)| session: w-api3      |
| Z2 FLEET                      |  | todo |          | +------------------+  |
|  (*) w-api3 impl >auth <select|  +------+          | | auth.ts  diff    |  |
|  (*) w-db1  review            |   [minimap] <nested| | +42 -3           |  |
|  ( ) w-ui2  idle              |     split graph|art| +------------------+  |
+-------------------------------+---------------------+----------------------+
       storageId bridge-deck-split-h      storageId bridge-stage-split-h
```

### Narrow wireframe — the canonical stack, dagre TB, NO tabs

```
+-----------------------------+
|[Proj v] *4  [! 2 need you] [art]| CommandBar (badge always visible)
+-----------------------------+
|### Z1 NEEDS YOU (sticky) ####| <- sticky top-0: stays as you scroll
| +-------------------------+ |
| |! pick auth lib . w/api3 | |   the one red, never hidden
| | >A jwt >B sess  recA  J | |
| +-------------------------+ |
+-----------------------------+
| Z2 FLEET  62% ####.          |
| (*)w-api3 impl (*)w-db1 ( )ui2|
+-----------------------------+
| Z3 GRAPH (dagre TB, down)   |
|        +------+             |
|        |epic A|             |   flow runs DOWN the scroll,
|        +--+---+             |   not sideways off-screen
|      +----+----+           |
|   +--v--+   +--v---+        |
|   |todo |   |todo o| ring   |
|   +--+--+   +------+        |
|      || animated claim      |
|   (o w-api3)                |
+-----------------------------+
| Z4 PLAN  ###. 62%  Ready:3  |
| [Ready Now] auth . cli . db |
| wave1: [done][done]         |
| wave2: [inflight][blocked]  |
|        (chain) unblocks 6    |
+-----------------------------+
```

Narrow artifact viewer = bottom sheet over Z3 (graph stays **mounted**, dimmed — subscriptions preserved), via the stage split going `direction="vertical"`.

### Visual hierarchy

Pre-attentive -> drill: (1) animated accent claim edges + danger red rings (the only saturated motion/color); (2) the CommandBar red-count badge; (3) node fills / kanban cards (funnel-bucket muted palette); (4) Z2 vitals numbers; (5) everything else. Red appears at rest ONLY in Z1 + the badge that mirrors it + the graph ring.

---

## 3. THE HARD PARTS

### 3a. Escalation salience without the rail (one earned red — 329741da)

The rail is gone, but its content survives as **Z1**, which — unlike a tab — is **never hidden on any viewport** (sticky on narrow, pinned top-of-column on wide). On top of that, the brief's safety net: a **persistent CommandBar red-count badge** (`! 2 need you`).

**The invariant (grafted from one-graph-zoned, enforced in ONE selector):**

> `needsYouCount > 0`  IFF  `Z1 non-empty`  IFF  `>= 1 danger ring exists on the graph`.

All four surfaces — Z1 cards, CommandBar badge, TodoNode danger ring, focal DecisionCard — derive from the **same** `openEscalations` array (`useSupervisorStore.escalations` filtered to project + `status==='open'`). There is no second count, no second source of truth. The badge survives pan / zoom / Plan-mode (where Z1 isn't on screen); Z1 survives the loss of the badge slot; the ring is the spatial locator. The old "all clear · N nominal" calm line becomes the badge's **empty form**, so the slot is never blank — it is red-count OR green-tick.

**Why this is harder to miss than the old column:** the column could scroll; Z1 is sticky and the badge is welded into never-panned CommandBar chrome. **Off-screen-ring problem solved:** clicking the badge or a Z1 card runs `setFocusNodeId` -> graph `fitView`s + pulses the node, so you can never be panned away from an escalation you can't reach in one keystroke.

### 3b. A genuinely useful plan view (signal 3 — replace mermaid)

The current mermaid `graph`/`waves` modes answer *"what depends on what"* — a question the operator rarely asks, drawn as a non-reflowing themed SVG that can't be clicked-to-navigate. **Delete both mermaid modes.** Z4 becomes a **wave-kanban** answering the three questions the operator actually has, in priority order:

1. **What can start right now?** -> a pinned **"Ready Now" lane** (todos whose `dependsOn` are all `done` and unclaimed). The single highest-value addition; the answer the DAG buries.
2. **How far along are we?** -> a **segmented progress bar** header from `funnel.ts`/`funnelCounts`: `##### 62% · 14 done · 3 inflight · 5 ready · 2 blocked`.
3. **What's blocking the most?** -> a **non-red accent bottleneck tag** (`(chain) unblocks 6`) on the todo with the largest downstream-unblock subtree.

Form: **columns = `computeWaveMap` depth** (the dependency-order progress axis, reused — `computeWaveMap` the function survives, only its mermaid render path dies); within a wave, todos are **stacked cards colored by the same `funnel.ts`/`bucketTodo` bucket** as the graph (one palette everywhere). It is a flex/grid of cards — **not React Flow, not mermaid** (honors 166fd1ec: machine-derived roadmap qualifies to drop themed mermaid, which now stays only for human-authored diagrams). It **reflows for free** (waves stack vertically on narrow). Cards carry the **same `onSelectTodo`** click-to-navigate as graph nodes, so Plan and Bridge speak one interaction language. `list` mode is kept as the dense fallback.

We REJECT plan-as-filtered-graph (adaptive-split / graph-canvas): a Ready-Now worklist answers "what's next" far better than chip-filtering a frozen graph, which the judge flagged as the weakest plan answer.

### 3c. Bridge + artifacts coexistence (signal 7 — the live bug)

**Root cause** (`App.tsx:1809-1831`): the three modes are mutually-exclusive full-canvas swaps; the artifact `main` is gated `mode==='studio'`, so the Header `toggle-viewer` button silently no-ops in Bridge mode.

**Fix** (static nested split, no panel-host engine — 00c8adb9): host the artifact pane **inside the Bridge's graph stage (Z3)**, never as a mode swap. When `viewerVisible && currentSession`, Z3's content becomes a nested `SplitPane`:

```
stage = viewerVisible
  ? <SplitPane direction={isDesktop ? 'horizontal' : 'vertical'}
               storageId={isDesktop ? 'bridge-stage-split-h' : 'bridge-stage-split-v'}>
       {FleetGraph}{ArtifactViewer for currentSession}
    </SplitPane>
  : FleetGraph
```

- Relax the `App.tsx` gate to `(mode === 'studio' || mode === 'bridge') && viewerVisible`; in Bridge the viewer renders into the stage split, not the exclusive `main`. The button is no longer a no-op.
- **Wide:** artifact docks right of the graph. **Narrow:** artifact slides up as a bottom sheet (stage split vertical) over Z3 — the graph dims but **stays mounted** (subscriptions preserved, never double-mounted).
- Driven purely by `currentSession` + `viewerVisible`. Clicking a worker node dives in AND, if the viewer is open, swaps the pane to that session's artifacts beside the still-live graph.
- **Two-surface model intact:** artifacts remain a Studio concern *projected into* the Bridge — we never leave `mode==='bridge'`, the Studio artifact component just renders in a pane the Bridge owns.

---

## 4. SIGNATURE INTERACTIONS

- **Resize:** drag the `SplitPane` divider; ratio persists per orientation (`bridge-deck-split-h` / `-v`). No orientation toggle — width drives arrangement.
- **Escalation flow (rigor grafted from needs-you-led):** a new escalation -> Z1 card appears (sticky, top) + CommandBar badge increments + the graph node gains a danger ring, **atomically from one `openEscalations` update**. Clicking the badge or a Z1 card **auto-promotes the highest-priority escalation**: `setFocalEscalationId(highest)` + `setFocusNodeId(node)` -> graph `fitView`s + `animate-pulse`es the node, and the scrimmed `DecisionCard` opens. Answer verbatim (`1-9` / `Enter` recommended / `J` jump / `Esc`). `decideEscalation`/`resolveEscalation` -> badge decrements, ring clears, Z1 card removed — all from the same store write. A second escalation arriving mid-decision already shows on the badge (`2`), so it has standing even while the card shows #1. (We take needs-you-led's flow rigor WITHOUT its layout — no calm card owns prime real estate; the live graph stays dominant.)
- **Plan view:** CommandBar `[Bridge | Plan]` -> wave-kanban. Glance the progress bar; scan the Ready-Now lane for the next action; spot the `(chain) unblocks N` bottleneck. Click a card -> `onSelectTodo` -> spotlights that todo in the graph (and offers dive-in).
- **Click graph node -> SELECT + SHOW session (signal 6):** click a worker/claimed-todo node -> `setSelectedNodeId` (two-way spotlight via `deckStore`) AND `useDiveIn()` -> `setCurrentSession(session)` + `activateSessionCard`. Because `currentSession` is now set, the artifact stage populates without a mode switch. Epic node -> toggle `expandedEpics`. Danger todo -> promote its escalation into the focal card + frame the node.
- **Open artifacts while staying in Bridge (signal 7):** Header `toggle-viewer` flips `viewerVisible`; the relaxed gate docks the artifact `SplitPane` into Z3 (wide: right of graph; narrow: bottom sheet). Graph never unmounts. Click a worker node with the viewer open = dive AND swap the pane to that session's artifacts beside the live graph. Close -> graph reclaims the full stage.

---

## 5. VISUAL / INFO DESIGN — one red, one type scale, one card

- **ONE earned red (329741da):** `--color-danger-500` appears ONLY for open escalations, across exactly four coordinated surfaces from one selector — Z1 strip, CommandBar badge, `TodoNode` `ring-2 ring-danger-500` (+ `animate-pulse` when `focusNodeId===id`), and the focal `DecisionCard` border. The bottleneck tag is **accent, not red** (`--color-accent-500`). Accent = "live": claim-edge animation, selection ring, bottleneck. Muted (`--color-muted-400`) = dependency edges, idle. Funnel palette tints kanban cards and node fills identically.
- **ONE type scale, ONE card language (166fd1ec):** the Z1 escalation card, the Z4 kanban card, and the L2 `TodoNode` are the **same card primitive at three densities**. The focal `DecisionCard`'s answer-and-advance is kept verbatim — it is the act surface everywhere.
- **Glance budget (cut the noise):** epic rollup bars, backlog counts, context-percent, retry badges, and wave numbers are **drill-down, not glance** — demoted into Z2/Z4/L2 detail, never competing for the ambient eye. The three ambient signals are: badge count, an animated claim edge (work is moving), an idle worker on an open todo (stall).

---

## 6. TECHNICAL PLAN

### Reuse vs. New vs. Delete

**REUSED — unchanged:**
`SplitPane.tsx` (both directions + `storageId` already supported; used twice — deck split + nested stage split), `FleetGraph.tsx` + `useFleetGraph.ts` two-clock model, `TodoNode.tsx` danger ring, `focal/DecisionCard.tsx` + `Renderer.tsx` + `catalog.ts`, `FleetVitals.tsx`, `WorkerRoster.tsx`, `StreamTicker.tsx`, `useDiveIn.ts`, `deckStore` spotlight (`selectedNodeId`/`focusNodeId`/`focalEscalationId`), `funnel.ts` (`bucketTodo`/`funnelCounts`), `computeWaveMap` (the function), `TaskGraphView.tsx` (signal 5 already done — mounts `FleetGraph` with `subs` omitted; task view = topology only).

**MODIFIED IN PLACE (the adaptive-split discipline graft — do NOT rewrite SplitDeck into a new StackDeck):**
- `SplitDeck.tsx` — accept a computed `direction` (`isDesktop ? 'horizontal' : 'vertical'`); **delete the `<lg` MobileTab `[Panel|Graph]` toggle**; both panes always mounted; reflow Z1+Z2 into the left pane on wide / stack on narrow; nest the stage `SplitPane` into the `right`/graph slot; per-orientation storageIds (`-h`/`-v`).
- `useFleetGraph.ts` / `layout.ts` — add `direction: 'LR'|'TB'` input threaded into `layoutFleet`'s dagre `rankdir` (one-param change), derived from `isDesktop`. **Direction is folded into the debounced topology signature** — a single deliberate relayout on flip, NOT a per-status-tick recompute.
- `App.tsx:1809-1831` — relax the artifact gate to `(mode==='studio' || mode==='bridge') && viewerVisible`; render the viewer into the Bridge stage split, not the exclusive `main`.
- `PlanPanel.tsx` — replace `graph`/`waves` mermaid modes with the wave-kanban (`PlanKanban`); keep `list`. Remove the `<MermaidPreview>` plan render path.
- `config/featureFlags.ts` — flip `jsonRenderDecisionCard` to `true` (or remove the gate) so the focal card is the always-on act surface once the rail is gone.

**NEW (thin, composition only — no engines):**
- `NeedsYouZone.tsx` — Z1 wrapper lifting `BridgeEscalationInbox` cards out of `NeedsYouRail`; calm-tick empty state.
- `CommandBarBadge.tsx` — red `! N need you` pill / calm tick; `needsYouCount` from the same `openEscalations` selector; click -> `setFocalEscalationId(highest)` + `setFocusNodeId`.
- `PlanKanban.tsx` — flex/grid of wave columns (`computeWaveMap`), funnel-colored cards, pinned Ready-Now lane, segmented progress bar (`funnelCounts`), accent bottleneck tag (`downstreamUnblockCount` = BFS over inverse `dependsOn`). Reuses the shared card primitive. Not React Flow, not mermaid.

**DELETED:**
- `NeedsYouRail.tsx` (content -> `NeedsYouZone` Z1 + `CommandBarBadge` calm/red states).
- `SplitDeck`'s `[Panel|Graph]` MobileTab branch.
- `roadmapToMermaid` `graph` + `waves` mermaid modes + the `MermaidPreview` plan render path (`computeWaveMap` the function is KEPT — now consumed by `PlanKanban`).

### Store slices

All derived from existing stores — **NO new WS events, NO polling** (e4475a38 / cdb12d6b):
- `useSupervisorStore.escalations` — filtered to project + open in **ONE selector** feeding Z1 + badge + ring + card (the `needsYouCount > 0 IFF Z1 non-empty IFF >=1 ring` invariant lives here).
- `todosByProject` / `sessionTodos` — graph + kanban.
- `supervised` / `subscriptions` — `WorkerSub` liveness (`deriveLiveness`, `contextPercent`).
- `coordinatorByProject` — running state.
- `deckStore` — `selectedNodeId`, `focusNodeId`, `focalEscalationId`, `expandedEpics`, `forcedLod`; + a derived `direction: 'LR'|'TB'` from `isDesktop` (no new persisted toggle).
- `uiStore` — `mode`, `viewerVisible`; `currentSession` (the cross-surface bridge variable).

### Never-jump + no-new-dep approach

- Dagre `direction` is part of the **debounced (~250ms) topology signature** in `useFleetGraph`; status/ctx/liveness/danger ticks still mutate `node.data` via `updateNodeData` ONLY — never a position recompute, never a twitch. An orientation flip is a single deliberate relayout + `fitView`.
- The artifact dock toggling wraps `FleetGraph` in a nested `SplitPane` — node identity preserved, the graph instance is **never remounted**, subscriptions never re-fire.
- **No new deps:** `react-resizable-panels` + `@xyflow/react` already present; everything is composition. Badge/kanban/zones are plain divs (Bun-managed `ui/`, never `npm install`).

### Phased build order (safety net before touching the rail)

1. **`CommandBarBadge` + the single `openEscalations` selector.** Ship the safety net FIRST, before removing anything. Verify badge ⟺ ring parity.
2. **`NeedsYouZone` (Z1).** Lift the inbox out of `NeedsYouRail`; verify red parity across Z1 + badge + ring.
3. **In-place `SplitDeck` reflow.** Thread computed `direction`; reflow Z1+Z2 left on wide / stack on narrow; **delete the `[Panel|Graph]` tab toggle**; thread `LR`/`TB` into `layoutFleet`; per-orientation storageIds; verify single debounced relayout on flip.
4. **Delete `NeedsYouRail`; flip `jsonRenderDecisionCard`.** The focal card is now the always-on act surface (signal 4 + 329741da closed).
5. **Artifact dock.** Relax the `App.tsx` gate; nest the stage `SplitPane` in Z3 + narrow bottom-sheet variant; wire `viewerVisible` + `currentSession` + worker-node-click (signals 6 + 7 closed).
6. **`PlanKanban` (last).** Build on `computeWaveMap` + `funnel.ts`; wire `onSelectTodo`; delete the mermaid `graph`/`waves` modes; keep `list` (signal 3 closed).

Each phase ships independently and **never regresses** the already-shipped signals: 1 (draggable split), 5 (TaskGraphView reuses FleetGraph), 6 (diveIn + spotlight).

---

## 7. WHY THIS OVER THE ALTERNATIVES + TOP RISKS

**Why stacked-zones wins:** it optimizes the actual job — a single operator glancing **top-down** for "what needs me + what's running." Needs-You as sticky Z1 makes escalation salience **structural, not compensated** (the rail's removal is natural, not a hole to patch). Deleting the `[Panel|Graph]` tab toggle directly fixes the single worst documented small-screen failure. The wave-kanban with a Ready-Now lane is a **concrete, more-useful** plan than chip-filtering a frozen graph. The nested-SplitPane artifact dock + relaxed `App.tsx` gate is the fix all five concepts converged on.

**Grafts that de-risk it:**
- *From adaptive-split:* modify `SplitDeck` **in place** rather than writing a new `StackDeck` (kills stacked-zones' biggest weakness — the rewrite); per-orientation storageIds; the explicit single-debounced-relayout note.
- *From needs-you-led:* the auto-promote-highest-priority **behavior** on badge/card click (frame + open) — its escalation rigor without its prime-real-estate-to-a-calm-card layout.
- *From one-graph-zoned:* the CommandBar badge as guaranteed-co-visible safety net with the **one-selector invariant** — while REJECTING zoom-as-master-control, which breaks that very invariant at L0.

**Rejected across the board:** the manual orientation toggle (viewport-derived is enough); graph-canvas's floating draggable VitalsHUD (creeps into forbidden dock-host territory — Z2 stays fixed); one-graph-zoned's L0/L1/L2 zoom-reactive re-templating ZoneStrip (too much new surface for uncertain payoff); plan-as-filtered-graph (the kanban answers "what's next" better).

**Top risks + mitigations:**
1. **Four zones can feel busy at mid widths.** Mitigation: Z4 Plan is a *peer surface* on wide (CommandBar segment), not a fourth thing crammed beside the graph — only Z1+Z2+Z3 are co-visible in Bridge mode. Glance budget aggressively demotes rollups/ctx/wave-numbers to drill-down.
2. **In-place `SplitDeck` reflow is more delicate than a rewrite.** Mitigation: it is the correct constraint call (00c8adb9) and de-risks behavior; the `useIsDesktop` single-mount guard is preserved so `FleetGraph` is never double-mounted across the reflow.
3. **The one-selector invariant is load-bearing for never-missing an escalation.** Mitigation: it is a single derived selector consumed by all four surfaces — enforce with a test asserting `needsYouCount > 0` ⟺ at least one node carries `data.danger`.
