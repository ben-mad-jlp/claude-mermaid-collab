# Pseudocode: Item 11 - Always Show Task Execution Diagram

## executing-plans Skill Update

```
# At start of executing-plans:

FUNCTION initializeTaskDiagram(tasks):
  # Build Mermaid flowchart with all tasks
  mermaidContent = buildTaskDiagram(tasks, initialStatus='waiting')
  
  # Always create the diagram (never skip)
  CALL mcp__mermaid__create_diagram({
    project: getCurrentProject(),
    session: getCurrentSession(),
    name: 'task-execution',
    content: mermaidContent
  })
  
  # Open in viewer immediately
  CALL mcp__mermaid__preview_diagram({
    project: getCurrentProject(),
    session: getCurrentSession(),
    id: 'task-execution'
  })

FUNCTION buildTaskDiagram(tasks, statusMap = {}):
  lines = ['flowchart TD']
  
  # Define task nodes with status classes
  FOR task IN tasks:
    status = statusMap[task.id] || 'waiting'
    lines.push(`    ${task.id}[${task.description}]:::${status}`)
  
  # Define dependencies
  FOR task IN tasks:
    FOR dep IN task.dependsOn:
      lines.push(`    ${dep} --> ${task.id}`)
  
  # Define style classes
  lines.push('')
  lines.push('    classDef waiting fill:#ffd700,stroke:#333')
  lines.push('    classDef executing fill:#1e90ff,stroke:#333,color:#fff')
  lines.push('    classDef completed fill:#32cd32,stroke:#333')
  lines.push('    classDef failed fill:#dc143c,stroke:#333,color:#fff')
  
  RETURN lines.join('\n')
```

## Task Status Updates

```
FUNCTION updateTaskStatus(taskId, newStatus):
  oldStatus = getCurrentStatus(taskId)
  
  # Use patch_diagram to update just the class
  CALL mcp__mermaid__patch_diagram({
    project: getCurrentProject(),
    session: getCurrentSession(),
    id: 'task-execution',
    old_string: `${taskId}[...]:::${oldStatus}`,
    new_string: `${taskId}[...]:::${newStatus}`
  })
  
  # Store new status
  setCurrentStatus(taskId, newStatus)
```

## executing-plans-execution Update

```
# When claiming a task:
FUNCTION onTaskClaim(taskId):
  updateTaskStatus(taskId, 'executing')

# When task completes:
FUNCTION onTaskComplete(taskId):
  updateTaskStatus(taskId, 'completed')

# When task fails:
FUNCTION onTaskFail(taskId):
  updateTaskStatus(taskId, 'failed')
```

## Skill Modifications

```
# skills/executing-plans/SKILL.md additions:

## Task Execution Diagram (Mandatory)

At the start of execution, ALWAYS create the task-execution diagram:

1. Call create_diagram with all tasks in waiting state
2. Call preview_diagram to open in viewer
3. As tasks progress, call patch_diagram to update status

Status flow: waiting → executing → completed (or failed)

DO NOT skip diagram creation. It is mandatory for all executions.
```

## Real-time Updates

```
# Throughout execution loop:

FUNCTION executeTask(task):
  # Mark as executing
  updateTaskStatus(task.id, 'executing')
  
  TRY:
    # Run the task
    result = await runTask(task)
    
    # Mark as completed
    updateTaskStatus(task.id, 'completed')
    
    RETURN result
  CATCH error:
    # Mark as failed
    updateTaskStatus(task.id, 'failed')
    THROW error
```
