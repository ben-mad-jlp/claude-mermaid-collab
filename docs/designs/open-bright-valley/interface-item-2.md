# Interface Definition - Item 2: Task Flow Diagram in MCP

## File Structure

### New Files
- `src/mcp/workflow/task-diagram.ts` - Diagram generation from state
- `src/mcp/workflow/task-sync.ts` - Sync tasks from task-graph.md to state
- `skills/build-task-graph/SKILL.md` - New skill for building task graph YAML

### Modified Files
- `src/mcp/workflow/complete-skill.ts` - Trigger diagram updates during execution
- `src/mcp/tools/collab-state.ts` - Add batches to state schema (from Item 1)
- `skills/rough-draft-skeleton/SKILL.md` - Remove task graph building (moved to new skill)

---

## Type Definitions

```typescript
// src/mcp/workflow/task-diagram.ts (extends types.ts from Item 1)

/** Task from task-graph.md YAML */
export interface TaskGraphTask {
  id: string;
  files: string[];
  tests?: string[];
  description: string;
  parallel?: boolean;
  'depends-on'?: string[];
}

/** Parsed task graph from YAML */
export interface TaskGraph {
  tasks: TaskGraphTask[];
}

/** Status colors for diagram */
export const STATUS_COLORS = {
  pending: 'fill:#e0e0e0,stroke:#9e9e9e',
  in_progress: 'fill:#fff9c4,stroke:#f9a825',
  completed: 'fill:#c8e6c9,stroke:#2e7d32',
  failed: 'fill:#ffcdd2,stroke:#c62828',
} as const;

export type TaskStatus = keyof typeof STATUS_COLORS;
```

---

## Function Signatures

```typescript
// src/mcp/workflow/task-diagram.ts

/**
 * Generate Mermaid diagram from current state
 * Shows batches as subgraphs with tasks colored by status
 */
export function generateTaskDiagram(state: ExtendedCollabState): string;

/**
 * Update diagram file in session
 * Called automatically when state changes during execution
 */
export async function updateTaskDiagram(
  project: string,
  session: string,
  state: ExtendedCollabState
): Promise<void>;

/**
 * Build diagram content with batch subgraphs
 */
export function buildDiagramContent(batches: TaskBatch[]): string;
```

```typescript
// src/mcp/workflow/task-sync.ts

/**
 * Parse task-graph.md document and extract YAML
 */
export function parseTaskGraph(documentContent: string): TaskGraph;

/**
 * Build execution batches from task graph using topological sort
 * Groups tasks into waves based on dependencies
 */
export function buildBatches(tasks: TaskGraphTask[]): TaskBatch[];

/**
 * Sync tasks from task-graph.md to collab-state.json
 * Called when entering execution phase
 */
export async function syncTasksFromTaskGraph(
  project: string,
  session: string
): Promise<void>;

/**
 * Topological sort of tasks by dependencies
 */
export function topologicalSort(tasks: TaskGraphTask[]): TaskGraphTask[][];

/**
 * Detect circular dependencies in task graph
 */
export function detectCycles(tasks: TaskGraphTask[]): string[] | null;
```

---

## Component Interactions

```
┌─────────────────────┐
│  task-graph.md      │  Source of truth for task definitions
│  (YAML in doc)      │
└──────────┬──────────┘
           │
           ▼ parseTaskGraph()
┌─────────────────────┐
│  task-sync.ts       │  Syncs to state on execution entry
│  buildBatches()     │
└──────────┬──────────┘
           │
           ▼ syncTasksFromTaskGraph()
┌─────────────────────┐
│  collab-state.json  │  Runtime status tracking
│  { batches: [...] } │
└──────────┬──────────┘
           │
           ▼ generateTaskDiagram()
┌─────────────────────┐
│  task-diagram.ts    │  Generates Mermaid from state
│                     │
└──────────┬──────────┘
           │
           ▼ updateTaskDiagram()
┌─────────────────────┐
│  diagrams/          │  Auto-updated on state change
│  task-execution.mmd │
└─────────────────────┘
```

**Trigger flow:**
1. `complete_skill("build-task-graph")` → transition to `rough-draft-handoff`
2. `complete_skill("rough-draft-handoff")` → transition to `ready-to-implement`
3. `complete_skill("ready-to-implement")` → calls `syncTasksFromTaskGraph()`, generates initial diagram
4. Each `complete_skill()` during execution → updates task status, regenerates diagram

---

## Skill Interface

### build-task-graph Skill

**Location:** `skills/build-task-graph/SKILL.md`

**Invoked after:** `rough-draft-skeleton`
**Invoked before:** `rough-draft-handoff`

**Inputs:**
- Design document with pseudocode sections
- Skeleton stubs (documented, not created)

**Outputs:**
- `task-graph.md` document in session with:
  - YAML task definitions
  - Execution waves
  - File conflict analysis
  - Summary table

**YAML format produced:**
```yaml
tasks:
  - id: <unique-task-id>
    files: [<file-paths>]
    tests: [<test-file-paths>]
    description: <what this task implements>
    parallel: true  # optional
    depends-on: [<task-ids>]  # optional
```

---

## Integration with complete_skill

```typescript
// In complete-skill.ts

async function completeSkill(project, session, skill) {
  // ... existing logic ...
  
  // Special handling for execution phase entry
  if (nextState.id === 'clear-pre-execute') {
    // Sync tasks from task-graph.md to state
    await syncTasksFromTaskGraph(project, session);
  }
  
  // Auto-update diagram during execution phase
  const state = await getSessionState(project, session);
  if (state.phase === 'implementation' && state.batches) {
    await updateTaskDiagram(project, session, state);
  }
  
  return { next_skill: nextState.skill, ... };
}
```
