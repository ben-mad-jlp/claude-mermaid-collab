# Implementation: trim-workflow-types

## Files Changed
- src/mcp/workflow/types.ts — trimmed to TaskBatch and BatchTask only
- src/mcp/workflow/__tests__/types.test.ts — deleted (no remaining tests)

## What Was Implemented
Rewrote types.ts to export only the two interfaces needed for vibe task graph execution: TaskBatch and BatchTask. Removed all state-machine types: StateId, SessionType, TransitionCondition, Transition, WorkflowState, CompleteSkillInput, CompleteSkillOutput, WorkItemType, ItemStatus, WorkItemStatus, and WorkItem.

Deleted types.test.ts entirely because every test in the file exercised deleted types (ItemStatus, WorkItem, WorkItemType). There were no tests for TaskBatch or BatchTask.

## Test Results
N/A

## Decisions / Assumptions
- types.test.ts had zero coverage of TaskBatch/BatchTask, so deletion was the correct outcome per the instructions.
- No other files in the workflow directory were modified; callers that imported the removed types will need separate cleanup if applicable.