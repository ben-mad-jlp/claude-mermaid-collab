# Pseudocode: Item 7

## Replace phase with user-friendly state display names

### src/mcp/workflow/state-machine.ts

#### STATE_DISPLAY_NAMES constant

```
CONST STATE_DISPLAY_NAMES = {
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
  'log-batch-complete': 'Logging'
}
```

#### getDisplayName(state, previousState?)

```
FUNCTION getDisplayName(state, previousState = null):
  // Check for direct mapping
  IF state IN STATE_DISPLAY_NAMES:
    RETURN STATE_DISPLAY_NAMES[state]
  
  // Handle clear-* states
  IF state.startsWith('clear-'):
    RETURN 'Context Check'
  
  // Unknown state - return as-is (shouldn't happen)
  RETURN state
```

### src/services/session-manager.ts

#### getSessionState(project, session)

```
FUNCTION getSessionState(project, session):
  // Load raw state from storage
  rawState = await this.loadState(project, session)
  
  // Compute display name
  displayName = getDisplayName(rawState.state, rawState.previousState)
  
  // Derive phase from state (for backwards compatibility)
  // Extract base phase: 'brainstorm-exploring' -> 'brainstorming'
  phase = this.derivePhase(rawState.state)
  
  RETURN {
    ...rawState,
    phase,           // Derived, not stored
    displayName      // New field
  }

FUNCTION derivePhase(state):
  IF state.startsWith('brainstorm'):
    RETURN 'brainstorming'
  ELSE IF state.startsWith('rough-draft'):
    RETURN 'rough-draft'
  ELSE IF state.startsWith('clear'):
    RETURN 'transition'
  ELSE IF state === 'ready-to-implement':
    RETURN 'ready'
  ELSE IF state === 'implementing':
    RETURN 'implementing'
  ELSE:
    RETURN state
```

### UI Components (example update)

```
// Before
<StatusBadge>{session.phase}</StatusBadge>

// After  
<StatusBadge>{session.displayName}</StatusBadge>
```

### Verification

- [x] All functions from interface covered
- [x] STATE_DISPLAY_NAMES covers all known states
- [x] clear-* states handled gracefully
- [x] Backwards compatible (phase still available, derived)
- [x] UI shows friendly names
