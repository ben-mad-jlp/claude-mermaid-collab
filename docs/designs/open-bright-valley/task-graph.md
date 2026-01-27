# Task Dependency Graph - All Items

## YAML Task Graph

```yaml
tasks:
  # Item 1: MCP State Machine
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

  - id: collab-state-extend
    files: [src/mcp/tools/collab-state.ts]
    tests: [src/mcp/tools/collab-state.test.ts, src/mcp/tools/__tests__/collab-state.test.ts]
    description: Extend CollabState with new fields (state, batches, currentBatch)
    depends-on: [workflow-types]

  - id: transitions
    files: [src/mcp/workflow/transitions.ts]
    tests: [src/mcp/workflow/transitions.test.ts, src/mcp/workflow/__tests__/transitions.test.ts]
    description: Transition logic and condition evaluation
    depends-on: [state-machine]

  - id: complete-skill
    files: [src/mcp/workflow/complete-skill.ts]
    tests: [src/mcp/workflow/complete-skill.test.ts, src/mcp/workflow/__tests__/complete-skill.test.ts]
    description: complete_skill MCP tool implementation
    depends-on: [transitions, collab-state-extend]

  - id: setup-register
    files: [src/mcp/setup.ts]
    tests: [src/mcp/setup.test.ts]
    description: Register complete_skill tool in MCP server
    depends-on: [complete-skill]

  # Item 2: Task Flow Diagram
  - id: task-diagram
    files: [src/mcp/workflow/task-diagram.ts]
    tests: [src/mcp/workflow/task-diagram.test.ts, src/mcp/workflow/__tests__/task-diagram.test.ts]
    description: Diagram generation from workflow state
    depends-on: [workflow-types]

  - id: task-sync
    files: [src/mcp/workflow/task-sync.ts]
    tests: [src/mcp/workflow/task-sync.test.ts, src/mcp/workflow/__tests__/task-sync.test.ts]
    description: Sync tasks from task-graph.md to state
    depends-on: [workflow-types, collab-state-extend]

  - id: build-task-graph-skill
    files: [skills/build-task-graph/SKILL.md]
    description: New skill for building task graph YAML
    parallel: true

  - id: complete-skill-diagram
    files: [src/mcp/workflow/complete-skill.ts]
    tests: [src/mcp/workflow/complete-skill.test.ts]
    description: Add diagram update triggers to complete_skill
    depends-on: [complete-skill, task-diagram, task-sync]
```

## Execution Waves

**Wave 1 (no dependencies - parallel):**
- workflow-types
- build-task-graph-skill

**Wave 2 (depends on Wave 1):**
- state-machine
- collab-state-extend
- task-diagram

**Wave 3 (depends on Wave 2):**
- transitions
- task-sync

**Wave 4 (depends on Wave 3):**
- complete-skill

**Wave 5 (depends on Wave 4):**
- setup-register
- complete-skill-diagram

## File Conflict Analysis

**Conflict:** `src/mcp/workflow/complete-skill.ts`
- Task `complete-skill` creates the file
- Task `complete-skill-diagram` modifies it

**Resolution:** Run `complete-skill` before `complete-skill-diagram` (already enforced by dependencies).

**Conflict:** `src/mcp/tools/collab-state.ts`
- Task `collab-state-extend` modifies existing file
- No other tasks touch this file

**No conflict** - single task owns this file.

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 10 |
| Total waves | 5 |
| Max parallelism | 3 (Wave 2) |
| New files | 6 |
| Modified files | 2 |
