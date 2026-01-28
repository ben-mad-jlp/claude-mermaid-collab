# Interface Definition: Item 7

## Replace phase with user-friendly state display names

### File Structure

- `src/mcp/workflow/state-machine.ts` - **MODIFY** - Add STATE_DISPLAY_NAMES mapping and getDisplayName function
- `src/services/session-manager.ts` - **MODIFY** - Derive phase from state (deprecate direct phase field)
- `ui/src/components/` - **MODIFY** - Update components to use displayName

### Type Definitions

```typescript
// src/mcp/workflow/state-machine.ts

/**
 * Mapping of internal state names to user-friendly display names
 */
const STATE_DISPLAY_NAMES: Record<string, string> = {
  // Entry
  'collab-start': 'Starting',
  'gather-goals': 'Gathering Goals',
  
  // Brainstorming phases
  'brainstorm-exploring': 'Exploring',
  'brainstorm-clarifying': 'Clarifying',
  'brainstorm-designing': 'Designing',
  'brainstorm-validating': 'Validating',
  
  // Item-specific paths
  'systematic-debugging': 'Investigating',
  'task-planning': 'Planning Task',
  
  // Rough-draft phases
  'rough-draft-interface': 'Defining Interfaces',
  'rough-draft-pseudocode': 'Writing Pseudocode',
  'rough-draft-skeleton': 'Building Skeleton',
  'build-task-graph': 'Building Tasks',
  'rough-draft-handoff': 'Preparing Handoff',
  
  // Execution
  'ready-to-implement': 'Ready',
  'execute-batch': 'Executing',
  
  // Terminal
  'workflow-complete': 'Finishing',
  'cleanup': 'Cleaning Up',
  'done': 'Done',
  
  // Routing nodes (instant, may not need display - but included for completeness)
  'work-item-router': 'Routing',
  'item-type-router': 'Routing',
  'batch-router': 'Routing',
  'log-batch-complete': 'Logging',
  
  // clear-* states → "Context Check" (handled by getDisplayName)
};

/**
 * Session state with display name included
 */
interface SessionStateWithDisplay extends SessionState {
  displayName: string;
}
```

### Function Signatures

```typescript
// src/mcp/workflow/state-machine.ts

/**
 * Get user-friendly display name for a state.
 * For clear-* states, returns "Ready to continue" or derives from previous state.
 * @param state - Internal state name
 * @param previousState - Optional previous state for clear-* transitions
 */
export function getDisplayName(state: string, previousState?: string): string;
```

```typescript
// src/services/session-manager.ts

/**
 * Get session state with computed display name.
 * Phase is now derived from state rather than stored separately.
 */
getSessionState(project: string, session: string): Promise<SessionStateWithDisplay>;
```

### Component Interactions

1. State machine transitions to new state (e.g., `brainstorm-designing`)
2. `session-manager.getSessionState()` called
3. Calls `getDisplayName(state)` to compute display name
4. Returns `{ state, displayName, ... }` 
5. UI renders `displayName` instead of raw `state` or `phase`

### Display Name Mapping

| Internal State | Display Name |
|---------------|--------------|
| collab-start | Starting |
| gather-goals | Gathering Goals |
| brainstorm-exploring | Exploring |
| brainstorm-clarifying | Clarifying |
| brainstorm-designing | Designing |
| brainstorm-validating | Validating |
| systematic-debugging | Investigating |
| task-planning | Planning Task |
| rough-draft-interface | Defining Interfaces |
| rough-draft-pseudocode | Writing Pseudocode |
| rough-draft-skeleton | Building Skeleton |
| build-task-graph | Building Tasks |
| rough-draft-handoff | Preparing Handoff |
| ready-to-implement | Ready |
| execute-batch | Executing |
| workflow-complete | Finishing |
| cleanup | Cleaning Up |
| done | Done |
| work-item-router | Routing |
| item-type-router | Routing |
| batch-router | Routing |
| log-batch-complete | Logging |
| clear-* | Context Check |

### Verification Checklist

- [x] All files from design are listed
- [x] All public interfaces have signatures
- [x] Parameter types are explicit
- [x] Return types are explicit
- [x] Display name mapping documented
