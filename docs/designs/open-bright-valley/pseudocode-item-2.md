# Pseudocode: Item 2 - Task Flow Diagram in MCP

## task-diagram.ts

### generateTaskDiagram(state)

```
1. If state.batches is undefined or empty:
   - Return empty string (no diagram to generate)

2. Initialize mermaid = "graph TD\n"

3. For each batch at index i in state.batches:
   a. Add subgraph header:
      - mermaid += "    subgraph batch_{i}[\"Batch {i+1}\"]\n"
   
   b. For each task in batch.tasks:
      - Get color from STATUS_COLORS[task.status]
      - Add node definition:
        mermaid += "        {task.id}([\"{task.id}\"])\n"
      - Add style:
        mermaid += "        style {task.id} {color}\n"
   
   c. Close subgraph:
      mermaid += "    end\n"

4. Add dependency arrows (after all subgraphs):
   For each batch in state.batches:
     For each task in batch.tasks:
       For each dep in task.dependsOn:
         mermaid += "    {dep} --> {task.id}\n"

5. Return mermaid
```

**Error Handling:**
- Missing batches: Return empty string
- Task with undefined status: Default to 'pending'

### updateTaskDiagram(project, session, state)

```
1. Generate diagram content:
   content = generateTaskDiagram(state)

2. If content is empty:
   - Return early (nothing to update)

3. Try to update existing diagram:
   response = fetch PUT /api/diagram/task-execution
   
4. If diagram doesn't exist (404):
   - Create new diagram:
     fetch POST /api/diagram with name="task-execution"

5. Log success/failure
```

**Error Handling:**
- API error: Log error, don't throw (diagram is non-critical)
- Network error: Log and continue

### buildDiagramContent(batches)

```
1. Same logic as generateTaskDiagram but takes batches directly
2. Used internally for testing
```

---

## task-sync.ts

### parseTaskGraph(documentContent)

```
1. Find YAML block in document:
   - Search for ```yaml ... ``` pattern
   - Extract content between markers

2. If no YAML found:
   - Throw Error("No YAML task graph found in document")

3. Parse YAML content:
   - Use yaml.parse() or similar

4. Validate structure:
   - Must have 'tasks' array
   - Each task must have 'id' and 'files'

5. Return parsed TaskGraph object
```

**Error Handling:**
- No YAML block: Throw descriptive error
- Invalid YAML syntax: Throw with parse error
- Missing required fields: Throw validation error

### buildBatches(tasks)

```
1. Detect cycles first:
   cycles = detectCycles(tasks)
   If cycles: throw Error("Circular dependency: {cycles}")

2. Build dependency map:
   dependencyMap = Map<taskId, Set<taskId>>
   For each task:
     dependencyMap.set(task.id, new Set(task['depends-on'] || []))

3. Topological sort into waves:
   waves = []
   remaining = Set of all task IDs
   
   While remaining is not empty:
     // Find tasks with all dependencies satisfied
     wave = []
     For each taskId in remaining:
       deps = dependencyMap.get(taskId)
       If all deps are NOT in remaining:
         wave.push(taskId)
     
     If wave is empty AND remaining is not empty:
       // Should never happen if cycle detection worked
       throw Error("Unable to sort tasks")
     
     waves.push(wave)
     Remove wave items from remaining

4. Convert waves to TaskBatch array:
   batches = waves.map((wave, index) => ({
     id: "batch-{index+1}",
     tasks: wave.map(taskId => ({
       id: taskId,
       status: 'pending',
       dependsOn: tasks.find(t => t.id === taskId)['depends-on'] || []
     })),
     status: 'pending'
   }))

5. Return batches
```

**Edge Cases:**
- Task with no dependencies: Goes in wave 1
- All tasks independent: Single wave with all tasks
- Linear chain: Each task in its own wave

### syncTasksFromTaskGraph(project, session)

```
1. Read task-graph document:
   doc = fetch GET /api/document/task-graph
   If not found: throw Error("task-graph.md not found")

2. Parse task graph:
   graph = parseTaskGraph(doc.content)

3. Build batches:
   batches = buildBatches(graph.tasks)

4. Update session state:
   updateSessionState(project, session, {
     batches: batches,
     currentBatch: 0,
     pendingTasks: flatMap of all task IDs,
     completedTasks: []
   })

5. Generate initial diagram:
   state = getSessionState(project, session)
   updateTaskDiagram(project, session, state)

6. Log: "Synced {tasks.length} tasks in {batches.length} batches"
```

**Error Handling:**
- Document not found: Throw with instructions
- Parse error: Throw with details
- Cycle detected: Throw with cycle path

### topologicalSort(tasks)

```
1. Same as wave building in buildBatches
2. Returns array of arrays (waves)
```

### detectCycles(tasks)

```
1. Build adjacency list from depends-on
2. Run DFS with visited/recursionStack tracking
3. If back edge found: return cycle path
4. Return null if no cycles
```

---

## build-task-graph Skill Integration

### Skill produces task-graph.md with format:

```markdown
# Task Dependency Graph

## YAML Task Graph

```yaml
tasks:
  - id: task-1
    files: [src/file1.ts]
    tests: [src/file1.test.ts]
    description: Implement feature X
    parallel: true
  
  - id: task-2
    files: [src/file2.ts]
    depends-on: [task-1]
    description: Build on feature X
```

## Execution Waves

**Wave 1 (no dependencies):**
- task-1

**Wave 2 (depends on Wave 1):**
- task-2

## Summary

- Total tasks: 2
- Total waves: 2
```

### Skill pseudocode:

```
1. Read interface and pseudocode documents for all items

2. For each item:
   a. Identify file changes from interface doc
   b. Map files to tasks (1 file = 1 task typically)
   c. Analyze dependencies:
      - If file A imports from file B, A depends on B's task
      - If pseudocode mentions "after X", explicit dependency

3. For each task:
   a. Generate test file paths using pattern:
      - {dir}/{name}.test{ext}
      - {dir}/__tests__/{name}.test{ext}
   b. Set parallel: true if no dependencies

4. Build YAML structure

5. Calculate execution waves (for human readability)

6. Check for file conflicts:
   - Multiple tasks modifying same file
   - Warn and suggest ordering

7. Create task-graph.md document via MCP
```
