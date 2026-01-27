# Pseudocode: Item 1 - MCP State Machine

## state-machine.ts

### getWorkflowStates()

```
1. Return WORKFLOW_STATES constant array
   - Array is defined at module level
   - Contains all state definitions with transitions
```

### getState(id)

```
1. Search WORKFLOW_STATES for state with matching id
2. Return state if found, undefined if not
```

### getSkillForState(id)

```
1. Get state by id
2. If state exists, return state.skill
3. Otherwise return null
```

---

## transitions.ts

### evaluateCondition(condition, context)

```
1. Switch on condition.type:

   CASE 'item_type':
     Return context.currentItemType === condition.value

   CASE 'items_remaining':
     Return context.itemsRemaining === true

   CASE 'no_items_remaining':
     Return context.itemsRemaining === false

   CASE 'batches_remaining':
     Return context.batchesRemaining === true

   CASE 'no_batches_remaining':
     Return context.batchesRemaining === false

   CASE 'always':
     Return true

   DEFAULT:
     Return false
```

### getNextState(currentStateId, context)

```
1. Get current state from state machine
   - If not found: throw Error("Unknown state: {currentStateId}")

2. Get transitions array from current state

3. For each transition in transitions:
   a. If transition has no condition:
      - Return transition.to (unconditional transition)
   b. If transition has condition:
      - Evaluate condition against context
      - If condition passes: return transition.to

4. If no transition matched:
   - Return null (terminal state or error)
```

**Error Handling:**
- Unknown state ID: Throw descriptive error
- No matching transition: Return null (caller decides what to do)

### buildTransitionContext(state, designDoc?)

```
1. Initialize context = {
     currentItemType: undefined,
     itemsRemaining: false,
     batchesRemaining: false
   }

2. If state.currentItem is set AND designDoc provided:
   a. Parse design doc for work items
   b. Find item matching state.currentItem
   c. Set context.currentItemType = item.type

3. If designDoc provided:
   a. Parse all work items
   b. Count items with status = 'pending' or 'documented'
   c. Set context.itemsRemaining = (pendingCount > 0)

4. If state.batches exists:
   a. Count batches with status !== 'completed'
   b. Set context.batchesRemaining = (pendingBatchCount > 0)

5. Return context
```

**Edge Cases:**
- No design doc: Only evaluate batch-related conditions
- No current item: Skip item type lookup
- Empty batches array: batchesRemaining = false

---

## complete-skill.ts

### completeSkill(project, session, completedSkill)

```
1. Read current session state from collab-state.json
   - If no state: throw Error("Session not found")

2. Map completed skill name to state ID
   - skill: "brainstorm-exploring" -> state: "brainstorm-exploring"
   - skill: "collab-clear" -> state depends on context (use stored state)

3. Read design document (if exists)
   - Used for building transition context

4. Build transition context from state + design doc

5. Get next state ID from transitions
   - If null: workflow complete, return { next_skill: null }

6. SPECIAL: If next state is a routing node (skill = null):
   a. Loop: get next state until we find one with a skill
   b. Keep evaluating conditions at each step

7. SPECIAL: If entering execution phase:
   a. Call syncTasksFromTaskGraph(project, session)
   b. Generate initial task diagram

8. Update collab-state.json:
   - state: new state ID
   - phase: derive from state ID (e.g., "rough-draft/interface")
   - currentItem: update if changed
   - lastActivity: auto-updated

9. Determine action:
   - If new state starts with "clear-": action = "clear"
   - Otherwise: action = "none"

10. Get skill name for new state

11. Return {
      next_skill: skill name (or null if done),
      action: "clear" | "none",
      params: { item_number, batch_index } if applicable
    }
```

**Error Handling:**
- Session not found: Throw error
- Unknown skill: Throw error with valid skill list
- Transition evaluation error: Log and throw

**Edge Cases:**
- collab-clear skill: Uses previous state to determine continuation
- Multiple routing nodes in sequence: Loop until real state found
- No more items: Transition to ready-to-implement

### skillToState(skill)

```
1. Normalize skill name (lowercase, trim)
2. Search WORKFLOW_STATES for state where state.skill === skill
3. Return state.id if found, null otherwise
```

### stateToSkill(stateId)

```
1. Get state by ID
2. Return state.skill (may be null for routing nodes)
```

---

## WORKFLOW_STATES Constant

```
Define array of WorkflowState objects:

[
  // Entry
  { id: 'collab-start', skill: 'collab-start', transitions: [
    { to: 'gather-goals', condition: { type: 'always' } }
  ]},
  
  { id: 'gather-goals', skill: 'gather-session-goals', transitions: [
    { to: 'clear-pre-item', condition: { type: 'always' } }
  ]},
  
  // Clear states (skill: 'collab-clear')
  { id: 'clear-pre-item', skill: 'collab-clear', transitions: [
    { to: 'work-item-router', condition: { type: 'always' } }
  ]},
  
  // Routing node (no skill)
  { id: 'work-item-router', skill: null, transitions: [
    { to: 'brainstorm-exploring', condition: { type: 'item_type', value: 'code' } },
    { to: 'brainstorm-exploring', condition: { type: 'item_type', value: 'task' } },
    { to: 'systematic-debugging', condition: { type: 'item_type', value: 'bugfix' } },
    { to: 'ready-to-implement', condition: { type: 'no_items_remaining' } }
  ]},
  
  // Brainstorming flow
  { id: 'brainstorm-exploring', skill: 'brainstorming-exploring', transitions: [
    { to: 'clear-bs1' }
  ]},
  { id: 'clear-bs1', skill: 'collab-clear', transitions: [
    { to: 'brainstorm-clarifying' }
  ]},
  // ... continue for all states from diagram
  
  // Terminal
  { id: 'done', skill: null, transitions: [] }
]
```
