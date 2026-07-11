# Wireframe — Plan section (compact, in the left column)

Detail of the **Plan** accordion section from [[wireframe-pcs-left-column]]. The Plan section is the sidebar-compact counterpart to the full dependency/wave graph (which lives in the System Map / `RoadmapPanel`). It must carry four jobs in a narrow column without clutter: (1) show the plan = epics → todos with status, (2) surface live work (claimed/in-flight + watchdog), (3) be the **plan-level approval** surface, (4) be the entry to **planner conversations** (epic = thread, `/focus`).

## Anatomy

```
┌ ▾ Plan — myproj           5 epics · ⚠1   ⤢ ┐  header: counts · escalations · ⤢ open full graph
│ [All] Ready In-flight Blocked               │  quick filter chips (sidebar stays a tree; Waves/Graph live in ⤢)
│ ⚑ 3 todos awaiting approval        [review] │  plan-level approval banner (only when pending)
│ 📌 constraints (4)                           │  project-level active constraints (collapsed peek)
│ ───────────────────────────────────────────│
│ ▾ ● Auth refactor             5/6    💬     │  EPIC (parentId group): status · progress · discuss(thread)
│     ✓ token-store                            │  done
│     ◐ login-form          fe · ⟳            │  in-flight: agent profile + live worker (click → its tmux)
│     ◷ oauth-callback      ready              │  ready → coordinator will claim
│     ⊘ refresh-rotation    ⊘ login-form      │  blocked: shows the dep it waits on
│     ⚠ session-model       decision          │  escalation on this todo (click → escalation inbox)
│ ▸ ◐ Onboarding flow           1/4    💬•    │  • = unread planner output in this thread
│ ▸ ○ Perf budget               0/3    ⚠1    │
│ ▸ ◷ Telemetry                 0/2          │
│ ───────────────────────────────────────────│
│ [ + discuss a new epic ]                     │  start a new thread with the Planner
└──────────────────────────────────────────────┘
legend: ● done  ◐ in-progress  ◷ ready  ○ planned  ⊘ blocked  ⚠ needs-decision
```

## Hierarchy
- **2 levels in the sidebar**: Epic (top-level `parentId` group) → Todo. Deeper `parentId` nesting + the dependency edges render in the **full graph (⤢)**, not the sidebar — keeps the column scannable.
- Epic status = a rollup of its todos (in-progress if any child is; blocked if all remaining are blocked; done when all done). Progress `done/total` on the right.

## Row badges (right-aligned, compact)
- **Worker/profile** on an in-flight todo: `fe · ⟳` (profile tag + live spinner). Click → jump to that worker's tmux (`onJump` → `activateSessionCard`).
- **Dep marker** on a blocked todo: `⊘ <dep title>` — what it's waiting on. Click → scroll to that todo.
- **⚠ decision**: an open escalation for this item. Click → focus it in the Escalations inbox.
- **Watchdog**: if a worker on a todo is near 80% context, a small `◷80%` amber tick on that row (rare; usually a too-big-todo signal).

## View modes / filters
- Sidebar default = **Epics tree** + filter chips: **All / Ready / In-flight / Blocked** (flat-filter the tree to matching todos). Keeps it light.
- **Waves** and the **dependency Graph** are NOT in the sidebar — they open via **⤢** in the full Plan view / System Map (`RoadmapPanel` graph/waves modes, reusing `roadmapToMermaid` + `MermaidPreview`). The sidebar is for scanning + acting; the graph is for structure.

## Plan-level approval (the human gate)
- The Planner proposes todos as `planned`. They do NOT execute until **approved** → flipped to `ready` (only the Planner sets `ready`; the Coordinator never self-promotes).
- Surfaced as the **⚑ awaiting-approval banner** with `[review]`. Review opens a focused list of `planned` items (grouped by epic) with approve / defer / edit. Approving flips them to `ready`; the Coordinator then claims them.
- This is the single place the human exercises plan-level approval — consistent with decision 3 (approve the plan, not each spawn).

## Planner-conversation integration (epic = thread)
- **💬 on an epic** opens/resumes the **Planner focused on that epic** (`/focus <epic>`) in the main area (PlannerView conversation). `•` = unread planner output since you last looked.
- **[ + discuss a new epic ]** starts a new thread with the Planner (creates a new top-level item once the thread yields one).
- This is the bridge between the **plan data** (todos/graph — structure & status) and the **planner narrative** (the "why", reasoning) — exactly the two-memories split: the sidebar shows structure; 💬 takes you to the narrative.

## Decision records & constraints
- **📌 constraints (N)** at the Plan header = the project's **active constraints** (collapsed peek; expand to read). Every planner pass reads/updates these — surfacing them here keeps cross-epic constraints visible.
- Per-epic decisions live inside that epic's thread (💬); a small 📌count can appear on an epic row if it carries epic-specific constraints. Don't inline the full decision text in the tree — it's narrative, lives in the thread.

## States
- **No plan yet** → "No plan for myproj. [ + discuss with Planner ]".
- **Planner not running** → plan still renders (it's durable todos); 💬 offers to start/resume the Planner. (Planner is reuse+clear, so "resume" reads its constraints/summaries.)
- **Awaiting approval** → the ⚑ banner.
- **All done** → epics collapse to a ✓ summary; "nothing ready" quiet state.

## Reuse map
| Element | Reuse | Change |
|---------|-------|--------|
| Epic→todo tree | `TodosTreeSection` | project-scoped; group by `parentId`; dep-aware status glyphs; filter chips |
| Todo detail (click) | `TodoDetailView` | open in viewer |
| In-flight → tmux | `onJump`/`activateSessionCard` (from `SessionCard`) | jump from a todo row |
| ⚠ → escalation | `EscalationInbox` (scoped) | focus the matching item |
| ⤢ full graph | `RoadmapPanel` (graph/waves) + `roadmapToMermaid` + `MermaidPreview` | re-point to project todos |
| 💬 planner thread | new `PlannerView` (Phase 5) | `/focus` an epic |
| ⚑ approve flow | new small review list | flips `planned`→`ready` |

## Open
- Filter chips vs a single status dropdown (space in a narrow column).
- Should `[review]` approval be inline-expand or open in the main area? (Lean: inline expand for small counts, main-area list for many.)
- Per-epic 📌 count — worth the noise, or keep constraints project-level only at first? (Lean: project-level only v1.)
