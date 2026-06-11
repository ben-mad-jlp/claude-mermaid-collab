# State Machine Patterns

Design patterns used in the workflow state machine implementation for managing collab session flow.

## Core Patterns

### 1. Routing Nodes
States with `skill: null` automatically traverse to the next skill-bearing state without user interaction. Used for conditional routing based on context.

### 2. Transition Guards
Conditions that must evaluate true for a transition to occur. Multiple transitions can exist from one state, with first matching condition winning.

### 3. Context-Based Routing
Transitions evaluate against `TransitionContext` containing current item type, remaining items, and batch status.

### 4. Clear States
Interleaved `collab-clear` states between phases allow context compaction and user confirmation points.

### 5. Loop Patterns
The batch execution phase uses a loop pattern: `batch-router` → `execute-batch` → `clear-post-batch` → back to `batch-router`.