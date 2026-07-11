# Blueprint: Remove Structured Mode

## Source Artifacts
- design-remove-structured-mode

---

## 1. Structure Summary

### Files to Delete

**Workflow core (src/mcp/workflow/):**
- `src/mcp/workflow/state-machine.ts` — 30+ state definitions, getDisplayName
- `src/mcp/workflow/complete-skill.ts` — skill routing orchestrator
- `src/mcp/workflow/transitions.ts` — phase routing / batch logic
- `src/mcp/workflow/task-diagram.ts` — structured execution diagram

**Workflow tests:**
- `src/mcp/workflow/__tests__/state-machine.test.ts`
- `src/mcp/workflow/__tests__/complete-skill.test.ts`
- `src/mcp/workflow/__tests__/transitions.test.ts`
- `src/mcp/workflow/__tests__/task-sync-fallback.test.ts`

**UI components:**
- `ui/src/components/SessionStatusPanel.tsx`
- `ui/src/components/SessionStatusPanel.test.tsx`
- `ui/src/components/dashboard/WorkItemsList.tsx`
- `ui/src/components/dashboard/__tests__/WorkItemsList.test.tsx`

**Structured skills:**
- `skills/brainstorming-exploring/`
- `skills/brainstorming-clarifying/`
- `skills/brainstorming-designing/`
- `skills/brainstorming-validating/`
- `skills/rough-draft-blueprint/`
- `skills/rough-draft-confirm/`
- `skills/executing-plans/`
- `skills/executing-plans-completeness/`
- `skills/executing-plans-execution/`
- `skills/collab-start/`
- `skills/gather-session-goals/`
- `skills/ready-to-implement/`
- `skills/finishing-a-development-branch/`
- `skills/collab-cleanup/`
- `skills/task-planning/`
- `skills/convert-to-structured/`

### Files to Modify

| File | Change |
|------|--------|
| `src/mcp/workflow/types.ts` | Remove: `StateId`, `WorkflowState`, `TransitionCondition`, `Transition`, `CompleteSkillInput`, `CompleteSkillOutput`, `WorkItemType`, `ItemStatus`, `WorkItemStatus`, `WorkItem`, `SessionType`. Keep: `TaskBatch`, `BatchTask` |
| `src/mcp/workflow/__tests__/types.test.ts` | Remove tests for deleted types, keep BatchTask/TaskBatch tests |
| `src/mcp/tools/collab-state.ts` | Remove structured fields from `CollabState` and `StateUpdateParams`; remove `getDisplayName` import; remove `SessionType`/`WorkItem`/`WorkItemType` imports |
| `src/mcp/setup.ts` | Delete `complete_skill`, `update_session_state`, `get_session_state` tool definitions + handlers |
| `src/routes/api.ts` | Remove `getDisplayName` import; remove `sessionType` from POST /api/sessions body; remove displayName computation block in GET session state |
| `src/services/collab-manager.ts` | Remove `getDisplayName` import; remove `displayName` field from session list response |
| `src/services/session-registry.ts` | Remove `sessionType` param; change initial `collab-state.json` to not set `state` or `sessionType` |
| `ui/src/lib/api.ts` | Remove `sessionType` from `createSession` signature and call |
| `ui/src/components/layout/Header.tsx` | Remove `SessionStatusPanel` import and `<SessionStatusPanel variant="inline" />` render |
| `ui/src/components/dialogs/CreateSessionDialog.tsx` | Remove mode picker (structured/vibe radio), `SessionType` local type, `selectedType` state; confirm button no longer requires type selection |
| `ui/src/components/dashboard/index.ts` | Remove `WorkItemsList` export |

### Type Definitions After

```typescript
// src/mcp/workflow/types.ts — trimmed to just what vibe needs
export interface TaskBatch {
  id: string;
  tasks: BatchTask[];
  status: 'pending' | 'in_progress' | 'completed';
}

export interface BatchTask {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependsOn: string[];
}
```

```typescript
// src/mcp/tools/collab-state.ts — CollabState after trim
export interface CollabState {
  lastActivity: string;
  batches?: TaskBatch[];
  completedTasks?: string[];
  pendingTasks?: string[];
  useRenderUI?: boolean;
  nextSkill?: string | null;
  createdSnippets?: string[];
  updatedSnippets?: string[];
  deletedSnippets?: string[];
}
```

### Component Interactions After

```
User creates session (name only, no type picker)
  → session-registry writes minimal collab-state.json (no state/sessionType)
  → UI shows sidebar with no StatusPanel
  → User creates artifacts, runs /vibe-blueprint
  → sync_task_graph writes batches to collab-state.json
  → /vibe-go agents read batches, update task status
```

---

## 2. Function Blueprints

### `CreateSessionDialog` — simplified

**Before:** requires `selectedType` (structured | vibe) before enabling Create button.

**After:**
- Remove `SessionType` local type export
- Remove `selectedType` state and `sessionTypes` array
- Remove the "Session Type" section entirely from JSX
- Change `onConfirm` signature: `(name: string, useRenderUI: boolean) => void`
- Enable Create button when `sessionName.trim()` is truthy (no type check)
- Keep: session name input, browser UI toggle, Cancel/Create buttons
- Update all callers of `onConfirm` that pass a `type` argument

### `session-registry.register()` — remove sessionType

**Before:**
```typescript
register(project, session, sessionType?: 'structured' | 'vibe', useRenderUI?)
// writes: { state: 'collab-start', sessionType: sessionType || 'structured', ... }
```

**After:**
```typescript
register(project, session, useRenderUI?)
// writes: { lastActivity: now, useRenderUI: useRenderUI ?? true }
```

Remove `state`, `sessionType`, and `currentItem` from the initial collab-state.json.

### `collab-manager.getSessionList()` — remove displayName

**Before:** `displayName: state.state ? getDisplayName(state.state) : 'Starting'`

**After:** remove `displayName` field from session list response and from `CollabSession` interface if present.

### `setup.ts` — remove 3 tools

Delete entire tool definition + handler blocks for:
- `complete_skill`
- `update_session_state`
- `get_session_state`

Also remove their imports from `complete-skill.ts` and `transitions.ts` (which are being deleted).

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: delete-workflow-core
    files:
      - src/mcp/workflow/state-machine.ts
      - src/mcp/workflow/complete-skill.ts
      - src/mcp/workflow/transitions.ts
      - src/mcp/workflow/task-diagram.ts
      - src/mcp/workflow/__tests__/state-machine.test.ts
      - src/mcp/workflow/__tests__/complete-skill.test.ts
      - src/mcp/workflow/__tests__/transitions.test.ts
      - src/mcp/workflow/__tests__/task-sync-fallback.test.ts
    tests: []
    description: "Delete state machine, complete-skill, transitions, task-diagram and their tests"
    parallel: true
    depends-on: []

  - id: delete-structured-skills
    files:
      - skills/brainstorming-exploring/
      - skills/brainstorming-clarifying/
      - skills/brainstorming-designing/
      - skills/brainstorming-validating/
      - skills/rough-draft-blueprint/
      - skills/rough-draft-confirm/
      - skills/executing-plans/
      - skills/executing-plans-completeness/
      - skills/executing-plans-execution/
      - skills/collab-start/
      - skills/gather-session-goals/
      - skills/ready-to-implement/
      - skills/finishing-a-development-branch/
      - skills/collab-cleanup/
      - skills/task-planning/
      - skills/convert-to-structured/
    tests: []
    description: "Delete all structured-mode skill directories"
    parallel: true
    depends-on: []

  - id: delete-structured-ui
    files:
      - ui/src/components/SessionStatusPanel.tsx
      - ui/src/components/SessionStatusPanel.test.tsx
      - ui/src/components/dashboard/WorkItemsList.tsx
      - ui/src/components/dashboard/__tests__/WorkItemsList.test.tsx
    tests: []
    description: "Delete SessionStatusPanel and WorkItemsList components and their tests"
    parallel: true
    depends-on: []

  - id: trim-workflow-types
    files: [src/mcp/workflow/types.ts, src/mcp/workflow/__tests__/types.test.ts]
    tests: []
    description: "Trim types.ts to only TaskBatch and BatchTask; trim types.test.ts accordingly"
    parallel: false
    depends-on: [delete-workflow-core]

  - id: trim-collab-state
    files: [src/mcp/tools/collab-state.ts, src/mcp/tools/__tests__/collab-state-sessiontype.test.ts]
    tests: []
    description: "Remove structured fields from CollabState/StateUpdateParams; remove getDisplayName/SessionType/WorkItem imports; delete collab-state-sessiontype.test.ts"
    parallel: false
    depends-on: [trim-workflow-types]

  - id: trim-mcp-setup
    files: [src/mcp/setup.ts]
    tests: []
    description: "Remove complete_skill, update_session_state, get_session_state tool definitions and handlers"
    parallel: false
    depends-on: [delete-workflow-core]

  - id: trim-backend-routes
    files:
      - src/routes/api.ts
      - src/services/collab-manager.ts
      - src/services/session-registry.ts
    tests: []
    description: "Remove getDisplayName imports, sessionType param from session creation, displayName from session list, currentItem from initial state"
    parallel: false
    depends-on: [delete-workflow-core]

  - id: simplify-create-session-dialog
    files: [ui/src/components/dialogs/CreateSessionDialog.tsx]
    tests: []
    description: "Remove mode picker, SessionType type, selectedType state; simplify onConfirm to (name, useRenderUI); update callers"
    parallel: false
    depends-on: [delete-structured-ui]

  - id: trim-ui-layer
    files:
      - ui/src/lib/api.ts
      - ui/src/components/layout/Header.tsx
      - ui/src/components/dashboard/index.ts
    tests: []
    description: "Remove sessionType from api.createSession; remove SessionStatusPanel from Header; remove WorkItemsList from dashboard index"
    parallel: false
    depends-on: [delete-structured-ui]

  - id: build-verify
    files: []
    tests: []
    description: "Run npm run test:ci to verify clean build and all tests pass"
    parallel: false
    depends-on: [trim-workflow-types, trim-collab-state, trim-mcp-setup, trim-backend-routes, simplify-create-session-dialog, trim-ui-layer]
```

### Execution Waves

**Wave 1 (parallel):**
- delete-workflow-core, delete-structured-skills, delete-structured-ui

**Wave 2 (depends on Wave 1):**
- trim-workflow-types, trim-mcp-setup, trim-backend-routes, simplify-create-session-dialog, trim-ui-layer

**Wave 3 (depends on Wave 2):**
- trim-collab-state

**Wave 4 (depends on Wave 3):**
- build-verify

### Summary
- Total tasks: 10
- Total waves: 4
- Max parallelism: 5 (Wave 2)
