# Implementation: delete-workflow-core

## Files Changed

Deleted (8 files):
- `src/mcp/workflow/state-machine.ts`
- `src/mcp/workflow/complete-skill.ts`
- `src/mcp/workflow/transitions.ts`
- `src/mcp/workflow/task-diagram.ts`
- `src/mcp/workflow/__tests__/state-machine.test.ts`
- `src/mcp/workflow/__tests__/complete-skill.test.ts`
- `src/mcp/workflow/__tests__/transitions.test.ts`
- `src/mcp/workflow/__tests__/task-sync-fallback.test.ts`

## What Was Implemented

Pure deletion task. Removed the state machine, complete-skill handler, transitions logic, and task-diagram module along with their corresponding test files from the workflow directory.

Remaining in `src/mcp/workflow/`:
- `task-status.ts` + test
- `task-sync.ts`
- `types.ts` + test
- `.pseudo` files (all 6 kept as-is)

## Test Results

N/A — pure deletion task

## Decisions / Assumptions

- `.pseudo` counterparts (`state-machine.pseudo`, `complete-skill.pseudo`, `transitions.pseudo`, `task-diagram.pseudo`) were not listed in the task spec and were left in place.
- `task-sync-fallback.test.ts` was included in the deletion per the task file list, even though its corresponding `task-sync.ts` source file was retained.
