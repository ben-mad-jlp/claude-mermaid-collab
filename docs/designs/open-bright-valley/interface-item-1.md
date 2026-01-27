# Interface Definition - Item 1: MCP State Machine

## File Structure

### New Files
- `src/mcp/workflow/state-machine.ts` - State definitions and graph
- `src/mcp/workflow/transitions.ts` - Transition logic and conditions
- `src/mcp/workflow/complete-skill.ts` - MCP tool implementation
- `src/mcp/workflow/types.ts` - Type definitions for workflow

### Modified Files
- `src/mcp/setup.ts` - Register new `complete_skill` tool
- `src/mcp/tools/collab-state.ts` - Extend CollabState interface with new fields

---

## Type Definitions

```typescript
// src/mcp/workflow/types.ts

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
  skill: string | null;  // null for internal routing nodes
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

/** Extended collab state with new fields */
export interface ExtendedCollabState {
  state: StateId;           // Current state machine state
  phase: string;            // Backwards compat
  lastActivity: string;
  currentItem: number | null;
  hasSnapshot: boolean;
  batches?: TaskBatch[];
  currentBatch?: number;
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
}
```

---

## Function Signatures

```typescript
// src/mcp/workflow/state-machine.ts

/**
 * Get all workflow states
 */
export function getWorkflowStates(): WorkflowState[];

/**
 * Get a specific state by ID
 */
export function getState(id: StateId): WorkflowState | undefined;

/**
 * Get the skill name for a state (null for routing nodes)
 */
export function getSkillForState(id: StateId): string | null;
```

```typescript
// src/mcp/workflow/transitions.ts

/**
 * Evaluate a transition condition against current context
 */
export function evaluateCondition(
  condition: TransitionCondition,
  context: TransitionContext
): boolean;

/**
 * Get the next state given current state and context
 */
export function getNextState(
  currentStateId: StateId,
  context: TransitionContext
): StateId | null;

/**
 * Context needed for transition evaluation
 */
export interface TransitionContext {
  currentItemType?: 'code' | 'task' | 'bugfix';
  itemsRemaining: boolean;
  batchesRemaining: boolean;
}

/**
 * Build transition context from session state
 */
export function buildTransitionContext(
  state: ExtendedCollabState,
  designDoc?: string
): TransitionContext;
```

```typescript
// src/mcp/workflow/complete-skill.ts

/**
 * Handle complete_skill MCP tool call
 * 
 * 1. Looks up current state
 * 2. Determines next state from transitions
 * 3. Updates collab-state.json
 * 4. Returns next skill to invoke
 */
export async function completeSkill(
  project: string,
  session: string,
  completedSkill: string
): Promise<CompleteSkillOutput>;

/**
 * Map skill name to state ID
 */
export function skillToState(skill: string): StateId | null;

/**
 * Map state ID to skill name  
 */
export function stateToSkill(stateId: StateId): string | null;
```

---

## Component Interactions

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude/Skill   │────▶│  complete_skill  │────▶│  state-machine  │
│                 │     │  (MCP tool)      │     │  (definitions)  │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │   transitions    │◀──── evaluates conditions
                        │   (routing)      │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  collab-state    │◀──── updates state
                        │  (persistence)   │
                        └──────────────────┘
```

- `complete_skill` is the entry point, called by skills when they finish
- `state-machine.ts` provides the graph of states and transitions
- `transitions.ts` evaluates conditions and determines next state
- `collab-state.ts` persists state changes (extended with new fields)
- WebSocket broadcasts state changes to UI

---

## MCP Tool Schema

```typescript
// Added to setup.ts ListToolsRequestSchema handler
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
}
```
