## Implementation Details

### State Definition (`WorkflowState`)
```typescript
interface WorkflowState {
  id: StateId;           // Unique state identifier
  skill: string | null;  // Associated skill (null = routing node)
  transitions: Transition[];
}
```

### Transition Conditions
- `item_type`: Routes based on current work item type
- `items_remaining` / `no_items_remaining`: Checks if work items exist
- `batches_remaining` / `no_batches_remaining`: Checks execution batches
- `always`: Unconditional transition

### Key Functions
- `getState(id)`: Get state by ID
- `getNextState(currentStateId, context)`: Evaluate transitions and get next state
- `resolveToSkillState(startStateId, context)`: Traverse routing nodes to find skill-bearing state
- `buildTransitionContext(sessionState)`: Build context for transition evaluation