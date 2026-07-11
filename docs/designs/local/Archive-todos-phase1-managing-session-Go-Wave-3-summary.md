# Wave 3 Implementation (todos Phase 1)

## Task
- **manager-dashboard** ✅ — modest manager view: owned todos grouped by assignee.
  - `ui/src/lib/todoGrouping.ts`: pure `groupByAssignee(todos)` (unassigned bucket first, then alphabetical; ordered within) + `statusCounts(todos)`. Tests (2).
  - `ui/src/components/todos/ManagerDashboard.tsx`: presentational — filters to `ownerSession === me`, renders each assignee group with a per-status dot summary + the todos (read-only overview; assignment/status edits happen on the main rows).
  - Mounted via a **"Manager" toggle** in `TodosTreeSection` filter row (reuses the already-loaded `sessionTodos` — no App.tsx surgery, no new data loading, no routing). When on, renders `<ManagerDashboard>` instead of the flat list.

## Verification
- `todoGrouping.test.ts`: 2/2 pass.
- tsc: clean on todoGrouping.ts, ManagerDashboard.tsx, TodosTreeSection.tsx.

## Notes
- Full cross-session Kanban board is deferred (design). This is the modest list-grouped view.
- Read-only by design; the assignee picker + status cycle on the rows handle edits.

## Wave TSC
clean for this wave's files
