# Implementation: trim-mcp-setup

## Files Changed
- src/mcp/setup.ts

## What Was Implemented
Removed three MCP tools that exclusively supported the structured mode state machine:

1. **`complete_skill`** — tool definition (with `// Workflow orchestration` comment) and case handler removed
2. **`get_session_state`** — tool definition and case handler removed
3. **`update_session_state`** — tool definition and case handler removed

Also removed the import:
- `import { completeSkill } from './workflow/complete-skill.js';`

No workflow/transitions.js or workflow/state-machine.js imports were present in setup.ts (they were not imported there). No SessionType/WorkItem/WorkItemType/StateId type imports were present either.

Kept intact: `update_task_status`, `update_tasks_status`, `get_task_graph`, `sync_task_graph`, `set_artifact_metadata`, `clear_session_artifacts`, `archive_session`, and all other tools.

## Test Results
N/A

## Decisions / Assumptions
- `getSessionState` and `updateSessionState` function imports from `./tools/collab-state.js` were left in place — they may still be used by other handlers (e.g., `archive_session`, `clear_session_artifacts`). Only the MCP tool definitions and their case handlers were removed.
- The `// Workflow orchestration` comment block that preceded the `complete_skill` definition was also removed since it only annotated that tool.