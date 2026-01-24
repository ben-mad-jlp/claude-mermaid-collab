# Skeleton: Item 11 - Always Show Task Execution Diagram

## File Changes

This item primarily involves skill updates.

### skills/executing-plans/SKILL.md (MODIFY)
```markdown
## Task Execution Diagram (Mandatory)

At the start of execution, ALWAYS create the task-execution diagram:

1. Call create_diagram with all tasks in waiting state
2. Call preview_diagram to open in viewer
3. As tasks progress, call patch_diagram to update status

<!-- TODO: Add detailed instructions -->
```

### skills/executing-plans-execution/SKILL.md (MODIFY)
```markdown
## Status Updates

When claiming task:
- patch_diagram: waiting → executing

When completing task:
- patch_diagram: executing → completed

When task fails:
- patch_diagram: executing → failed

<!-- TODO: Add implementation details -->
```

## Helper Functions (to add to skills)

### buildTaskDiagram function
```markdown
<!-- Add to skill documentation -->
FUNCTION buildTaskDiagram(tasks):
  # Generate Mermaid flowchart with task nodes and dependencies
  # Include classDef for waiting, executing, completed, failed
```

### updateTaskStatus function
```markdown
<!-- Add to skill documentation -->
FUNCTION updateTaskStatus(taskId, newStatus):
  # Use patch_diagram to update task class
```

## Task Dependency Graph

```yaml
tasks:
  - id: update-executing-plans
    files: [skills/executing-plans/SKILL.md]
    description: Add mandatory diagram creation and helper functions
    parallel: true

  - id: update-execution-skill
    files: [skills/executing-plans-execution/SKILL.md]
    description: Add status update instructions for task state changes
    depends-on: [update-executing-plans]
```
