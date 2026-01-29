# Session: fair-open-fjord

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Real-time task graph via MCP
**Type:** code
**Status:** brainstormed

**Problem/Goal:**
Task graph in the UI only updates at batch times, not in real-time when tasks are running or completing. Need a way for the graph to reflect current task execution state with appropriate colors.

**Approach:**
- Create an MCP function that returns the task execution graph state
- Add button at **top of work items list during implementation phase**
- MCP handles graph generation directly instead of requiring AI to generate it
- Graph should show running/completed/pending states with colors

**UI Location:** Button at top of work items list when phase=implementation
**Display:** Inline as a work item card (same treatment as regular work items)
**Update Trigger:** WebSocket push when task status changes + manual refresh via button click
**Push Mechanism:** MCP regenerates diagram content and pushes via WebSocket (not just state change)
**Tool Scope:** Unified - new MCP tool handles both status updates AND diagram display (replaces scattered update_session_state calls for task status)
**WebSocket Payload:** Push includes BOTH diagram content AND task statuses (completedTasks, pendingTasks, batches) so progress bar and diagram update together

**Success Criteria:**
- MCP tool returns current task graph with status information
- Button in UI requests and displays the task graph
- Graph updates show real-time task status (running, completed, pending)
- Colors in the diagram reflect task status

**Decisions:**
- Approach: Unified MCP Tool (Approach 1)

---

## Design

### Section 1: MCP Tool Interface

**New tool: `update_task_status`**

```typescript
// Parameters
{
  project: string;      // Absolute path to project
  session: string;      // Session name
  taskId: string;       // Task ID to update
  status: "pending" | "in_progress" | "completed" | "failed";
}

// Returns
{
  success: boolean;
  diagram: string;      // Regenerated Mermaid content
  batches: TaskBatch[]; // Updated batch state
  completedTasks: string[];
  pendingTasks: string[];
}
```

**New tool: `get_task_graph`**

```typescript
// Parameters
{
  project: string;
  session: string;
}

// Returns (same as update_task_status)
{
  diagram: string;
  batches: TaskBatch[];
  completedTasks: string[];
  pendingTasks: string[];
}
```

Both tools regenerate the diagram from current state and return it. The `update_task_status` tool also modifies state before returning.

### Section 2: WebSocket Broadcast

When `update_task_status` is called, it broadcasts a new message type:

```typescript
// WebSocket message
{
  type: "task_graph_updated";
  project: string;
  session: string;
  payload: {
    diagram: string;           // Mermaid syntax
    batches: TaskBatch[];
    completedTasks: string[];
    pendingTasks: string[];
    updatedTaskId: string;     // Which task changed
    updatedStatus: string;     // New status
  }
}
```

**UI handling:**
1. `websocket.ts` dispatches CustomEvent `task_graph_updated`
2. UI components listen for this event
3. Progress bar updates from `completedTasks.length / totalTasks`
4. Task graph component re-renders with new `diagram` content

**File changes:**
- `src/lib/websocket.ts` - Add `task_graph_updated` to BROADCAST_MESSAGE_TYPES
- `src/websocket/handler.ts` - No changes (uses existing broadcast mechanism)

### Section 3: UI Component

**New component: `TaskGraphCard`**

Location: `ui/src/components/dashboard/TaskGraphCard.tsx`

```tsx
interface TaskGraphCardProps {
  project: string;
  session: string;
}

function TaskGraphCard({ project, session }: TaskGraphCardProps) {
  const { diagram, isLoading } = useTaskGraph(project, session);
  
  if (!diagram) return null;
  
  return (
    <Card title="Task Execution Graph">
      <DiagramEmbed content={diagram} />
    </Card>
  );
}
```

**New hook: `useTaskGraph`**

Location: `ui/src/hooks/useTaskGraph.ts`

- Listens for `task_graph_updated` CustomEvent
- Fetches initial state via API on mount
- Returns `{ diagram, batches, completedTasks, pendingTasks, isLoading }`

**Button placement:**

In the work items list (when `phase === "implementation"`), add a button at top:
- Click toggles `TaskGraphCard` visibility
- Icon: chart/graph icon
- Label: "View Task Graph"

[View component layout diagram](http://localhost:3737/diagram.html?project=%2FUsers%2Fbenmaderazo%2FCode%2Fclaude-mermaid-collab&session=fair-open-fjord&id=ui-component-layout)

### Section 4: Skill Integration

**Update `executing-plans` skill to use new tool:**

Current behavior (in `executing-plans-execution.md`):
```
// After task completes
Tool: update_session_state
Args: { completedTasks: [..., taskId], pendingTasks: [...without taskId] }
```

New behavior:
```
// When task starts
Tool: update_task_status
Args: { project, session, taskId, status: "in_progress" }

// When task completes
Tool: update_task_status
Args: { project, session, taskId, status: "completed" }

// When task fails
Tool: update_task_status
Args: { project, session, taskId, status: "failed" }
```

**Benefits:**
- Each status change triggers diagram regeneration
- WebSocket broadcast keeps UI in sync
- No more batch-only updates

**Backward compatibility:**
- Keep `update_session_state` working for non-task state changes
- Task status fields (`completedTasks`, `pendingTasks`) remain in state for read access

### Section 5: File Changes Summary

**Backend (src/):**
| File | Change |
|------|--------|
| `src/mcp/setup.ts` | Register `update_task_status` and `get_task_graph` tools |
| `src/mcp/workflow/task-status.ts` | **NEW** - Implement both tools |
| `src/mcp/workflow/task-diagram.ts` | Export `generateTaskDiagram` (already exists) |
| `ui/src/lib/websocket.ts` | Add `task_graph_updated` to BROADCAST_MESSAGE_TYPES |

**Frontend (ui/):**
| File | Change |
|------|--------|
| `ui/src/hooks/useTaskGraph.ts` | **NEW** - Hook for task graph state |
| `ui/src/components/dashboard/TaskGraphCard.tsx` | **NEW** - Card with DiagramEmbed |
| `ui/src/components/dashboard/WorkItemsList.tsx` | Add "View Task Graph" button |

**Skills:**
| File | Change |
|------|--------|
| `skills/executing-plans-execution.md` | Use `update_task_status` instead of `update_session_state` for task status |

**Tests:**
- `src/mcp/workflow/__tests__/task-status.test.ts` - Unit tests for new tools
- `ui/src/hooks/__tests__/useTaskGraph.test.ts` - Hook tests

---

## Diagrams
(auto-synced)