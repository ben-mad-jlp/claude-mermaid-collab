# State Machine

The workflow state machine orchestrates Claude Code collab sessions through a defined set of states and transitions. It manages the flow from session start through brainstorming, rough-draft phases, implementation, and completion.

## Key Concepts

- **States**: Discrete workflow stages identified by `StateId` (e.g., `collab-start`, `brainstorm-exploring`, `rough-draft-interface`)
- **Transitions**: Movement between states, optionally guarded by conditions
- **Routing nodes**: States with `skill: null` that automatically route to the next skill-bearing state
- **Skills**: Each state maps to a skill that executes when that state is active

## Workflow Phases

1. **Entry**: `collab-start` → `gather-goals` → `clear-pre-item`
2. **Work Item Router**: Routes based on item type (code/task/bugfix)
3. **Brainstorming**: exploring → clarifying → designing → validating
4. **Rough-Draft** (code items): interface → pseudocode → skeleton → build-task-graph → handoff
5. **Execution**: batch-router → execute-batch → log-batch-complete (loops)
6. **Completion**: workflow-complete → cleanup → done