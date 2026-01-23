# Pseudocode: Item 3 - Task Subagent Parallel Dispatch Fix

## [APPROVED]

## File: skills/executing-plans/execution.md

### Parallel Dispatch Logic

```
FUNCTION dispatchParallelTasks(tasks):
  # Filter to parallel-safe tasks (no unmet dependencies)
  readyTasks = []
  
  FOR task IN tasks:
    IF task.status == "pending":
      IF task.dependsOn.length == 0 OR allDependenciesMet(task.dependsOn):
        IF task.parallel == true:
          ADD task TO readyTasks
  
  # Limit batch size (max 3-5 concurrent)
  MAX_PARALLEL = 3
  batch = readyTasks.slice(0, MAX_PARALLEL)
  
  IF batch.length == 0:
    RETURN { dispatched: 0 }
  
  # CRITICAL: Build ALL Task tool calls in ONE message
  # Do NOT dispatch sequentially
  
  toolCalls = []
  FOR task IN batch:
    prompt = buildTaskPrompt(task)
    
    ADD {
      tool: "Task",
      args: {
        description: "Implement {task.id}",
        prompt: prompt,
        subagent_type: "mermaid-collab:subagent-driven-development:implementer-prompt"
      }
    } TO toolCalls
  
  # Execute all tool calls in single response
  # This is the key - multiple Task calls, one message
  EXECUTE toolCalls IN PARALLEL
  
  # Mark tasks as in_progress
  FOR task IN batch:
    updateTaskStatus(task.id, "in_progress")
  
  RETURN { dispatched: batch.length, tasks: batch }
```

### Build Task Prompt

```
FUNCTION buildTaskPrompt(task):
  designDocPath = ".collab/{session}/documents/design.md"
  interfacePath = ".collab/{session}/documents/interface-item-{task.itemNumber}.md"
  pseudocodePath = ".collab/{session}/documents/pseudocode-item-{task.itemNumber}.md"
  
  prompt = """
You are implementing task: {task.id}

## Task Description
{task.description}

## Files to Create/Modify
{task.files.join('\n')}

## Design References
- Design doc: {designDocPath}
- Interface: {interfacePath}  
- Pseudocode: {pseudocodePath}

## Instructions
1. Read the interface and pseudocode documents
2. Implement exactly as specified - no improvements
3. Write tests first (TDD)
4. Commit when tests pass
5. Self-review before completing

## Anti-Drift Rules
- Implement EXACTLY what the spec says
- If something seems wrong, ASK - don't fix
- No extra features, no "improvements"
"""
  
  RETURN prompt
```

### Wrong Pattern (to document)

```
# WRONG - Sequential dispatch
FUNCTION dispatchSequentially_WRONG(tasks):
  FOR task IN tasks:
    # This waits for each task before starting next
    EXECUTE Task(task)  # WRONG!
    WAIT for completion  # WRONG!
  
  # Tasks run one at a time, not in parallel
```

## Verification
- [ ] Example shows multiple Task calls in one message
- [ ] MAX_PARALLEL limit documented
- [ ] Wrong sequential pattern explicitly shown
- [ ] "CRITICAL" callout emphasizes requirement
