# Interface Definition: Item 8

## Fix state machine to process each item through full pipeline

### File Structure

- `src/mcp/workflow/types.ts` - **MODIFY** - Update WorkItem status type to unified pipeline
- `src/mcp/workflow/state-machine.ts` - **MODIFY** - Change transition logic to per-item pipeline
- `src/mcp/workflow/transitions.ts` - **MODIFY** - Update condition checks for new status values

### Type Definitions

```typescript
// src/mcp/workflow/types.ts

/**
 * Unified pipeline status for work items.
 * Each item progresses: pending → brainstormed → interface → pseudocode → skeleton → complete
 */
type ItemStatus = 
  | 'pending'      // Not started
  | 'brainstormed' // Design spec complete, ready for rough-draft
  | 'interface'    // Interface doc created
  | 'pseudocode'   // Pseudocode doc created
  | 'skeleton'     // Skeleton doc created (rough-draft complete)
  | 'complete';    // Ready for implementation

/**
 * Work item with unified pipeline status
 */
interface WorkItem {
  number: number;
  title: string;
  type: WorkItemType;  // 'code' | 'task' | 'bugfix'
  status: ItemStatus;
}

/**
 * Session state (updated)
 */
interface SessionState {
  state: string;
  workItems: WorkItem[];
  currentItem: number | null;
  // Remove: documentedItems, totalItems (derived from workItems)
}
```

### Function Signatures

```typescript
// src/mcp/workflow/state-machine.ts

/**
 * Get the next state based on current state and work item status.
 * Implements per-item pipeline instead of per-phase batching.
 */
function getNextState(currentState: string, sessionState: SessionState): string;

/**
 * Check if current item has completed its current pipeline phase.
 */
function isCurrentItemPhaseComplete(sessionState: SessionState): boolean;

/**
 * Get the current item's next pipeline phase.
 */
function getNextItemPhase(item: WorkItem): ItemStatus;

/**
 * Check if all items have completed the full pipeline.
 */
function allItemsComplete(workItems: WorkItem[]): boolean;
```

```typescript
// src/mcp/workflow/transitions.ts

/**
 * Condition: current item is brainstormed and ready for interface
 */
function itemReadyForInterface(state: SessionState): boolean;

/**
 * Condition: current item has interface doc, ready for pseudocode
 */
function itemReadyForPseudocode(state: SessionState): boolean;

/**
 * Condition: current item has pseudocode doc, ready for skeleton
 */
function itemReadyForSkeleton(state: SessionState): boolean;

/**
 * Condition: all items complete, ready for handoff
 */
function readyForHandoff(state: SessionState): boolean;
```

### State Machine Flow (Per-Item)

```
For each work item:
  pending 
    → brainstorm-exploring → brainstorm-clarifying → brainstorm-designing → brainstorm-validating
    → brainstormed
    → rough-draft-interface → interface
    → rough-draft-pseudocode → pseudocode  
    → rough-draft-skeleton → skeleton
    → complete
    
When all items complete:
  → ready-to-implement → handoff
```

### Verification Checklist

- [x] All files from design are listed (3 files)
- [x] All public interfaces have signatures
- [x] Parameter types are explicit
- [x] ItemStatus type covers full pipeline
- [x] Per-item flow documented
