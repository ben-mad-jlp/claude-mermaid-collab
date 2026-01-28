# Skeleton: Item 7

## Replace phase with user-friendly state display names

### Task Graph

```yaml
tasks:
  - id: item7-display-names-const
    file: src/mcp/workflow/state-machine.ts
    action: modify
    description: Add STATE_DISPLAY_NAMES constant mapping
    depends: []
    
  - id: item7-get-display-name
    file: src/mcp/workflow/state-machine.ts
    action: modify
    description: Add getDisplayName function with clear-* handling
    depends: [item7-display-names-const]
    
  - id: item7-session-manager
    file: src/services/session-manager.ts
    action: modify
    description: Add displayName to getSessionState return, derive phase
    depends: [item7-get-display-name]
    
  - id: item7-ui-update
    file: ui/src/components/
    action: modify
    description: Update UI components to use displayName instead of phase/state
    depends: [item7-session-manager]
```

### Stub Code

#### src/mcp/workflow/state-machine.ts

```typescript
// ADD: Display name mapping
export const STATE_DISPLAY_NAMES: Record<string, string> = {
  // Entry
  'collab-start': 'Starting',
  'gather-goals': 'Gathering Goals',
  
  // Brainstorming
  'brainstorm-exploring': 'Exploring',
  'brainstorm-clarifying': 'Clarifying',
  'brainstorm-designing': 'Designing',
  'brainstorm-validating': 'Validating',
  
  // Item-specific paths
  'systematic-debugging': 'Investigating',
  'task-planning': 'Planning Task',
  
  // Rough-draft
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
  
  // Routing nodes
  'work-item-router': 'Routing',
  'item-type-router': 'Routing',
  'batch-router': 'Routing',
  'log-batch-complete': 'Logging',
  // Note: clear-* states return 'Context Check' via getDisplayName logic
};

// ADD: Helper function
export function getDisplayName(state: string, previousState?: string): string {
  // TODO: Check STATE_DISPLAY_NAMES for direct match
  // TODO: If state.startsWith('clear-'), return 'Context Check'
  // TODO: Return state as-is for unknown states (fallback)
  throw new Error('Not implemented');
}
```

#### src/services/session-manager.ts

```typescript
import { getDisplayName } from '../mcp/workflow/state-machine';

// MODIFY: getSessionState to include displayName
async getSessionState(project: string, session: string): Promise<SessionStateWithDisplay> {
  const rawState = await this.loadState(project, session);
  
  // TODO: Call getDisplayName(rawState.state, rawState.previousState)
  // TODO: Derive phase from state for backwards compatibility
  // TODO: Return merged object with displayName
  
  throw new Error('Not implemented');
}
```

#### ui/src/components/ (various files)

```typescript
// Find usages of session.phase or session.state for display
// Replace with session.displayName

// Example patterns to search for:
// - {session.phase}
// - {state.phase}
// - phase={...}
```

### Verification Checklist

- [x] All files from interface listed with tasks
- [x] Task dependencies form valid DAG
- [x] 4 tasks - appropriate granularity
- [x] UI update depends on backend changes
