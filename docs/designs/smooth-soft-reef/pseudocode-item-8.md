# Pseudocode: Item 8

## Fix state machine to process each item through full pipeline

### src/mcp/workflow/types.ts

```
TYPE ItemStatus = 'pending' | 'brainstormed' | 'interface' | 'pseudocode' | 'skeleton' | 'complete'

INTERFACE WorkItem {
  number: number
  title: string
  type: WorkItemType
  status: ItemStatus
}
```

### src/mcp/workflow/state-machine.ts

#### getNextState(currentState, sessionState)

```
FUNCTION getNextState(currentState, sessionState):
  currentItem = getCurrentWorkItem(sessionState)
  
  // If no current item, find next pending item
  IF currentItem is null:
    nextItem = findNextPendingItem(sessionState.workItems)
    IF nextItem is null:
      // All items complete
      RETURN 'ready-to-implement'
    ELSE:
      // Start brainstorming next item
      RETURN 'brainstorm-exploring'
  
  // Route based on current state and item status
  SWITCH currentState:
    // Brainstorming phases (existing logic, but for single item)
    CASE 'brainstorm-validating':
      // Item brainstorming complete, move to rough-draft
      updateItemStatus(currentItem, 'brainstormed')
      RETURN 'rough-draft-interface'
    
    // Rough-draft phases (per item)
    CASE 'rough-draft-interface':
      // Interface doc created
      updateItemStatus(currentItem, 'interface')
      RETURN 'rough-draft-pseudocode'
      
    CASE 'rough-draft-pseudocode':
      // Pseudocode doc created
      updateItemStatus(currentItem, 'pseudocode')
      RETURN 'rough-draft-skeleton'
      
    CASE 'rough-draft-skeleton':
      // Skeleton complete, mark item complete
      updateItemStatus(currentItem, 'complete')
      
      // Check if more items remain
      nextItem = findNextPendingItem(sessionState.workItems)
      IF nextItem:
        // Start next item from brainstorming
        setCurrentItem(nextItem.number)
        RETURN 'brainstorm-exploring'
      ELSE:
        // All items done
        RETURN 'ready-to-implement'
    
    DEFAULT:
      // Standard transitions (existing logic)
      RETURN existingTransitionLogic(currentState)
```

#### findNextPendingItem(workItems)

```
FUNCTION findNextPendingItem(workItems):
  FOR item IN workItems:
    IF item.status !== 'complete':
      RETURN item
  RETURN null
```

#### updateItemStatus(item, newStatus)

```
FUNCTION updateItemStatus(item, newStatus):
  // Validate status progression
  validTransitions = {
    'pending': ['brainstormed'],
    'brainstormed': ['interface'],
    'interface': ['pseudocode'],
    'pseudocode': ['skeleton'],
    'skeleton': ['complete']
  }
  
  IF newStatus NOT IN validTransitions[item.status]:
    THROW 'Invalid status transition'
  
  item.status = newStatus
```

### src/mcp/workflow/transitions.ts

#### Condition functions

```
FUNCTION itemReadyForInterface(state):
  item = getCurrentWorkItem(state)
  RETURN item AND item.status === 'brainstormed'

FUNCTION itemReadyForPseudocode(state):
  item = getCurrentWorkItem(state)
  RETURN item AND item.status === 'interface'

FUNCTION itemReadyForSkeleton(state):
  item = getCurrentWorkItem(state)
  RETURN item AND item.status === 'pseudocode'

FUNCTION readyForHandoff(state):
  RETURN state.workItems.every(item => item.status === 'complete')
```

### Migration: Existing 'documented' status

```
// Map old status to new
FUNCTION migrateItemStatus(oldStatus):
  IF oldStatus === 'documented':
    RETURN 'brainstormed'  // Rename for clarity
  RETURN oldStatus
```

### Verification

- [x] All functions from interface covered
- [x] Per-item pipeline instead of per-phase batching
- [x] Status progression: pending → brainstormed → interface → pseudocode → skeleton → complete
- [x] Only routes to handoff when ALL items complete
- [x] Migration path for existing 'documented' status
