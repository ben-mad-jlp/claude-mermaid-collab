# mermaid-collab Control UI — Definitive Design Vision

> **"Studio & Bridge: two surfaces, one spine."** One operator, three workspaces, a single seam that carries the escalation badge and the current session across the boundary.

---

## 1. VISION

mermaid-collab is two jobs wearing one coat. The current app forces both into one undifferentiated shell (`supervisorViewOpen` swaps the canvas; the orchestration sidebar is permanently mounted on top of the simple one), so the single-session worker drowns in fleet chrome and the fleet operator stares at an artifact tree they don't care about.

The fix is a first-class, persisted **mode** with **two purpose-built surfaces** and **one shared spine**:

- **STUDIO** (simple) — a ruthlessly minimal single-session cockpit. Artifact tree, editor stage, terminal, browser, a flat session checklist. Every epic/wave/role/daemon/project-select control is *deleted, not hidden*. Scope IS the session, so the entire scope-drift machinery ceases to exist.
- **BRIDGE** (command) — a fleet command center whose home answers "what's going on?" in one glance: escalation inbox first, worker pool, progress funnel, daemon vitals. It is never also an editor, so it spends its whole canvas on legibility.
- **PLAN** — the roadmap/waves graph + the Planner's approval action, split out from Bridge so neither surface overloads.

The product's stated mental model (grafted from workspace-perspectives): **perspectives are workspaces, not roles. The operator changes *what they look at*, never *who they are.*** Planner-approve and Coordinator-monitor become *actions inside* a workspace, not modes you inhabit. The RoleSwitcher tri-view is gone.

The spine is one persisted enum (`uiStore.mode`), one top-left mode pill carrying a live escalation badge in **every** mode, and `sessionStore.currentSession` as the bridge variable that lets you dive from a worker card straight into its cockpit.

---

## 2. THE MODE MODEL (the heart)

### State
- **Add `uiStore.mode: 'studio' | 'bridge' | 'plan'`** (persisted, bump `ui-preferences` to v9, default `'studio'`).
- **Retire `supervisorViewOpen`** entirely. **Demote `supervisorRole`** from a full-view swap to an optional in-Bridge filter chip (or delete).
- `activeProject` is read **only** in Bridge/Plan. In Studio, scope = `currentSession.project`, full stop.

### Shared state (never duplicated)
- `supervisorStore` — escalations / todosByProject / coordinatorByProject / supervised. **Bridge & Plan read all; Studio reads only `currentSession`'s escalation slice** for its inline card.
- `sessionStore.currentSession` — the cross-mode bridge variable; untouched by mode switches.
- `subscriptionStore` — drives worker liveness/context in Bridge; the session's own context chip in Studio.

### The pill + progressive disclosure
One control, top-left (where `supervisorViewOpen` is read at App.tsx:179/1793):

`[ ◫ Studio │ ⤢ Bridge │ ◑ Plan ]  ⚠N`

The escalation **count badge rides the pill in all three modes** — the single thread back to the fleet from inside a focused session. ⌘1/⌘2/⌘3 quick-switch (grafted from workspace-perspectives); each mode remembers its own split sizes (cheap, high-value).

Disclosure ladder: **Studio = minimum panels** (one quiet ticker line + the badge are the only fleet bleed-through) → **Bridge = fixed KPI glance + live stream** → any tile/row drills into an existing panel → **Jump dives all the way into a worker's Studio cockpit.**

### The two transitions
1. **Dive in (Bridge/Plan → Studio):** click a worker card, a stream row, or an escalation **Jump** → set `currentSession` to that session **and** flip `mode='studio'`; reuse the existing `activateSessionCard` side-effects (spawn terminal, focus browser). You land inside that worker's cockpit.
2. **Step back (Studio → Bridge):** click the pill / ⌘2. `currentSession` is **preserved**, so re-diving returns you there. No work lost.

### Scope drift — killed
Studio scope = `currentSession.project`. Bridge/Plan scope = `activeProject`. **They are never both live**, so there is nothing to reconcile. The `⇄ Sync` button and the `scopeMismatch` hack in `ArtifactTree` (L514–521, 966–993) are **deleted**.

---

## 3. STUDIO (simple mode)

A three-pane cockpit for one session. The session's project is implicit; there is no scope concept to manage.

**Left rail (~260px) — decluttered artifact spine:**
- Session identity chip + one quiet `◷ 34%` context chip (expands to a full-width `warning` banner only at ≥80%).
- **Session todo checklist** — flat `list_session_todos`, checkboxes, drag-reorder. NOT the work-graph.
- **Artifacts** — `ArtifactTree` stripped to this session's buckets: Pins / Recent / Diagrams / Documents / Designs / Snippets / Images. No "Other sessions", no work-graph buckets.
- **Servers** footer (unchanged primitive).

**Center — the stage:** `SplitEditorHost` + `EditorToolbar` exactly as today. *Untouched per the brief.*

**Right column (toggleable) — Terminal + Browser** + the agent-chat / last-assistant-turn surface.

**The one bridge kept:** if *this* session escalates, the decision card docks **inline above the terminal** (reuse `ProjectScopeSection` L436–476). The user answers A/B in place via `decideEscalation`. Other sessions' escalations stay silent — they only feed the badge.

**A single fleet-liveness whisper (grafted from activity-stream):** a one-line **session ticker** — `◷ rendered auth-flow.mmd · 2s ago ▸` — using the shared `<EventStream filter=currentSession>` collapsed. Click to expand a side log. This is the *only* trace of the timeline concept in Studio; opt-in, one line tall.

### Removed from Studio (deleted, not collapsed)
`ProjectScopeSection` entirely · PROJECT `<select>` + `⇄ Sync` · the work-graph Plan tree (epics/waves/dep glyphs `⊸ ◌ ⊘`) · Coordinator daemon Start/Stop row · `RoleSwitcher` · SYSTEM strip (global escalation rollup / Map link / fleet watchdog) · `SupervisorPanel` · "Watching" `SubscriptionsPanel` · "Other sessions" sibling-artifact expander.

### Wireframe — STUDIO
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [ ◫ Studio │ ⤢ Bridge ② │ ◑ Plan ]   frontend-1 · auth-flow   ◷34%  ⌘K ◐ │
├─────────────┬──────────────────────────────────────┬───────────────────────┤
│ frontend-1  │  ◇ auth-sequence.mmd      [diagram▾]  │  TERMINAL             │
│ ◷ 34%       │ ┌──────────────────────────────────┐ │  $ claude ...         │
│             │ │      sequenceDiagram             │ │  ▸ editing diagram    │
│ TODOS       │ │      User->>API: login           │ │                       │
│ ☑ scaffold  │ │      API-->>User: token          │ ├───────────────────────┤
│ ☐ wire auth │ │                                  │ │ ⚠ DECISION (this sess)│
│ ☐ add tests │ │       [ mermaid preview ]        │ │ Use JWT or session?   │
│ + add todo  │ └──────────────────────────────────┘ │ [★ JWT] [ Session ]   │
│             │  preview ▸ render ▸ split            ├───────────────────────┤
│ ARTIFACTS   │                                      │  BROWSER              │
│ ▸ Pins      │                                      │  localhost:5173       │
│ ▾ Diagrams  │                                      │  ┌─────────────────┐  │
│   ◇ auth-seq│                                      │  │  rendered app   │  │
│ ▸ Documents │                                      │  └─────────────────┘  │
│ ▸ Designs   │                                      │                       │
├─────────────┤                                      │                       │
│ Servers ●   │  ◷ ticker: rendered auth-flow · 2s ▸ │                       │
└─────────────┴──────────────────────────────────────┴───────────────────────┘
   no project-select · no plan-tree · no roles · no daemon · no fleet
```

---

## 4. BRIDGE (command center)

A fixed dashboard, escalation-first, scoped by the `activeProject` selector (the **only** place that selector now lives). No role-swap tri-view. Roles → inline actions. A thin **alert ribbon** spans the top for banner-tier alerts; below it a fixed KPI header guarantees the <5s glance even before you read anything else; the live EventStream sits center-left as "watch + act at once"; a drill-in dock on the right routes any click to an existing panel.

### The glance (fixed KPI header — priority order)
1. **⚠ Escalation Inbox — the #1 citizen, top-left, largest.** Decision cards: question, worker/session, structured `options[]`, ★recommended. Answer in place OR **Jump** → dive to that worker. Pulses if >0. (`EscalationInbox` + the L436–476 card, promoted.)
2. **Worker Pool.** Role-typed session cards (frontend-1, backend-1…): role glyph, current todo, status (active/idle/crashed), context %. Header tally `6 workers · 4 busy · 1 idle⚠ · 1 ⚠ctx`. **idle-with-work-available = amber** (a real problem); **crashed-holding-todo = danger**.
3. **Progress Funnel.** Horizontal segmented bar `Backlog ▸ Ready ▸ In-flight ▸ Blocked ▸ Done` with counts. **Blocked segment is `danger`-toned and loud while >0.** Click a segment → filtered todo list. (Lanes from `CoordinatorView`.)
4. **Coordinator / Daemon vitals.** `● running · tick 4s ago` in `success`; flips to a loud `danger` banner `⛔ STOPPED · 5 ready waiting` when stopped with ready>0 — the silent killer promoted to a banner, with inline **Start/Stop** (the only Coordinator affordance).

### Center spine — live EventStream (grafted from activity-stream, as a tile not the whole product)
Reverse-chronological fleet heartbeat with a pinned "NOW" rail; severity-chip filters `All · ⚠Needs me · Blocks · Activity`. New events slide in with a token-colored highlight-fade. It answers "what just happened"; the KPI header answers standing state ("is the daemon alive / who is idle") — **both, deliberately.** Any row → drill-in dock.

### Right — drill-in dock
Clicking a stream row, KPI tile, worker, or funnel segment opens the matching **existing** panel here *while the stream keeps flowing*: `EscalationInbox` / `TodoDetailView` / Worker detail / filtered lists. **System Map** (`SystemMapPanel`) and **Trace** (`TracePanel`) are secondary tabs in this dock — the only home for any fleet "map" (we deliberately do NOT build a live worker-chips-on-edges canvas).

### Loud alerts (top ribbon + tile borders + global badge)
open escalation · daemon-stopped-with-ready · crashed worker holding a claimed todo · any session ≥80% context · blocked todo with no path (dep cycle / rejected-todo). All semantic-token styled.

### Wireframe — BRIDGE
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [ ◫ Studio │ ⤢ Bridge ② │ ◑ Plan ]   project: webapp ▾        ⌘K   ◐      │
│ ⛔ Coordinator STOPPED · 5 ready waiting   ✖ backend-2 crashed (holds T-44)│  ← alert ribbon
├──────────┬──────────┬─────────────────────┬───────────────────────────────┤
│ ⚠ ESCAL 2│ ⚙ WORKERS│ PROGRESS FUNNEL      │ COORDINATOR    WAVE 2/4 60%   │
│ oldest 4m│ 6·4busy  │ Bk12 Rd5 Fl4 █Bl3 D9 │ ⛔ stopped [Start]            │
│   pulse! │ 1 idle⚠  │       ^blocked loud  │ 5 ready waiting!              │
├──────────┴──────────┴─────────────────────┴───────────────────────────────┤
│ LIVE STREAM      [All][⚠Needs me][Blocks][Activity] │  ▸ DRILL-IN DOCK     │
│ ══ NOW ════════════════════════════════════════════ │ ┌── WORKER POOL ───┐ │
│ ⚠ 0:04 frontend-1 needs decision: JWT or cookies? J │ │⚙frontend-1 T-12  │ │
│ ⛔ 0:30 Coordinator stopped — 5 ready waiting  Start │ │ ●active 34%      │ │
│ ◷ 1:12 backend-1 at 84% context                     │ │⚙backend-1  T-09  │ │
│ ⊘ 2:03 frontend-2 blocked: dep cycle #a1       view │ │ ●active 51%      │ │
│ ✓ 2:40 backend-1 completed #a4 "schema"             │ │⚙backend-2  T-44  │ │
│ ◔ 3:05 frontend-1 claimed #b2 "nav redesign"        │ │ ✖crashed 88%⚠   │ │
│ ＋ 3:20 spawned design-1 (design)                   │ │⚙design-1  idle⚠ │ │
│ ▸ 4:10 Planner promoted 5 todos → ready             │ │ ready avail!     │ │
│                                                      │ └──────────────────┘ │
│                                                      │ tabs: System Map·Trace│
└──────────────────────────────────────────────────────┴───────────────────────┘
   escalation badge ⚠ rides the pill in EVERY mode
```

### PLAN (the third pill — roadmap drill-down)
`PlanPanel`/`RoadmapPanel` graph/waves/list at center (reuse `roadmapToMermaid` / `computeWaveMap`); the **"Approve plan → ready"** promotion strip docked top — the *only* Planner affordance, surfaced as an action, not a role. Roadmap node → `TodoDetailView`. This is the workspace-perspectives graft that keeps Bridge from cramming the graph into a tab.

---

## 5. SIGNATURE INTERACTIONS

1. **The badge that follows you.** `⚠N` rides the mode pill in all three modes. A new `escalation_created` WS event (already global) **counts up with a `danger` pulse ring** — felt mid-diagram in Studio. Click it = one-key pop to Bridge's inbox.
2. **Dive-in zoom (shared-element).** Clicking a worker card / stream row / escalation **Jump** runs a ~200ms Framer-Motion `layoutId` transition: the card morphs into the Studio cockpit frame; stepping back reverses it. The single `currentSession` bridge variable *feels* like one continuous space, not two apps. (This is the make-or-break that keeps "two surfaces" from feeling like "two products.")
3. **⌘K command palette, mode-aware** (extend `GlobalSearch`). Studio: artifacts + session todos + "Step back to Bridge". Bridge/Plan: "Jump to backend-1", "Answer: JWT", "Approve plan", "Start coordinator". The palette *is* the role-action surface — no RoleSwitcher.
4. **Answer-and-advance escalations.** Option click resolves the card; it collapses upward with a `success` check, the next snaps to the top slot. Keyboard: `1`/`2` pick options, `↵` takes ★recommended, `J` jumps. Clear a stack hands-on-keyboard in seconds.
5. **Live funnel + NOW rail, zero polling.** Funnel segments animate width on WS count changes; the Blocked segment pulses `danger` while >0; the daemon tick counts up live; worker cards desaturate to a `danger` border the instant liveness goes stale/crashed — all off `subscriptionStore` pushes. You *see* the fleet breathing.

---

## 6. VISUAL / INFORMATION DESIGN

- **Semantic tokens drive all status** (shipped): escalation/crashed/daemon-stopped/blocked-no-path = `danger`; idle-with-work / ≥80% context / blocked = `warning`; in-flight / claimed / spawned = `info`; completed / decided / daemon-running = `success`; backlog / artifact noise = muted. Dark mode throughout.
- **Density by mode.** Studio is calm and roomy (one stage, generous gutters, a single quiet context chip). Bridge is dense and instrument-panel-like (fixed KPI tiles, a scrolling stream, tight worker cards) — density signals "you are operating a fleet."
- **Alert escalation by tier, not by dot.** Quiet chip < 80% → full banner ≥ 80%; daemon dot → `danger` ribbon when stopped-with-ready. Severity earns size and color, never a tiny indicator for a fleet-stalling condition.
- **Motion = liveness, used sparingly.** Badge pulse on new escalation, highlight-fade on stream insertion, funnel width tween, worker-card desaturate on stale, shared-element dive-in. No decorative animation; every motion encodes a state change.
- **Event taxonomy** (from activity-stream) is the shared severity/icon/token spec for both the Studio ticker and the Bridge stream: `escalation.opened`(danger ⚠) · `daemon.stopped`(danger ⛔) · `worker.crashed/stale`(danger ✖) · `todo.blocked`(warning ⊘) · `context.high`(warning ◷) · `todo.claimed`(info ◔) · `session.spawned`(info ＋) · `plan.promoted`(info ▸) · `todo.completed`(success ✓) · `escalation.decided`(success ✓) · `artifact.updated`(muted ·).

---

## 7. TECHNICAL PLAN

### Component structure
```
App.tsx
├─ ModePill (NEW)          — 3 pills + escalation badge + ⌘1/2/3; replaces supervisorViewOpen gate @179/1793
├─ gate: mode === 'studio' → StudioShell
│          mode === 'bridge' → BridgeDashboard
│          mode === 'plan'   → PlanWorkspace
└─ overlays unchanged (QuestionPanel, ToastContainer, GlobalSearch ⌘K, dialogs)

StudioShell (NEW, thin compose)
├─ left: SessionChip+ContextChip · SessionTodos · ArtifactTree(stripped) · Servers
├─ center: SplitEditorHost + EditorToolbar          (REUSE untouched)
├─ right: TerminalDrawer + BrowserPanel + agent turn (REUSE)
├─ InlineEscalationDock (REUSE decision card L436–476, filtered to currentSession)
└─ EventStream filter=currentSession, collapsed       (NEW component, ticker mode)

BridgeDashboard (NEW grid shell)
├─ AlertRibbon (NEW, thin — derives banners from store selectors)
├─ KPI header: EscalationInbox(REUSE) · WorkerPool(NEW over subs+session) ·
│              ProgressFunnel(NEW wraps CoordinatorView lane counts) · DaemonVitals(NEW)
├─ EventStream filter=all, full                        (NEW)
└─ DrillDock (NEW router) → EscalationInbox · TodoDetailView · WorkerDetail ·
              SystemMapPanel(REUSE) · TracePanel(REUSE) as tabs

PlanWorkspace (NEW thin)
└─ PlanPanel/RoadmapPanel(REUSE) + PromotionStrip(REUSE PlannerView strip) + TodoDetailView
```

### What drives each (stores / WS)
- **`uiStore`**: add `mode` (persist v9), `streamFilter`, per-mode split sizes; remove `supervisorViewOpen`; `supervisorRole` → optional Bridge filter or delete; `activeProject` read only in Bridge/Plan.
- **`supervisorStore`**: `escalations`→badge+inbox+stream; `todosByProject`→funnel+roadmap; `coordinatorByProject`→daemon vitals; `supervised`→worker pool. Actions `decideEscalation`/`resolveEscalation`/`promoteTodo`/`setCoordinator` wired to cards + palette.
- **`sessionStore.currentSession`**: the bridge variable; `sessionTodos`→Studio checklist; per-type artifact arrays→ArtifactTree.
- **`subscriptionStore`**: status/contextPercent/liveness → worker pool + funnel pulse + context chips. **Derive liveness inline from `lastUpdate`/status freshness** — there is NO `supervisorLiveness` helper (correcting a shared inaccuracy in the concepts).
- **WS (existing App.tsx switch L505–1062, untouched):** `escalation_created`/`supervisor_nudge`→badge+pulse+InlineDock+stream (already global); `session_state_updated`→funnel; `claude_session_status`/`claude_context_update`→worker pulse + context; `session_todos_updated`→Studio checklist; artifact CRUD→ArtifactTree. **No new WS events, no polling.** A small ring buffer accumulates `StreamEvent[]` from these; backfill from `auditByProject` on mount.

### Reuse vs new
- **REUSE (composition only):** decision card (`ProjectScopeSection` L436–476), `EscalationInbox`, `CoordinatorView` lane logic, `PlanPanel`/`RoadmapPanel` + `roadmapToMermaid`/`computeWaveMap`, `SystemMapPanel`, `TracePanel`, `SupervisedSessions`/`SessionCard` + `activateSessionCard`, `SplitEditorHost`/`EditorToolbar`, `TerminalDrawer`, `BrowserPanel`, `GlobalSearch`, `ArtifactTree` (stripped).
- **NEW (thin):** `ModePill`, `StudioShell`, `BridgeDashboard` grid, `WorkerPool`, `ProgressFunnel`, `DaemonVitals`, `AlertRibbon`, `DrillDock`, `EventStream` + `eventTaxonomy.ts`, `InlineEscalationDock`, a `useDiveIn(session)` hook (`setCurrentSession` + `setMode('studio')` + `activateSessionCard`).
- **DELETE:** `ProjectScopeSection` (dissolved), `⇄ Sync` + `scopeMismatch` logic in `ArtifactTree` (L514–521, 966–993), `RoleSwitcher` tri-view, `PlannerView`/`CoordinatorView` as full views, `supervisorViewOpen` gate.

### Phased build order (ship the seam first)
1. **Seam.** Add `uiStore.mode` + `ModePill` (badge, ⌘1/2/3); gate `App.tsx` main on `mode` (Studio = today's simple surface; Bridge = today's `SupervisorView` temporarily; Plan stub). Ships the two-mode behavior + persistent badge on day one.
2. **Strip Studio.** Unmount `ProjectScopeSection`/`SupervisorPanel`/`SubscriptionsPanel`; strip `ArtifactTree` to session buckets; delete `⇄ Sync`/`scopeMismatch`; add `SessionTodos` + `ContextChip` + `InlineEscalationDock`.
3. **Bridge KPI.** `BridgeDashboard` grid + `EscalationInbox` + `WorkerPool` + `ProgressFunnel` + `DaemonVitals` + `AlertRibbon` on supervisor/subscription selectors (the <5s glance).
4. **Plan pill.** `PlanWorkspace` = `PlanPanel` + `PromotionStrip` + `TodoDetailView`.
5. **EventStream.** `eventTaxonomy.ts` + ring buffer; collapsed Studio ticker first (proves liveness), then full Bridge stream + `DrillDock` routing existing panels (incl. System Map / Trace tabs).
6. **Dive-in + polish.** `useDiveIn` + Framer `layoutId` shared-element transition; mode-aware ⌘K verbs; per-mode sticky split sizes. Delete dead code.

---

## 8. WHY THIS over the alternatives + top risks

**Why Studio & Bridge wins (judge: 43, top rank):** cleanest declutter story — Studio is *deleted down to near-nothing*, not collapsed, so simple mode has literally nothing orchestration-shaped to clutter it; most truthful technical map; best ship-the-seam-first build order. Two genuinely separate surfaces mean Bridge spends 100% of canvas on fleet legibility instead of timesharing with an editor.

**What it grafts:** the *workspaces-not-roles* mental model + the **third Plan pill** + ⌘1/2/3 + sticky splits (from workspace-perspectives); the **EventStream as a component** — Studio ticker + Bridge stream tile, plus the event taxonomy as the token/icon spec (from activity-stream); the **shared-element dive-in** + badge-on-pill-in-every-mode (from mission-control / two-surface).

**What it deliberately drops:** spatial-canvas's live worker-chips-flowing-along-edges canvas (a v3 toy; any map defers to the existing `SystemMapPanel` as a Bridge tab); the generic dockable panel-host/registry *engine* (use static per-mode layouts — that engine is the one thing that would sink the timeline); the RoleSwitcher tri-view (roles become inline actions: Planner approve in Plan, Coordinator Start/Stop in Bridge's daemon strip).

**Top risks:**
1. **Two surfaces feeling like two apps** — mitigated entirely by the shared-element dive-in (Phase 6) and the badge that rides the pill everywhere; if the transition is weak, the seam feels like a hard cut. This is the #1 thing to nail.
2. **EventStream scope creep** — the taxonomy is the only net-new logic; keep it a thin derivation off existing WS events + a ring buffer, ship the ticker first to prove it cheaply, never let it become a second source of truth.
3. **Bridge density overwhelming** — fixed KPI header must stay the primary glance; the stream is a supporting tile, not the spine. Guard the <5s glance test in review.
4. **Liveness correctness** — derive inline from `subscriptionStore` freshness (no mythical `supervisorLiveness` helper); a wrong "crashed/idle" read erodes trust in the whole command center.
