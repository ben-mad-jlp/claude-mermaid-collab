# Skeleton: Item 2 - Task Flow Diagram in MCP

## Planned Files

- [ ] `src/mcp/workflow/task-diagram.ts` - Diagram generation from state
- [ ] `src/mcp/workflow/task-sync.ts` - Sync tasks from task-graph.md to state
- [ ] `skills/build-task-graph/SKILL.md` - New skill for building task graph
- [ ] `src/mcp/workflow/complete-skill.ts` - Modified to trigger diagram updates

**Note:** These files are documented but NOT created yet. They will be created during the implementation phase by executing-plans.

---

## File Contents

### src/mcp/workflow/task-diagram.ts

```typescript
/**
 * Task diagram generation from workflow state.
 * Generates Mermaid diagrams with batches as subgraphs.
 */

import type { TaskBatch, BatchTask } from './types.js';

/** Status colors for diagram nodes */
export const STATUS_COLORS = {
  pending: 'fill:#e0e0e0,stroke:#9e9e9e',
  in_progress: 'fill:#fff9c4,stroke:#f9a825',
  completed: 'fill:#c8e6c9,stroke:#2e7d32',
  failed: 'fill:#ffcdd2,stroke:#c62828',
} as const;

export type TaskStatus = keyof typeof STATUS_COLORS;

/**
 * Generate Mermaid diagram from current state
 */
export function generateTaskDiagram(state: { batches?: TaskBatch[] }): string {
  // TODO: Implement diagram generation
  // - Create subgraph for each batch
  // - Add nodes for each task with status color
  // - Add dependency arrows
  throw new Error('Not implemented');
}

/**
 * Update diagram file in session
 */
export async function updateTaskDiagram(
  project: string,
  session: string,
  state: { batches?: TaskBatch[] }
): Promise<void> {
  // TODO: Implement diagram update
  // - Generate diagram content
  // - Update or create diagram via API
  throw new Error('Not implemented');
}

/**
 * Build diagram content with batch subgraphs
 */
export function buildDiagramContent(batches: TaskBatch[]): string {
  // TODO: Implement content building
  throw new Error('Not implemented');
}
```

---

### src/mcp/workflow/task-sync.ts

```typescript
/**
 * Task synchronization from task-graph.md to collab state.
 */

import type { TaskBatch, BatchTask } from './types.js';

/** Task from task-graph.md YAML */
export interface TaskGraphTask {
  id: string;
  files: string[];
  tests?: string[];
  description: string;
  parallel?: boolean;
  'depends-on'?: string[];
}

/** Parsed task graph */
export interface TaskGraph {
  tasks: TaskGraphTask[];
}

/**
 * Parse task-graph.md document and extract YAML
 */
export function parseTaskGraph(documentContent: string): TaskGraph {
  // TODO: Implement YAML parsing
  // - Find ```yaml block
  // - Parse YAML content
  // - Validate structure
  throw new Error('Not implemented');
}

/**
 * Build execution batches from task graph using topological sort
 */
export function buildBatches(tasks: TaskGraphTask[]): TaskBatch[] {
  // TODO: Implement batch building
  // - Detect cycles
  // - Topological sort into waves
  // - Convert to TaskBatch array
  throw new Error('Not implemented');
}

/**
 * Sync tasks from task-graph.md to collab-state.json
 */
export async function syncTasksFromTaskGraph(
  project: string,
  session: string
): Promise<void> {
  // TODO: Implement sync
  // - Read task-graph document
  // - Parse and build batches
  // - Update session state
  // - Generate initial diagram
  throw new Error('Not implemented');
}

/**
 * Topological sort of tasks by dependencies
 */
export function topologicalSort(tasks: TaskGraphTask[]): TaskGraphTask[][] {
  // TODO: Implement topological sort
  throw new Error('Not implemented');
}

/**
 * Detect circular dependencies
 */
export function detectCycles(tasks: TaskGraphTask[]): string[] | null {
  // TODO: Implement cycle detection using DFS
  throw new Error('Not implemented');
}
```

---

### skills/build-task-graph/SKILL.md

```markdown
---
name: build-task-graph
description: Build task dependency graph YAML from interface and pseudocode
user-invocable: false
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
---

# Build Task Graph

Create the task dependency graph from interface and pseudocode documents.

## When Invoked

After rough-draft-skeleton completes, before rough-draft-handoff.

## Process

### Step 1: Read Interface and Pseudocode Documents

Read all interface-item-N.md and pseudocode-item-N.md documents:

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__list_documents
Args: { "project": "<cwd>", "session": "<session>" }
\`\`\`

Filter for interface-* and pseudocode-* documents and read each.

### Step 2: Extract File Changes

For each item's interface document:
1. Find "File Structure" section
2. Extract all file paths (new and modified)
3. Note which files depend on others (imports, references)

### Step 3: Build Task List

For each file:
1. Create task ID from file path (e.g., src/auth/service.ts → auth-service)
2. Set files array
3. Generate test file paths:
   - {dir}/{name}.test{ext}
   - {dir}/__tests__/{name}.test{ext}
4. Extract description from interface doc
5. Analyze dependencies:
   - If file imports from another file, add dependency
   - If pseudocode mentions "after X", add dependency

### Step 4: Identify Parallel Tasks

Mark tasks as parallel: true if:
- No dependencies
- Or all dependencies are from previous waves

### Step 5: Calculate Execution Waves

Group tasks by wave:
- Wave 1: Tasks with no dependencies
- Wave N: Tasks depending only on waves 1 to N-1

### Step 6: Check File Conflicts

Identify tasks that modify the same file:
- Warn about conflicts
- Suggest ordering to avoid merge issues

### Step 7: Create task-graph.md

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "name": "task-graph",
  "content": "<task graph content>"
}
\`\`\`

## Output Format

\`\`\`markdown
# Task Dependency Graph

## YAML Task Graph

\`\`\`yaml
tasks:
  - id: task-id
    files: [path/to/file.ts]
    tests: [path/to/file.test.ts]
    description: What this task implements
    parallel: true
    depends-on: [other-task-id]
\`\`\`

## Execution Waves

**Wave 1 (no dependencies):**
- task-1
- task-2

**Wave 2 (depends on Wave 1):**
- task-3

## File Conflict Analysis

[Note any files modified by multiple tasks]

## Summary

- Total tasks: N
- Total waves: M
- Max parallelism: P
\`\`\`

## On Completion

Call complete_skill to transition to rough-draft-handoff:

\`\`\`
Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
Args: { "project": "<cwd>", "session": "<session>", "skill": "build-task-graph" }
\`\`\`
```

---

### Modifications to src/mcp/workflow/complete-skill.ts

```typescript
// Add import at top:
import { syncTasksFromTaskGraph } from './task-sync.js';
import { updateTaskDiagram } from './task-diagram.js';

// In completeSkill function, add after getting next state:

// Special handling for execution phase entry
if (nextState.id === 'clear-pre-execute' || nextState.id === 'ready-to-implement') {
  await syncTasksFromTaskGraph(project, session);
}

// Auto-update diagram during execution phase
const updatedState = await getSessionState(project, session);
if (updatedState.phase === 'implementation' && updatedState.batches) {
  await updateTaskDiagram(project, session, updatedState);
}
```

---

## Task Dependency Graph

```yaml
tasks:
  - id: task-diagram
    files: [src/mcp/workflow/task-diagram.ts]
    tests: [src/mcp/workflow/task-diagram.test.ts, src/mcp/workflow/__tests__/task-diagram.test.ts]
    description: Diagram generation from workflow state
    depends-on: [workflow-types]
    parallel: false

  - id: task-sync
    files: [src/mcp/workflow/task-sync.ts]
    tests: [src/mcp/workflow/task-sync.test.ts, src/mcp/workflow/__tests__/task-sync.test.ts]
    description: Sync tasks from task-graph.md to state
    depends-on: [workflow-types]
    parallel: false

  - id: build-task-graph-skill
    files: [skills/build-task-graph/SKILL.md]
    description: New skill for building task graph YAML
    parallel: true

  - id: complete-skill-diagram
    files: [src/mcp/workflow/complete-skill.ts]
    tests: [src/mcp/workflow/complete-skill.test.ts]
    description: Add diagram update triggers to complete_skill
    depends-on: [task-diagram, task-sync, complete-skill]
```

**Note:** This depends on Item 1's `workflow-types` and `complete-skill` tasks.

---

## Execution Order

**Combined with Item 1:**

**Wave 1:**
- workflow-types (Item 1)
- build-task-graph-skill (Item 2) - no code dependencies

**Wave 2:**
- state-machine (Item 1)
- collab-state-extend (Item 1)
- task-diagram (Item 2)
- task-sync (Item 2)

**Wave 3:**
- transitions (Item 1)

**Wave 4:**
- complete-skill (Item 1)

**Wave 5:**
- complete-skill-diagram (Item 2) - modifies complete-skill
- setup-register (Item 1)

---

## Verification

- [ ] All files from Interface are documented
- [ ] File paths match exactly
- [ ] All types are defined
- [ ] All function signatures present
- [ ] TODO comments match pseudocode
- [ ] Dependency graph covers all files
- [ ] No circular dependencies
- [ ] Item 2 correctly depends on Item 1's types
