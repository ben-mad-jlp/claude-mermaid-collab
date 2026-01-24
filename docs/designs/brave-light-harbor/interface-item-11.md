# Interface: Item 11 - Always Show Task Execution Diagram

## File Structure
- `skills/executing-plans/SKILL.md` - Update to always create diagram (MODIFY)
- `skills/executing-plans-execution/SKILL.md` - Update task status in diagram (MODIFY)

## Diagram Structure

```mermaid
flowchart TD
    subgraph tasks[Task Execution]
        task1[Task 1: Description]:::waiting
        task2[Task 2: Description]:::waiting
        task3[Task 3: Description]:::waiting
    end
    
    task1 --> task2
    task2 --> task3
    
    classDef waiting fill:#ffd700,stroke:#333
    classDef executing fill:#1e90ff,stroke:#333,color:#fff
    classDef completed fill:#32cd32,stroke:#333
    classDef failed fill:#dc143c,stroke:#333,color:#fff
```

## Status Update Pattern

When task starts:
```
Tool: mcp__mermaid__patch_diagram
Args: {
  "id": "task-execution",
  "old_string": "task1[Task 1: Description]:::waiting",
  "new_string": "task1[Task 1: Description]:::executing"
}
```

When task completes:
```
Tool: mcp__mermaid__patch_diagram  
Args: {
  "id": "task-execution",
  "old_string": "task1[Task 1: Description]:::executing",
  "new_string": "task1[Task 1: Description]:::completed"
}
```

## Skill Changes

executing-plans skill must:
1. Always create task-execution diagram at start (never skip)
2. Ensure diagram is visible in viewer (use preview_diagram)
3. Update task status as each task progresses

executing-plans-execution must:
1. Update diagram when claiming task (waiting → executing)
2. Update diagram when completing task (executing → completed)
3. Update diagram on failure (executing → failed)
