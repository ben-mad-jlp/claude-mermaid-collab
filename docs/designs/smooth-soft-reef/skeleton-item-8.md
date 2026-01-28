# Skeleton: Item 8

## Fix state machine to process each item through full pipeline

### Task Graph

```yaml
tasks:
  - id: item8-types-itemstatus
    file: src/mcp/workflow/types.ts
    action: modify
    description: Replace WorkItem status type with unified ItemStatus pipeline
    depends: []
    
  - id: item8-transitions-conditions
    file: src/mcp/workflow/transitions.ts
    action: modify
    description: Add itemReadyFor* condition functions for each pipeline phase
    depends: [item8-types-itemstatus]
    
  - id: item8-statemachine-helpers
    file: src/mcp/workflow/state-machine.ts
    action: modify
    description: Add findNextPendingItem, updateItemStatus, getCurrentWorkItem helpers
    depends: [item8-types-itemstatus]
    
  - id: item8-statemachine-getnextstate
    file: src/mcp/workflow/state-machine.ts
    action: modify
    description: Update getNextState to implement per-item pipeline flow
    depends: [item8-statemachine-helpers, item8-transitions-conditions]
    
  - id: item8-migration
    file: src/mcp/workflow/state-machine.ts
    action: modify
    description: Add migration logic to convert 'documented' → 'brainstormed'
    depends: [item8-types-itemstatus]
```

### Stub Code

#### src/mcp/workflow/types.ts

```typescript
// REPLACE existing status type
type ItemStatus = 
  | 'pending'
  | 'brainstormed'  // was 'documented'
  | 'interface'
  | 'pseudocode'
  | 'skeleton'
  | 'complete';

interface WorkItem {
  number: number;
  title: string;
  type: WorkItemType;
  status: ItemStatus;  // Changed from 'pending' | 'documented'
}
```

#### src/mcp/workflow/transitions.ts

```typescript
// ADD: Pipeline phase condition functions
export function itemReadyForInterface(state: SessionState): boolean {
  // TODO: Get current item, check status === 'brainstormed'
  throw new Error('Not implemented');
}

export function itemReadyForPseudocode(state: SessionState): boolean {
  // TODO: Get current item, check status === 'interface'
  throw new Error('Not implemented');
}

export function itemReadyForSkeleton(state: SessionState): boolean {
  // TODO: Get current item, check status === 'pseudocode'
  throw new Error('Not implemented');
}

export function readyForHandoff(state: SessionState): boolean {
  // TODO: Check all items have status === 'complete'
  throw new Error('Not implemented');
}
```

#### src/mcp/workflow/state-machine.ts

```typescript
// ADD: Helper functions
function findNextPendingItem(workItems: WorkItem[]): WorkItem | null {
  // TODO: Find first item with status !== 'complete'
  throw new Error('Not implemented');
}

function updateItemStatus(item: WorkItem, newStatus: ItemStatus): void {
  // TODO: Validate transition, update status
  throw new Error('Not implemented');
}

// MODIFY: getNextState
function getNextState(currentState: string, sessionState: SessionState): string {
  // TODO: Implement per-item pipeline routing
  // - After brainstorm-validating → rough-draft-interface (same item)
  // - After rough-draft-skeleton → brainstorm-exploring (next item) or ready-to-implement
  throw new Error('Not implemented');
}

// ADD: Migration
function migrateItemStatus(status: string): ItemStatus {
  if (status === 'documented') return 'brainstormed';
  return status as ItemStatus;
}
```

### Verification Checklist

- [x] All files from interface listed with tasks
- [x] Task dependencies form valid DAG
- [x] 5 tasks - appropriate for complexity
- [x] Migration task for backwards compatibility
