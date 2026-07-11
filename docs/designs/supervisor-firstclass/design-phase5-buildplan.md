# Phase 5 — UI tri-view (Planner / Coordinator / Supervisor) — Build Plan

Decomposition for todo #e180eef0. Data-model decisions are LOCKED in `design-planner-coordinator-supervisor` (3 Grok consults); this is build-only.

## Grounding (verified in code)
- **`src/services/todo-store.ts` IS the unified work-graph store** — per-project, `listTodos(project, filter)`, `computeWaves(todos)` (line 437), work-graph cols (`claimedBy`,`claimToken`,`kind`,`acceptanceStatus`,`retryCount`). Phase 1 deliverable. **Todos are already project-scoped** → `listTodos(project)` IS `loadProjectTodos`.
- **`src/services/roadmap-store.ts` is the OLD separate `roadmap_item` table.** Phase 5 re-points the Plan off it onto unified todos.
- UI: `RoadmapPanel` reads `supervisorStore.roadmapByProject` (from `/api/supervisor/roadmap` → roadmap-store). `roadmapToMermaid.ts` has its own `computeWaveMap` (UI) — separate from todo-store `computeWaves` (backend).
- `roadmapToMermaid` only uses `{id,title,status,parentId,dependsOn}` → trivial to generalize. Both `Todo` (`order`) and `RoadmapItem` (`ord`) satisfy that subset.
- `uiStore` has NO `supervisorRole`/`activeProject`; view routing = `supervisorViewOpen` flag.
- UI api: `getSessionTodos(project, session)` → `/api/session-todos?...`. Need a project-wide list path.

## Wave 0 — Foundation (no visible change; unblocks all) ← START HERE
- **F1** `ui/src/types/planItem.ts`: `export interface PlanItem { id: string; title: string; status: string; parentId?: string|null; dependsOn?: string[]; }`. Assert `RoadmapItem` & `SessionTodo` assignable.
- **F2** Generalize `roadmapToMermaid.ts` to `PlanItem[]`; `export` `computeWaveMap`. No behavior change for roadmap.
- **F3** `uiStore`: add `supervisorRole: 'supervisor'|'planner'|'coordinator'` (default 'supervisor') + setter; `activeProject: string|null` + setter; persist both.
- **F4** Project-wide todos: backend route returning `listTodos(project)` (all sessions) — extend `/api/session-todos?project=` (no session) OR new `/api/supervisor/todos?project=`. + `supervisorStore.todosByProject: Record<string,SessionTodo[]>` + `loadProjectTodos(serverId, project)` + UI api method.

## Wave 1 — Plan on todos
- **P1** New `PlanPanel` (or RoadmapPanel re-point): render `todosByProject[activeProject]` as PlanItem via graph/waves/list (reuse generalized fns).
- **P2** Compact project-Plan tree: epics = `parentId` groups, dep-aware status glyphs; sort by phase/wave then id; completed bottom; in_progress pinned. Sidebar counterpart to the graph.

## Wave 2 — Views + role switch
- **V1** `PlannerView` — plan = todos + plan-level approval action (mark approved-todos `ready`; Planner is sole promoter).
- **V2** `CoordinatorView` — ready / in-flight: workers ↔ claimed todos, coordinator daemon status (`start_coordinator` state), unblock view.
- **V3** Role switcher (header shield menu or left column) → `uiStore.supervisorRole`; render Supervisor|Planner|Coordinator. Keep existing SupervisorView.

## Wave 3 — Left column project-scope (wireframe-pcs-left-column)
- **L1** SYSTEM pinned-top (global supervisor health + watchdog rollup + cross-project EscalationInbox + System Map btn) / PROJECT selector (`activeProject`) driving scoped Plan + Sessions-Workers(+coordinator status) + scoped Escalations + Artifacts / SERVERS bottom. Reuse EscalationInbox(global+filtered), SessionCard, ArtifactTree, ServersTreeSection, TodosTreeSection→project-scoped+deps. Header unchanged this pass.

## Verify per wave
- `cd ui && bunx tsc --noEmit` (or repo build) green; `npm run test:ci` for touched UI.
- Visual: serve repo `ui/dist` + reload app (env `-u MERMAID_RESOURCES_PATH`), screenshot each new view.
- Backend route: per-file `bun test` (NOT full-dir — pre-existing vi.mock leak).
