# Skeleton: Item 1 - MCP State Machine

## Planned Files

- [ ] `src/mcp/workflow/types.ts` - Type definitions for workflow
- [ ] `src/mcp/workflow/state-machine.ts` - State definitions and graph
- [ ] `src/mcp/workflow/transitions.ts` - Transition logic and conditions
- [ ] `src/mcp/workflow/complete-skill.ts` - MCP tool implementation
- [ ] `src/mcp/setup.ts` - Modified to register complete_skill tool
- [ ] `src/mcp/tools/collab-state.ts` - Extended with new state fields

**Note:** These files are documented but NOT created yet. They will be created during the implementation phase by executing-plans.

---

## File Contents

### src/mcp/workflow/types.ts

```typescript
/**
 * Type definitions for the MCP workflow state machine.
 */

/** Unique identifier for each workflow state */
export type StateId =
  | 'collab-start'
  | 'gather-goals'
  | 'clear-pre-item'
  | 'work-item-router'
  // Brainstorming states
  | 'brainstorm-exploring'
  | 'clear-bs1'
  | 'brainstorm-clarifying'
  | 'clear-bs2'
  | 'brainstorm-designing'
  | 'clear-bs3'
  | 'brainstorm-validating'
  | 'item-type-router'
  // Rough-draft states
  | 'clear-pre-rough'
  | 'rough-draft-interface'
  | 'clear-rd1'
  | 'rough-draft-pseudocode'
  | 'clear-rd2'
  | 'rough-draft-skeleton'
  | 'clear-rd3'
  | 'build-task-graph'
  | 'clear-rd4'
  | 'rough-draft-handoff'
  // Other paths
  | 'task-planning'
  | 'systematic-debugging'
  | 'ready-to-implement'
  // Execution states
  | 'clear-pre-execute'
  | 'batch-router'
  | 'execute-batch'
  | 'log-batch-complete'
  | 'clear-post-batch'
  | 'clear-post-item'
  // Terminal states
  | 'workflow-complete'
  | 'cleanup'
  | 'done';

/** Condition types for transition guards */
export type TransitionCondition =
  | { type: 'item_type'; value: 'code' | 'task' | 'bugfix' }
  | { type: 'items_remaining' }
  | { type: 'no_items_remaining' }
  | { type: 'batches_remaining' }
  | { type: 'no_batches_remaining' }
  | { type: 'always' };

/** A transition from one state to another */
export interface Transition {
  to: StateId;
  condition?: TransitionCondition;
}

/** A state in the workflow */
export interface WorkflowState {
  id: StateId;
  skill: string | null;
  transitions: Transition[];
}

/** Input for complete_skill MCP tool */
export interface CompleteSkillInput {
  project: string;
  session: string;
  skill: string;
}

/** Output from complete_skill MCP tool */
export interface CompleteSkillOutput {
  next_skill: string | null;
  params?: {
    item_number?: number;
    batch_index?: number;
  };
  action?: 'clear' | 'none';
}

/** Batch definition for execution phase */
export interface TaskBatch {
  id: string;
  tasks: BatchTask[];
  status: 'pending' | 'in_progress' | 'completed';
}

/** Task within a batch */
export interface BatchTask {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependsOn: string[];
}
```

---

### src/mcp/workflow/state-machine.ts

```typescript
/**
 * Workflow state machine definitions.
 * Contains all states and their transitions.
 */

import type { StateId, WorkflowState } from './types.js';

/** All workflow states */
export const WORKFLOW_STATES: WorkflowState[] = [
  // Entry
  {
    id: 'collab-start',
    skill: 'collab-start',
    transitions: [{ to: 'gather-goals' }],
  },
  {
    id: 'gather-goals',
    skill: 'gather-session-goals',
    transitions: [{ to: 'clear-pre-item' }],
  },
  
  // Pre-item clear
  {
    id: 'clear-pre-item',
    skill: 'collab-clear',
    transitions: [{ to: 'work-item-router' }],
  },
  
  // Work item router (no skill - routing node)
  {
    id: 'work-item-router',
    skill: null,
    transitions: [
      { to: 'brainstorm-exploring', condition: { type: 'item_type', value: 'code' } },
      { to: 'brainstorm-exploring', condition: { type: 'item_type', value: 'task' } },
      { to: 'systematic-debugging', condition: { type: 'item_type', value: 'bugfix' } },
      { to: 'ready-to-implement', condition: { type: 'no_items_remaining' } },
    ],
  },
  
  // TODO: Add all remaining states from the state machine diagram
  // - Brainstorming states (exploring, clarifying, designing, validating)
  // - Rough-draft states (interface, pseudocode, skeleton, build-task-graph, handoff)
  // - Execution states (batch-router, execute-batch, etc.)
  // - Terminal states (workflow-complete, cleanup, done)
  
  // Placeholder for terminal
  {
    id: 'done',
    skill: null,
    transitions: [],
  },
];

/**
 * Get all workflow states
 */
export function getWorkflowStates(): WorkflowState[] {
  return WORKFLOW_STATES;
}

/**
 * Get a specific state by ID
 */
export function getState(id: StateId): WorkflowState | undefined {
  return WORKFLOW_STATES.find(s => s.id === id);
}

/**
 * Get the skill name for a state
 */
export function getSkillForState(id: StateId): string | null {
  const state = getState(id);
  return state?.skill ?? null;
}
```

---

### src/mcp/workflow/transitions.ts

```typescript
/**
 * Transition logic for the workflow state machine.
 */

import type { StateId, TransitionCondition, WorkflowState } from './types.js';
import { getState } from './state-machine.js';

/** Context for evaluating transitions */
export interface TransitionContext {
  currentItemType?: 'code' | 'task' | 'bugfix';
  itemsRemaining: boolean;
  batchesRemaining: boolean;
}

/**
 * Evaluate a transition condition against context
 */
export function evaluateCondition(
  condition: TransitionCondition,
  context: TransitionContext
): boolean {
  // TODO: Implement condition evaluation
  // - Handle item_type, items_remaining, batches_remaining, always
  throw new Error('Not implemented');
}

/**
 * Get the next state given current state and context
 */
export function getNextState(
  currentStateId: StateId,
  context: TransitionContext
): StateId | null {
  // TODO: Implement next state lookup
  // - Get current state
  // - Evaluate each transition's condition
  // - Return first matching transition target
  throw new Error('Not implemented');
}

/**
 * Build transition context from session state and design doc
 */
export function buildTransitionContext(
  state: { currentItem?: number | null; batches?: unknown[] },
  designDoc?: string
): TransitionContext {
  // TODO: Implement context building
  // - Parse design doc for item types
  // - Count remaining items
  // - Count remaining batches
  throw new Error('Not implemented');
}
```

---

### src/mcp/workflow/complete-skill.ts

```typescript
/**
 * Implementation of the complete_skill MCP tool.
 */

import type { CompleteSkillOutput, StateId } from './types.js';
import { getState, getSkillForState } from './state-machine.js';
import { getNextState, buildTransitionContext } from './transitions.js';
import { getSessionState, updateSessionState } from '../tools/collab-state.js';

/**
 * Handle complete_skill MCP tool call
 */
export async function completeSkill(
  project: string,
  session: string,
  completedSkill: string
): Promise<CompleteSkillOutput> {
  // TODO: Implement complete_skill logic
  // 1. Read current session state
  // 2. Map skill to state ID
  // 3. Build transition context
  // 4. Get next state
  // 5. Handle routing nodes (loop until real state)
  // 6. Special handling for execution phase entry
  // 7. Update session state
  // 8. Return next skill and action
  throw new Error('Not implemented');
}

/**
 * Map skill name to state ID
 */
export function skillToState(skill: string): StateId | null {
  // TODO: Implement skill to state mapping
  throw new Error('Not implemented');
}

/**
 * Map state ID to skill name
 */
export function stateToSkill(stateId: StateId): string | null {
  return getSkillForState(stateId);
}
```

---

### Modifications to src/mcp/setup.ts

```typescript
// Add to imports at top:
import { completeSkill } from './workflow/complete-skill.js';

// Add to ListToolsRequestSchema handler tools array:
{
  name: 'complete_skill',
  description: 'Report skill completion and get next skill to invoke. MCP handles all routing and state updates.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Absolute path to project root' },
      session: { type: 'string', description: 'Session name' },
      skill: { type: 'string', description: 'Name of the skill that just completed' },
    },
    required: ['project', 'session', 'skill'],
  },
},

// Add to CallToolRequestSchema handler switch statement:
case 'complete_skill': {
  const { project, session, skill } = args as { project: string; session: string; skill: string };
  if (!project || !session || !skill) throw new Error('Missing required: project, session, skill');
  const result = await completeSkill(project, session, skill);
  return JSON.stringify(result, null, 2);
}
```

---

### Modifications to src/mcp/tools/collab-state.ts

```typescript
// Extend CollabState interface:
export interface CollabState {
  state?: string;              // NEW: Current state machine state ID
  phase: string;
  lastActivity: string;
  currentItem: number | null;
  hasSnapshot: boolean;
  batches?: TaskBatch[];       // NEW: Execution batches
  currentBatch?: number;       // NEW: Index of current batch
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
}

// Import TaskBatch type:
import type { TaskBatch } from '../workflow/types.js';

// Update StateUpdateParams:
export interface StateUpdateParams {
  state?: string;              // NEW
  phase?: string;
  currentItem?: number | null;
  hasSnapshot?: boolean;
  batches?: TaskBatch[];       // NEW
  currentBatch?: number;       // NEW
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
}

// Update updateSessionState to handle new fields
```

---

## Task Dependency Graph

```yaml
tasks:
  - id: workflow-types
    files: [src/mcp/workflow/types.ts]
    tests: [src/mcp/workflow/types.test.ts, src/mcp/workflow/__tests__/types.test.ts]
    description: Type definitions for workflow state machine
    parallel: true

  - id: state-machine
    files: [src/mcp/workflow/state-machine.ts]
    tests: [src/mcp/workflow/state-machine.test.ts, src/mcp/workflow/__tests__/state-machine.test.ts]
    description: State definitions and graph structure
    depends-on: [workflow-types]

  - id: transitions
    files: [src/mcp/workflow/transitions.ts]
    tests: [src/mcp/workflow/transitions.test.ts, src/mcp/workflow/__tests__/transitions.test.ts]
    description: Transition logic and condition evaluation
    depends-on: [workflow-types, state-machine]

  - id: collab-state-extend
    files: [src/mcp/tools/collab-state.ts]
    tests: [src/mcp/tools/collab-state.test.ts, src/mcp/tools/__tests__/collab-state.test.ts]
    description: Extend CollabState with new fields
    depends-on: [workflow-types]

  - id: complete-skill
    files: [src/mcp/workflow/complete-skill.ts]
    tests: [src/mcp/workflow/complete-skill.test.ts, src/mcp/workflow/__tests__/complete-skill.test.ts]
    description: complete_skill MCP tool implementation
    depends-on: [state-machine, transitions, collab-state-extend]

  - id: setup-register
    files: [src/mcp/setup.ts]
    tests: [src/mcp/setup.test.ts]
    description: Register complete_skill tool in MCP server
    depends-on: [complete-skill]
```

---

## Execution Order

**Wave 1 (no dependencies, parallel):**
- workflow-types

**Wave 2 (depends on Wave 1):**
- state-machine
- collab-state-extend

**Wave 3 (depends on Wave 2):**
- transitions

**Wave 4 (depends on Wave 3):**
- complete-skill

**Wave 5 (depends on Wave 4):**
- setup-register

---

## Verification

- [ ] All files from Interface are documented
- [ ] File paths match exactly
- [ ] All types are defined (StateId, Transition, WorkflowState, etc.)
- [ ] All function signatures present
- [ ] TODO comments match pseudocode
- [ ] Dependency graph covers all files
- [ ] No circular dependencies
