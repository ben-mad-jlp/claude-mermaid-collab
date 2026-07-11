# Multi-Project Bridge — The Fleet Rail

> **PIVOT (2026-06-07, user direction after seeing phases 1–3 live).** The Project
> Rail does NOT live inside the Bridge detail pane — it moves into the MAIN LEFT
> COLUMN as a collapsible "Bridge" section, MERGED with the Supervisor panel into
> ONE project→sessions tree (no more duplicate project lists). Decisions:
> (A) merge into one tree — each watched-project row expands to its supervised
> sessions (escalation badge + coordinator dot on the row; supervise/shield on the
> sessions); replaces SupervisorPanel. (B) watch === supervise — adding a project
> to the Bridge supervises its sessions; removing stops (per-session shield still
> opts out). (C) clicking a project row always sets the active Bridge project and
> switches to Bridge mode. The Bridge detail pane keeps only the per-project
> cockpit (no in-pane rail). This supersedes the in-pane rail of phase 3 and the
> CommandBar-dropdown story below.


> Definitive design. Anchored on the winning concept (left-rail master/detail), grafting cross-project triage as the FLEET landing (from escalation-routed / fleet-first) and amber idle-with-work semantics (from split-fleet-and-focus). Local-first, reuse-only, no heavy deps.

---

## 1. VISION

The Bridge stops being one project's cockpit with a project dropdown and becomes **a fleet of cockpits with a permanent index down the left edge**. A vertical **Project Rail** is always present: one row per registered (= watched) project, with a status dot and a red open-escalation badge, **sorted red-first by urgency** — so "which project needs you" is answered by where the eye lands, zero clicks, and the rail never overflows horizontally (it scrolls down, the cheap direction, while the horizontally-hungry detail pane keeps its width).

The rail's pinned top row is **FLEET**. Selecting it swaps the detail pane for a **cross-project triage surface** (every open escalation, project-tagged, urgency-sorted, resolve-in-place + jump-to-focal) plus a per-project **status grid**. The rail answers *which project*; the FLEET detail answers *what decision* — neither requires pre-picking a project. Selecting any project row drops you into **today's single-project Bridge, unchanged**, as the detail pane.

The user said "tabs," but the true need behind the words is *a persistent index of projects with per-project escalation badges* — a vertical rail delivers that strictly better than a horizontal tab strip on the two axes that matter: it **sorts** (urgency floats up) and it **never overflows horizontally**.

One-line success test: a human with 5 projects, glancing for 2 seconds, can name which project is red and the total decisions waiting — then resolve the most urgent or jump into its project — without guessing which tab to open first.

---

## 2. STRUCTURE + ASCII WIREFRAMES

Three altitudes:
- **Altitude 0 — Fleet chrome (CommandBar, top, full width):** the two GLOBAL role switches (Steward, Supervisor) + fleet pulse + `CommandBarBadge` (now the fleet total). Rendered once; physically above and outside the rail so they can never read as per-project.
- **Altitude 1 — Project Rail (left, fixed ~200px, vertical scroll):** FLEET pseudo-row pinned top, then projects urgency-sorted, quiet-fold disclosure, auto-detected affordance, `+ Add project`, type-to-filter input.
- **Altitude 2 — Detail pane (right of rail):** FLEET → cross-project triage + status grid; a project → the existing `SplitDeck` (left zones + `FleetGraph`), unchanged.

### 2a. FLEET row selected — the default landing (glance + triage)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FLEET   Steward ●ON   Supervisor ●ON          ● 23 live · 7 inflight · ▲12 !  │ ← CommandBar (GLOBAL)
├────────────────┬───────────────────────────────────────────────────────────────┤
│ ⌕ filter…      │  FLEET OVERVIEW                                                │
│                │  ┌─ Triage · 12 open across 3 projects ──────────────────────┐ │
│ ◉ FLEET    ▲12 │  │ ▲ projA  "Auth schema: pick JWT vs session"  2m [resolve][→]│ │
│ ──────────────  │  │ ▲ projC  "Migration drops column — confirm"  6m [resolve][→]│ │
│ ● projA  ▲5  ▶ │  │ ▲ projA  "Ready todo blocked on decision"    9m [resolve][→]│ │
│ ● projC  ▲4    │  │ ▲ projB  "Spec coverage gap on /export"     14m [resolve][→]│ │
│ ● projB  ▲3    │  │ … 8 more, urgency-sorted …                                 │ │
│ ──────────────  │  └────────────────────────────────────────────────────────┘ │
│ ▸ 2 quiet      │  ┌─ Fleet status ────────────────────────────────────────────┐│
│ ──────────────  │  │ proj   esc  coordinator   ready  workers                   ││
│ detected:      │  │ projA  ▲5   ● ON           3      4                         ││
│  · projF watch+│  │ projC  ▲4   ○ OFF ⚠ idle   7      0   ← idle-with-work     ││
│ ──────────────  │  │ projB  ▲3   ● ON           1      2                         ││
│ + Add project  │  │ projD  ▲0   ○ OFF          0      0                         ││
│                │  │ projE  ▲0   ● ON           2      1                         ││
│                │  └────────────────────────────────────────────────────────────┘│
└────────────────┴───────────────────────────────────────────────────────────────┘
  ▲ red badge = open escalations   ●/○ = coordinator on/off   ⚠ amber = coord OFF & ready>0
```

### 2b. A project (projC) selected — full depth, rail still present (today's Bridge verbatim)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FLEET   Steward ●ON   Supervisor ●ON          ● 23 live · 7 inflight · ▲12 !  │ ← GLOBAL (unchanged, still fleet total)
├────────────────┬───────────────────────────────────────────────────────────────┤
│ ⌕ filter…      │ projC ── Coordinator ○OFF ⚠ 7 ready   (the ONE per-project switch)│
│                │ ┌─ left zones ───────────┐ ┌─ FleetGraph (projC scoped) ─────┐ │
│ ◉ FLEET    ▲12 │ │ NeedsYouZone  ▲4       │ │        ◯───◯                    │ │
│ ──────────────  │ │  • Migration drops col │ │       ╱  ●RED ╲  (danger ring   │ │
│ ● projA  ▲5    │ │  • …                   │ │      ◯        ◯   on 4 nodes)   │ │
│ ● projC  ▲4  ▶ │ │ RequirementsInbox      │ │       ╲      ╱                  │ │
│ ● projB  ▲3    │ │ HumanInbox             │ │        ◯───◯                    │ │
│ ──────────────  │ │ FleetVitals (funnel)   │ │                                 │ │
│ ▸ 2 quiet      │ │ WorkerRoster (0)       │ │                                 │ │
│ ──────────────  │ │ StreamTicker           │ │                                 │ │
│ + Add project  │ │ TodoDetailView         │ │                                 │ │
│                │ └────────────────────────┘ └─────────────────────────────────┘ │
└────────────────┴───────────────────────────────────────────────────────────────┘
  rail badge ▲4 === NeedsYouZone count === FleetGraph danger ring (one counting path)
```

---

## 3. THE HARD PARTS

### (a) Rail/strip model + overflow + ordering
**Vertical rail, not horizontal tabs.** Vertical scroll is the cheap direction and preserves the detail pane's width. Ordering: **Section 1 "Needs you"** (open-escalation > 0 OR idle-with-work), always visible, red dots first (sorted by `highestPriorityEscalation` then count), amber next; **Section 2 "Quiet"** collapsed by default into a single `▸ N quiet projects` disclosure (reuse the `supervisorCollapsedProjects` map pattern). At 5 projects everything shows; at 30 only the hot ones occupy the rail. A **type-to-filter input** pinned at the rail top is the palette fallback at scale — native `<input>`, no dep, no modal. A red project can never be hidden: an opening escalation promotes its row into Section 1 automatically (the sort recomputes from the live `escalations` list).

### (b) Registered vs watched — COLLAPSE; add/remove flow
Registered = watched. `watchedProjects` (`/api/supervisor/projects`) is the canonical rail set, full stop. **Delete the 5-source `projectOptions` union and the `hiddenProjects` hack.** `AddProjectDialog → addProject` registers + watches + `setActiveProject` (one gesture). Remove via row-hover `×` → `removeProject` (unregister + unwatch); the row leaves the rail immediately (no derived feed re-adds it because the union is gone; if the removed project was active, fall back to FLEET). A live session in a non-watched project surfaces as a dim **"detected: · projF watch+"** affordance at the rail bottom (`supervised`/`subscriptions` minus `watchedProjects`) — one click runs `addProject`. Nothing silently appears as a tab; nothing silently fails to produce signal.

### (c) Global Steward/Supervisor vs per-project Coordinator
**Physical separation by altitude.** Steward + Supervisor render exactly once in the CommandBar (Altitude 0), in fleet chrome with a "FLEET" label, never near a project name. The **Coordinator switch is the only role control in the detail pane** (Altitude 2), labeled with the project name ("Coordinator · projC"), keyed on `coordinatorByProject[project]`. Two switches up top = fleet; one switch in the body = this project. `RolesStrip` is stripped to Coordinator-only. On the FLEET status grid, coordinator appears as a read-with-inline-toggle state per project (with an amber idle-with-work warning), never styled like the global cluster.

### (d) Escalation roll-up — per-project badges vs the global CommandBarBadge (ONE counting path)
One new pure selector over the existing global flat `escalations` list:

```ts
// escalationSelectors.ts
export const selectOpenEscalationsByProject = (
  escalations: Escalation[],
): Record<string, number> =>
  escalations.reduce((m, e) => {
    if (e.status === 'open') m[e.project] = (m[e.project] ?? 0) + 1;
    return m;
  }, {} as Record<string, number>);
```

Every count derives from it:
- **Rail row badge** for `p` = `counts[p] ?? 0`.
- **FLEET row badge** + re-pointed **`CommandBarBadge`** = `Object.values(counts).reduce((a,b)=>a+b,0)` (≡ `escalations.filter(e => e.status==='open').length`). This also fixes the latent `activeProjectPref ?? currentProject ?? supervised[0]` divergence by removing project scoping from the badge entirely.
- **Per-project detail** keeps `selectOpenEscalations(escalations, p)`, whose `.length` === `counts[p]` by construction → **FleetGraph danger-ring ⟺ rail badge ⟺ NeedsYouZone parity holds per project**, no second path.

### (e) Zone reflow
- **NeedsYouZone, RequirementsInbox, HumanInbox, FleetVitals, WorkerRoster, StreamTicker, TodoDetailView, FleetGraph** — unchanged, reused verbatim as the per-project detail; they already take scoped props.
- **RolesStrip** — gutted to Coordinator-only (Steward/Supervisor hoisted to CommandBar).
- **FleetGraph** — stays per-project. We deliberately **do NOT** build an all-watched-todos union graph (unproven perf/legibility). The FLEET altitude uses the cheaper **status grid** (rows = projects, click to drill) instead — a better switcher at scale.
- **New FLEET detail** = `CrossProjectTriage` (flat list, project-tagged, urgency-sorted, resolve/jump) + `FleetStatusGrid` (per-project counts/coord/ready/workers, amber idle-with-work).

---

## 4. SIGNATURE INTERACTIONS

1. **Switch project (1 click / ↑↓).** Click a rail row → `setActiveProject(p)`; detail swaps to that project's Bridge. Per-project scroll/focal/selected-todo restored from `bridgeViewState[p]` (uiStore) so return feels stateless. FleetGraph never remounts (SplitDeck invariant).
2. **Cross-project triage (no pre-select).** Land on FLEET (default). Triage list = every open escalation, project-tagged, urgency-sorted (`highestPriorityEscalation` then `createdAt`). `[resolve]` calls `escalation_resolve` in place — rail badge, FLEET badge, and graph ring all decrement together (one selector). `[→]` jumps: `setActiveProject(esc.project)` + `deckStore` focal via `nodeIdForEscalation(esc, todosByProject[esc.project])`.
3. **Add / remove.** `+ Add project` → `AddProjectDialog` → `addProject` (register + watch + focus). Remove via row-hover `×` → `removeProject`. Detected affordance `· projF watch+` → `addProject`.
4. **Filter-to-jump (15+ fallback).** Focus the rail `⌕ filter…`, type → rows filter live by name; Enter selects top match → `setActiveProject`. No new dep, no modal.
5. **Idle-with-work nudge (passive fleet failure surfacing).** Any project with `!coordinatorByProject[p] && readyCount>0` shows amber `⚠` on its rail dot and grid row, with inline `[start coord]` (`setCoordinator(p,'start')`) — fix the silent fleet stall without drilling in.
6. **Keyboard.** `⌘1` = FLEET; `⌘2..9` = Nth rail row (urgency order, so the worst project is always `⌘2`); `[`/`]` cycle rows.

---

## 5. VISUAL / INFO DESIGN

- **Rail row:** `[dot] name  ▲N  [×on hover] [▶ if active]`. Dot: red = open escalations, amber = idle-with-work, hollow grey = quiet. Badge `▲N` red, hidden if 0. Active row filled + `▶`.
- **One-red discipline preserved per row** — a row is red iff `counts[p] > 0`; amber is strictly the idle-with-work warning and only shows when not red.
- **FLEET row** visually distinct (pinned, `◉`, bordered separator below). Its badge is the fleet sum.
- **Triage rows** lead with the priority glyph (`▲` decision-class via `highestPriorityEscalation`, `•` lower), then project tag, title, age, actions.
- **Status grid** is a compact table; amber idle-with-work is the only attention color besides red escalation counts.
- Fleet pulse in CommandBar stays summed: `● live · ⟳ in-flight · ▲ needs-you`.

---

## 6. TECHNICAL PLAN

### New components (`ui/src/components/supervisor/bridge/`)
- `ProjectRail.tsx` — vertical master: FLEET pseudo-row, urgency-sorted rows, quiet-fold, detected affordance, `+ Add`, filter input.
- `ProjectRailRow.tsx` — one row (dot / badge / hover-× / active ▶).
- `FleetOverview.tsx` — FLEET detail composing `CrossProjectTriage` + `FleetStatusGrid`.
- `CrossProjectTriage.tsx` — flat project-tagged open-escalation list (reuse NeedsYouZone item rendering + `escalation_resolve` + jump).
- `FleetStatusGrid.tsx` — per-project status table from the byProject maps; amber idle-with-work + inline start-coord.

### Reuse unchanged
`SplitDeck`, `FleetGraph`, `NeedsYouZone`, `RequirementsInbox`, `HumanInbox`, `FleetVitals`, `WorkerRoster`, `StreamTicker`, `TodoDetailView`, `AddProjectDialog`; selectors `selectOpenEscalations`, `highestPriorityEscalation`, `nodeIdForEscalation`; store maps `coordinatorByProject` / `todosByProject` / `requirementsByProject` / `coverageByProject` / `watchedProjects` / `supervised` / `subscriptions`; actions `addProject` / `removeProject` / `setCoordinator` / `startRole` / `stopRole` / `setActiveProject`.

### Modify
- `RolesStrip.tsx` → Coordinator-only (drop Steward/Supervisor).
- `CommandBar.tsx` → host Steward/Supervisor global switches + "FLEET" label; **delete the project-selector dropdown** (rail replaces it); fleet-summed pulse.
- `CommandBarBadge.tsx` → count = `sum(selectOpenEscalationsByProject(escalations))`.
- `BridgeDashboard.tsx` → render `[ProjectRail | detail]`; detail = `activeProject==='__fleet__' ? <FleetOverview/> : <existing SplitDeck scoped>`. **Replace** the 5-source `projectOptions` union + `hiddenProjects` with `watchedProjects`. **`resyncBridge` loops** `loadProjectTodos` / `loadCoordinator` / `loadRequirements` / `loadCoverage` over ALL `watchedProjects` (keyed `[serverScope, watchedProjects]`, re-run on WS reconnect) so rail badges/grid are live without visiting each project; `loadEscalations` stays one global fetch.

### Selectors (add one)
`selectOpenEscalationsByProject(escalations): Record<string, number>` — single `reduce`, the sole roll-up path (rail badges + FLEET badge + CommandBarBadge + grid). `selectOpenEscalations` unchanged for per-project detail (and equal by construction → parity).

### Stores
- `uiStore`: `activeProject` already exists; reserve sentinel `'__fleet__'` for FLEET. Add `bridgeViewState: Record<string, {scroll?:number; focalNode?:string; selectedTodo?:string}>` (mirror `supervisorCollapsedProjects`); reuse `supervisorCollapsedProjects` for the quiet-fold.
- No new store, no new WS events, no new server endpoints. `coordinator_status` WS → `applyCoordinatorStatus` already exists; escalations arrive via existing `loadEscalations`/WS.

### Deps
None. Vertical scroll, filter input, fold = native HTML/CSS + existing zustand stores.

### Phased build order (each independently shippable, Bridge stays working)
1. Add `selectOpenEscalationsByProject` + re-point `CommandBarBadge` to fleet sum. *(Pure data; ships fleet-total immediately; verifies parity against existing per-project count; fixes the latent divergence.)*
2. Loop per-project loaders over `watchedProjects` in `resyncBridge`. *(Rail/grid data goes live.)*
3. Build `ProjectRail` + `ProjectRailRow` (urgency sort, badges) wired to `setActiveProject`; mount left of `SplitDeck`. Delete `projectOptions` union + `hiddenProjects` + the CommandBar project dropdown.
4. Hoist Steward/Supervisor into `CommandBar`; strip `RolesStrip` to Coordinator-only.
5. Build `FleetOverview` (`CrossProjectTriage` + `FleetStatusGrid`) behind the `'__fleet__'` sentinel; make FLEET the default landing.
6. Polish: quiet-fold, filter-to-jump, amber idle-with-work, `bridgeViewState` restore, `⌘1..9`.

---

## 7. WHY OVER ALTERNATIVES + TOP RISKS

**Why the rail over horizontal tabs (literal-tabs / strip concepts):** tabs are positional and static; the rail **sorts** urgency to the top (answering "which needs you" by eye position) and **never overflows horizontally** — the exact failure the brief flagged. The detail pane is horizontally hungry; we spend a narrow vertical gutter, not scarce width.

**Why FLEET-as-a-rail-row over a full fleet "mode" (fleet-first):** keeps projects as the primary index (the user thinks in projects) while still giving a real cross-project triage surface — without the heaviest build or the unproven all-todo union graph.

**Why not invert to a pure queue (escalation-routed):** overreaches the literal ask ("tabs/projects," not "a queue") and demotes the project facet too far for a project-oriented user. We keep the queue as FLEET-row *content*, not the whole paradigm.

**Dropped:** all-watched-todos union FleetGraph (perf/legibility risk → status grid instead); horizontal tab strips (overflow failure mode); the triage *drawer* overlay (the FLEET row already IS the triage surface — no modal to maintain).

**Top risks:**
1. **Rail eats ~200px** the dense detail pane wants. Mitigate: narrow rail (icons + short names + badge), collapsible to an icon-only mini-rail; the quiet-fold keeps it short.
2. **Loading all watched projects on resync** could be chatty at 15+. Mitigate: the loaders already exist and are cheap; batch on reconnect; escalations (the headline signal) is a single global fetch regardless.
3. **Parity drift** if any consumer counts escalations independently. Mitigate: `selectOpenEscalationsByProject` is the single path; `selectOpenEscalations(...).length === counts[p]` by construction — enforce via a unit test in phase 1.
