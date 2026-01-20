# Implementation Skeleton

## Task Dependency Graph

View at: http://localhost:3737/diagram.html?project=%2FUsers%2Fbenmaderazo%2FCode%2Fclaude-mermaid-collab&session=pure-light-beach&id=task-dependency-graph

## Implementation Phases

### Phase 1: Foundation (parallel tasks)

**Task 1: Create gather-session-goals skill**
- File: `skills/gather-session-goals/SKILL.md` (NEW)
- Dependencies: None
- Estimated scope: ~150 lines

**Task 2: Define collab-required check pattern**
- Create reusable markdown snippet for the check
- Will be copied into each skill that needs it
- Dependencies: None
- Estimated scope: ~30 lines

---

### Phase 2: Core Skills (parallel, after Phase 1)

**Task 3: Update systematic-debugging**
- File: `skills/systematic-debugging/SKILL.md` (MODIFY)
- Changes:
  - Add collab-required check at top
  - Add "Get Current Work Item" section
  - Add "EXPLICIT PROHIBITION" section
  - Modify output to update design doc item
- Dependencies: Task 2
- Estimated scope: ~50 lines added/modified

**Task 4: Update brainstorming**
- File: `skills/brainstorming/SKILL.md` (MODIFY)
- Changes:
  - Add collab-required check at top
  - Add "Get Current Work Item" section
  - Add single-item mode logic
  - Modify phases to scope to current item
- Dependencies: Task 2
- Estimated scope: ~60 lines added/modified

**Task 5: Update ready-to-implement**
- File: `skills/ready-to-implement/SKILL.md` (MODIFY)
- Changes:
  - Add collab-required check at top
  - Replace decision-marker parsing with Status field parsing
  - Update output format for work items
  - Add return-to-loop logic
- Dependencies: Task 2
- Estimated scope: ~80 lines modified

---

### Phase 3: Orchestrator (after Phase 2)

**Task 6: Update collab skill**
- File: `skills/collab/SKILL.md` (MODIFY)
- Changes:
  - Add gather-session-goals invocation after session creation
  - Add WorkItemLoop section with full logic
  - Modify resume flow to always go through ready-to-implement
  - Add parseWorkItems helper documentation
  - Update state tracking for currentItem
- Dependencies: Tasks 1, 3, 4, 5
- Estimated scope: ~100 lines added/modified

---

### Phase 4: Remaining Checks (parallel)

**Task 7: Add collab check to rough-draft**
- File: `skills/rough-draft/SKILL.md` (MODIFY)
- Changes:
  - Add collab-required check section at top
- Dependencies: Task 2
- Estimated scope: ~15 lines added

**Task 8: Add collab check to executing-plans**
- File: `skills/executing-plans/SKILL.md` (MODIFY)
- Changes:
  - Add collab-required check section at top
- Dependencies: Task 2
- Estimated scope: ~15 lines added

---

### Phase 5: Integration Testing

**Task 9: End-to-end test**
- Manual testing of the new flow
- Test cases:
  1. New session with multiple work items (mix of types)
  2. Resume session with pending items
  3. Resume session with all documented items
  4. Try to run /brainstorming without collab session (should fail)
  5. Try to run /systematic-debugging without collab session (should fail)
- Dependencies: Tasks 6, 7, 8

---

## File Change Summary

| Task | File | Change Type | Lines (est) |
|------|------|-------------|-------------|
| 1 | `skills/gather-session-goals/SKILL.md` | NEW | ~150 |
| 3 | `skills/systematic-debugging/SKILL.md` | MODIFY | ~50 |
| 4 | `skills/brainstorming/SKILL.md` | MODIFY | ~60 |
| 5 | `skills/ready-to-implement/SKILL.md` | MODIFY | ~80 |
| 6 | `skills/collab/SKILL.md` | MODIFY | ~100 |
| 7 | `skills/rough-draft/SKILL.md` | MODIFY | ~15 |
| 8 | `skills/executing-plans/SKILL.md` | MODIFY | ~15 |

**Total: 1 new file, 6 modified files, ~470 lines**

---

## Parallel Execution Plan

```
Time →
─────────────────────────────────────────────────────────────

Phase 1:  [Task 1]─────────┐
          [Task 2]────┐    │
                      │    │
Phase 2:              ├───[Task 3]───┐
                      ├───[Task 4]───┼───┐
                      └───[Task 5]───┤   │
                                     │   │
Phase 3:                             └───┴───[Task 6]───┐
                                                        │
Phase 4:  [Task 7]──────────────────────────────────────┤
          [Task 8]──────────────────────────────────────┤
                                                        │
Phase 5:                                                └───[Task 9]
```

**Parallelization opportunities:**
- Phase 1: Tasks 1 and 2 can run in parallel
- Phase 2: Tasks 3, 4, 5 can run in parallel (after Task 2)
- Phase 4: Tasks 7 and 8 can run in parallel (after Task 2)
- Task 6 must wait for Tasks 1, 3, 4, 5 (it orchestrates them)
- Task 9 must wait for all others (integration test)