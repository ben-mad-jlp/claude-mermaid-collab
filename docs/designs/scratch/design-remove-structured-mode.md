# Design: Remove Structured Mode

## Goal

Remove the state machine / structured mode entirely. Vibe mode becomes the only way to use collab. The three vibe skills (`/vibe-blueprint`, `/vibe-go`, `/vibe-review`) replace everything the structured workflow did.

## What Gets Deleted

### src/mcp/workflow/ (keep task-sync.ts, task-status.ts, types.ts partially)

| File | Action | Reason |
|------|--------|--------|
| `state-machine.ts` | DELETE | 30+ state definitions, no longer needed |
| `complete-skill.ts` | DELETE | Skill routing orchestrator, replaced by vibe skills |
| `transitions.ts` | DELETE | Phase routing logic, replaced by vibe skills |
| `task-diagram.ts` | DELETE | Structured execution diagram, unused in vibe |
| `task-sync.ts` | KEEP | `sync_task_graph` tool used by vibe-blueprint |
| `task-status.ts` | KEEP | `update_task_status` tool used by vibe-go agents |
| `types.ts` | TRIM | Remove structured-only types: `StateId`, `WorkflowState`, `WorkItem`, `SessionType`. Keep `TaskBatch`, `TaskGraphTask`, `TaskStatus` |

### src/mcp/workflow/__tests__/

| File | Action |
|------|--------|
| `state-machine.test.ts` | DELETE |
| `complete-skill.test.ts` | DELETE |
| `transitions.test.ts` | DELETE |
| `task-sync-fallback.test.ts` | DELETE (fallback relied on work items) |
| `task-status.test.ts` | KEEP |
| `types.test.ts` | TRIM (remove structured type tests) |

### MCP Tools (src/mcp/setup.ts)

| Tool | Action |
|------|--------|
| `complete_skill` | DELETE |
| `update_session_state` | DELETE |
| `get_session_state` | DELETE |
| `update_task_status` | KEEP |
| `update_tasks_status` | KEEP |
| `get_task_graph` | KEEP |
| `sync_task_graph` | KEEP |
| `set_artifact_metadata` | KEEP |

### src/mcp/tools/collab-state.ts

**Trim, don't delete.** This file manages session state persistence. Remove structured-only fields, keep the file for what vibe still needs.

Fields to remove from `CollabState`:
- `state` — current state machine state ID
- `sessionType` — 'structured' | 'vibe' (will just always be vibe)
- `currentItem` — work item index
- `currentItemType` — 'code' | 'task' | 'bugfix'
- `workItems` — array of work items
- `currentBatch` — current batch index
- `displayName` — derived from state machine state
- `totalItems`, `documentedItems` — brainstorm phase counters
- `autoAllowRoughDraft` — structured preference

Fields to keep (used by vibe task graph):
- `batches` — TaskBatch[] written by sync_task_graph, read by get_task_graph
- `completedTasks` — task IDs marked done by vibe-go agents
- `pendingTasks` — task IDs still pending

### UI Components

| File | Action |
|------|--------|
| `ui/src/components/dialogs/CreateSessionDialog.tsx` | SIMPLIFY — remove mode picker (structured vs vibe), just create session |
| `ui/src/components/SessionStatusPanel.tsx` | DELETE — shows state machine phase/progress |
| `ui/src/components/dashboard/WorkItemsList.tsx` | DELETE — shows structured work items |
| `ui/src/components/dashboard/WorkItemsList.test.tsx` | DELETE |
| `ui/src/components/SessionStatusPanel.test.tsx` | DELETE |

### Skills

| Directory | Action |
|-----------|--------|
| `skills/brainstorming-*/` | DELETE (4 skills) |
| `skills/rough-draft-*/` | DELETE (2 skills) |
| `skills/executing-plans*/` | DELETE (3 skills) |
| `skills/collab-start/` | DELETE |
| `skills/gather-session-goals/` | DELETE |
| `skills/ready-to-implement/` | DELETE |
| `skills/finishing-a-development-branch/` | DELETE |
| `skills/collab-cleanup/` | DELETE |
| `skills/systematic-debugging/` | KEEP (used by vibe-review) |
| `skills/vibe-active/` | KEEP |
| `skills/vibe-blueprint/` | KEEP |
| `skills/vibe-go/` | KEEP |
| `skills/vibe-review/` | KEEP |
| `skills/executing-plans-bugreview/` | KEEP (still referenced by vibe-review) |

### Other Files

| File | Action |
|------|--------|
| `src/routes/api.ts` | TRIM — remove `getDisplayName` import and state-machine state from session response |
| `src/services/collab-manager.ts` | TRIM — remove `getDisplayName` usage |

## What the Session Creates Flow Becomes

**Before:** User picks Structured vs Vibe at session creation. Structured starts a state machine. Vibe is freeform.

**After:** Session creation has no mode picker. Every session is a canvas. User creates docs/diagrams, then runs `/vibe-blueprint` when ready to implement.

The `CreateSessionDialog` keeps: name input, project selection. Removes: mode selection radio, structured mode description.

## State Shape After

```typescript
interface CollabState {
  batches?: TaskBatch[];       // Task graph waves, written by sync_task_graph
  completedTasks?: string[];   // Completed task IDs
  pendingTasks?: string[];     // Pending task IDs
}
```

Everything else moves to the vibe session's document artifacts.

## Acceptance Criteria

- [ ] No reference to `complete_skill` anywhere in codebase
- [ ] No reference to `sessionType`, `structured`, `state machine` in src/
- [ ] `CreateSessionDialog` has no mode picker
- [ ] `SessionStatusPanel` is gone
- [ ] `WorkItemsList` is gone
- [ ] All brainstorming/rough-draft/executing-plans skills deleted
- [ ] `sync_task_graph`, `update_task_status`, `get_task_graph`, `set_artifact_metadata` still work
- [ ] Sidebar Blueprint section still works
- [ ] Creating a session → using `/vibe-blueprint` → `/vibe-go` works end to end
- [ ] `npm run test:ci` passes
