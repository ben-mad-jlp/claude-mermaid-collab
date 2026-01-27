# Session: open-bright-valley

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Centralize skill orchestration via MCP state machine
**Type:** code
**Status:** documented
**Problem/Goal:**
Currently, skills explicitly specify which skill to invoke next (e.g., "Invoke skill: rough-draft"). This creates distributed, hardcoded transitions that are difficult to maintain and reason about.

**Approach:**

1. **State Machine in TypeScript** (`src/mcp/workflow/`)
   - `state-machine.ts` - State definitions and transitions
   - `transitions.ts` - Transition logic and conditions  
   - `complete-skill.ts` - MCP tool implementation

2. **New MCP Tool: `complete_skill`**
   ```typescript
   // Input
   { project: string, session: string, skill: string }
   
   // Output
   { next_skill: string | null, params?: object, action?: 'clear' | 'none' }
   ```

3. **Extended collab-state.json Schema**
   ```json
   {
     "state": "execute-batch",
     "phase": "implementation",
     "currentItem": 2,
     "batches": [
       { "id": "batch-1", "tasks": [...], "status": "completed" },
       { "id": "batch-2", "tasks": [...], "status": "in_progress" }
     ],
     "currentBatch": 1,
     "completedTasks": [...],
     "pendingTasks": [...]
   }
   ```

4. **State Machine Features**
   - All phases tracked (including sub-phases like brainstorm-exploring)
   - Conditional routing by item type (code/task/bugfix)
   - Work item iteration managed by state machine
   - `collab-clear` inserted between phases automatically
   - Batched execution with clear between batches

5. **Skill Simplification**
   - Remove all "Invoke skill:" directives
   - Remove manual `update_session_state` calls for phase
   - Remove routing logic from skills
   - Skills just do work and call `complete_skill()` at end

**Success Criteria:**
- MCP server contains the workflow state machine
- `complete_skill` tool returns next skill based on state
- Skills no longer contain hardcoded transitions
- `collab-clear` runs between all phases automatically
- Execution runs in batches with logging
- Workflow behavior unchanged (same end result)

**Decisions:**
- State machine defined in TypeScript (compiled into server)
- Single tool `complete_skill()` - no failure states, skills always complete
- MCP handles all routing including item type and work item iteration
- MCP auto-updates collab-state.json on every transition
- Clear (not compact) between phases for fresh context

**Diagrams:**
- [workflow-state-machine](http://localhost:3737/diagram.html?project=%2FUsers%2Fbenmaderazo%2FCode%2Fclaude-mermaid-collab&session=open-bright-valley&id=workflow-state-machine)

---

### Item 2: Move task flow diagram into MCP
**Type:** code
**Status:** documented
**Problem/Goal:**
Task flow diagrams need to be generated and updated manually. The MCP should own this since it already tracks task state.

**Approach:**

1. **New Skill: `build-task-graph`**
   - Separate skill extracted from rough-draft-skeleton
   - Creates `task-graph.md` in session documents
   - Contains YAML with tasks, dependencies, files, tests
   - Single responsibility - just builds the graph

2. **Updated Workflow**
   ```
   rough-draft-skeleton (stub files only)
       ↓
   build-task-graph (creates task-graph.md)
       ↓
   rough-draft-handoff
       ↓
   executing-plans (MCP generates diagram)
   ```

3. **Task Sync to State**
   ```typescript
   // When entering execution phase
   async function syncTasksFromTaskGraph(project, session) {
     const doc = await getDocument(project, session, 'task-graph');
     const yaml = parseYaml(doc.content);
     const batches = buildBatches(yaml.tasks);  // topological sort
     await updateSessionState(project, session, { batches });
   }
   ```

4. **Auto-Generate Diagram** (`src/mcp/workflow/task-diagram.ts`)
   ```typescript
   function generateTaskDiagram(state: CollabState): string {
     // Batches as subgraphs
     // Tasks with dependencies inside
     // Colors by status (pending/in_progress/completed/failed)
   }
   ```

5. **Auto-Update Trigger**
   - Diagram regenerates on every `complete_skill()` call during execution
   - Writes to `diagrams/task-execution.mmd` in session
   - No manual Claude intervention needed

**Success Criteria:**
- `build-task-graph` skill exists and creates consistent YAML format
- MCP reads task-graph.md and syncs to collab-state.json
- MCP auto-generates diagram with batches as subgraphs
- Diagram colors update automatically on task status change
- No manual diagram creation/updates in executing-plans skill

**Decisions:**
- Separate `build-task-graph` skill (not in rough-draft-skeleton)
- `task-graph.md` in documents is source of truth for task definitions
- `collab-state.json` tracks runtime status (synced from task-graph.md)
- Diagram auto-updates on every state change during execution
- Batches shown as subgraphs with tasks inside

---

## Diagrams
(auto-synced)