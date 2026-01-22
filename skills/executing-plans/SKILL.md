---
name: executing-plans
description: Use when executing implementation plans with independent tasks in the current session
user-invocable: true
model: haiku
allowed-tools:
  - mcp__plugin_mermaid-collab_mermaid__*
  - Read
  - Glob
  - Grep
  - Task
---

## Collab Session Required

Before proceeding, check for active collab session:

1. Check if `.collab/` directory exists
2. Check if any session folders exist within
3. If no session found:
   ```
   ⚠️ No active collab session found.

   Use /collab to start a session first.
   ```
   **STOP** - do not proceed with this skill.

4. If multiple sessions exist, check `COLLAB_SESSION_PATH` env var or ask user which session.

# Executing Plans

## Overview

Load plan, review critically, execute tasks in batches, report for review between batches.

**Core principle:** Batch execution with checkpoints for architect review.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create TodoWrite and proceed

### Step 1.1: Parse Task Dependency Graph (Collab Workflow)

When called from `rough-draft` within a collab workflow, the plan includes a task dependency graph. Parse and prepare for intelligent execution.

**Graph Format (YAML in design doc):**
```yaml
tasks:
  - id: auth-types
    files: [src/auth/types.ts]
    description: Core auth type definitions
    parallel: true

  - id: auth-service
    files: [src/auth/service.ts]
    description: Authentication service implementation
    depends-on: [auth-types]

  - id: auth-middleware
    files: [src/middleware/auth.ts]
    description: Express middleware for auth
    depends-on: [auth-service]
```

**Parsing Steps:**
1. Extract YAML block from design doc (look for `## Task Dependency Graph`)
2. Parse task list with: `id`, `files`, `description`, `parallel`, `depends-on`
3. Build adjacency list for dependency relationships
4. Validate: check for cycles (topological sort must succeed)
5. If cycle detected: STOP and report error to user

**Build Execution Order:**
1. Topological sort on dependency graph
2. Group tasks by "wave" (tasks with all dependencies satisfied)
3. Within each wave, identify parallel-safe tasks (those with `parallel: true` or independent file sets)

**Execution State Tracking:**

Initialize task tracking in `collab-state.json`:

```json
{
  "phase": "implementation",
  "completedTasks": [],
  "pendingTasks": ["task-1", "task-2", "task-3"],
  "pendingVerificationIssues": []
}
```

Use MCP tool or direct file update to initialize:
```
Tool: mcp__mermaid__update_collab_session_state
Args: {
  "sessionName": "<name>",
  "phase": "implementation"
}
```

Then update the file directly to add task arrays (MCP tool doesn't support custom fields yet).

### MANDATORY: Subagent Dispatch

**GATE:** Implementation MUST use the Task tool with subagent-driven-development skill.

**NEVER implement inline** - always dispatch a Task agent for each implementation task.

This is a hard requirement, not a suggestion. If you find yourself writing implementation code directly instead of spawning a Task agent, STOP immediately.

**Why this matters:**
- Task agents invoke subagent-driven-development which enforces TDD
- Spec compliance review only happens in subagent flow
- Code quality review only happens in subagent flow
- Skipping this means skipping ALL quality gates

**Pre-Task Checklist (before starting ANY task):**
- [ ] Will spawn a Task agent (not implement inline)
- [ ] Task prompt includes design doc location
- [ ] Task prompt specifies subagent-driven-development skill

**Post-Task Checklist (before marking ANY task complete):**
- [ ] Task agent was spawned (verified Task tool was used)
- [ ] subagent-driven-development skill was invoked by the agent
- [ ] Spec compliance review passed
- [ ] Code quality review passed

**If ANY checklist item fails:** Do NOT mark task as complete. Fix the issue first.

---

### Anti-Drift Rules

**NO INTERPRETATION:**
- Implement EXACTLY what the plan says, even if you think there's a better way
- If the plan says "create function foo(x) that returns x+1" — do that, not "a more flexible version"
- If something seems wrong or suboptimal, STOP and ask — do not "fix" it silently
- Your job is execution, not design improvement

**NO SHORTCUTS:**
- Complete every step in order, even if you "know" the outcome
- Run every test command, even if you're "sure" it will pass
- Write every file listed, even if you think some are "unnecessary"
- If a step feels redundant, do it anyway — the plan author had a reason

**DESIGN VERIFICATION:**
- Before each task: re-read the relevant design doc section
- If mermaid-collab diagrams are referenced, open and verify against them
- After each task: diff your implementation against the spec — EXACT match required
- Any deviation = undo and redo, or STOP and ask

**When in doubt:** Ask, don't improvise.

### Design Freeze

Once execution begins, the design is FROZEN.

**No changes during implementation:**
- No "small tweaks" to requirements
- No "I realized we need X" additions
- No "let's just add this while we're here"
- No scope creep, no matter how reasonable it sounds

**If something needs to change:**
1. STOP execution immediately
2. Document what needs to change and why
3. Go back to design doc — update it formally
4. Update the plan to reflect changes
5. THEN resume execution

**Why this matters:**
- Mid-implementation changes cause drift
- "Quick additions" compound into chaos
- The plan is a contract — honor it

### Step 1.5: Pre-Flight Check

Before executing ANY tasks, verify:
- [ ] Design doc exists and is complete
- [ ] All referenced mermaid-collab diagrams exist and are accessible
- [ ] No ambiguous requirements in the plan
- [ ] Every task has explicit file paths and pseudo code

**If anything is missing:** STOP. Go back to brainstorming/writing-plans. Do not proceed with incomplete specs.

### Step 1.6: Create Task Execution Diagram

When within a collab workflow, create a visual diagram showing all tasks and their dependencies:

**Build diagram content from task dependency graph:**
```
graph TD
    %% Node Definitions
    <for each task: task-id(["task-id"])>

    %% Dependencies
    <for each dependency: dep-id --> task-id>

    %% Styles (all waiting initially)
    <for each task: style task-id fill:#e0e0e0,stroke:#9e9e9e>
```

**Create the diagram:**
```
Tool: mcp__mermaid__create_diagram
Args: { "name": "task-execution", "content": <generated-content> }
```

**Display to user:**
```
Task execution diagram: <previewUrl>
```

**Style definitions for state changes:**
| State | Style |
|-------|-------|
| waiting | `fill:#e0e0e0,stroke:#9e9e9e` |
| executing | `fill:#bbdefb,stroke:#1976d2,stroke-width:3px` |
| completed | `fill:#c8e6c9,stroke:#2e7d32` |
| failed | `fill:#ffcdd2,stroke:#c62828` |

**Update diagram on state change:**
1. Use patch_diagram for atomic style updates:
   ```
   Tool: mcp__mermaid__patch_diagram
   Args: {
     "project": "<cwd>",
     "session": "<session>",
     "id": "task-execution",
     "old_string": "style <task-id> fill:#e0e0e0,stroke:#9e9e9e",
     "new_string": "style <task-id> fill:#bbdefb,stroke:#1976d2,stroke-width:3px"
   }
   ```
2. If patch_diagram fails (old_string not found), fall back to update_diagram

### Step 1.7: Verify Task Diagram Created

**REQUIRED:** Verify the task execution diagram exists before proceeding to execution.

```
Tool: mcp__mermaid__get_diagram
Args: { "project": "<cwd>", "session": "<session>", "id": "task-execution" }
```

**If diagram not found:**
```
Task execution diagram not found. Creating now...
```
→ Return to Step 1.6 and create the diagram.

**If diagram exists:**
```
Task execution diagram verified. Proceeding to execution.
```
→ Proceed to Step 2.

**This gate ensures the diagram is always created before any tasks execute.**

### Step 1.8: Understand Item Types and Execution Paths

**CONTEXT:** Within collab workflows, items come from the design doc with a `type` field. The execution path differs based on this type.

**Item Types:**
- **code:** New features, implementations, refactoring, investigations → uses test-driven-development (TDD)
- **bugfix:** Bug fixes, crashes, errors → uses test-driven-development (TDD)
- **task:** Operational tasks (docker setup, installs, configuration, organization) → skips TDD, executes directly

**How to Determine Item Type:**

1. Read the design doc
2. For each work item in the "Work Items" section, check the `Type:` field
3. The current item being executed should have an associated type from the design doc

**Execution Logic by Type:**

| Type | Execution Flow |
|------|----------------|
| code/bugfix | Invoke test-driven-development skill → Write failing test → Implement → Verify test passes |
| task | Execute task steps directly → Run verification checks |

**Task Type Items:**
- Use phases from task-planning: Prerequisites → Steps → Verification
- Prerequisites define what must exist before starting
- Steps are ordered commands/actions to execute
- Verification confirms success
- No TDD cycle needed (these are operational, not code)

**Code/Bugfix Type Items:**
- Follow standard TDD flow with red-green-refactor
- Still require verification but through test suite

### Step 2: Execute Batch
**Default: First 3 tasks** (or use dependency graph for collab workflow)

#### Standard Execution (No Dependency Graph)

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

#### Step 2.1: Per-Task Execution with Item Type Routing

Before executing each task, determine its item type and follow the appropriate execution path.

**Determine Item Type:**
1. Read design doc
2. Find the work item that this task belongs to
3. Check the `Type:` field from the work item
4. Map to execution flow

**Routing Logic:**

```
FUNCTION executeTask(task, itemType):
  IF itemType == "task":
    # Skip TDD for operational tasks
    EXECUTE task steps directly (from task-planning Prerequisites/Steps/Verification)
    RUN verification checks
    MARK task as complete if verification passes
  ELSE IF itemType IN ["code", "bugfix"]:
    # Normal TDD flow
    INVOKE test-driven-development skill
    WRITE failing test
    IMPLEMENT code per design spec
    VERIFY test passes
    MARK task as complete
  ELSE:
    STOP - unknown item type, ask user
```

**For Task Type Items:**
1. Execute prerequisites validation (verify all prerequisites exist)
2. Execute each step in order (run commands/actions)
3. Run verification checks (confirm success)
4. Mark task as complete

**For Code/Bugfix Type Items:**
1. Invoke test-driven-development skill
2. Work through red-green-refactor cycle
3. Mark task as complete

#### Dependency-Aware Execution (Collab Workflow)

When a task dependency graph is present, use intelligent parallel dispatch:

**Find Ready Tasks:**
```
ready_tasks = tasks where:
  - status is "pending"
  - all depends-on tasks are in "completed"
```

**Parallel Dispatch Logic:**
1. From ready tasks, identify parallel-safe group:
   - Tasks explicitly marked `parallel: true`
   - OR tasks with no file overlap and no shared dependencies
2. If multiple parallel-safe tasks exist:
   - Update task diagram: set all parallel tasks to "executing"
   - **REQUIRED:** Spawn Task agents in parallel (single message, multiple tool calls)
   - Each Task agent MUST invoke `subagent-driven-development` skill
   - Task prompt includes: task ID, files, description, relevant pseudocode
   - Wait for all agents to complete
   - Update task diagram: completed → "completed", failed → "failed"
3. If only sequential tasks remain:
   - Execute one at a time in topological order
   - Update diagram before/after each task

**RED FLAG - INLINE IMPLEMENTATION:**
If you find yourself using Edit/Write tools directly on source files instead of spawning Task agents, you are violating the subagent requirement. STOP and use Task tool instead.

**Task agent prompt template (Collab Workflow):**

```
You are implementing a task from the collab workflow.

## Design Document Location
Collab Session: .collab/<session-name>
Design Doc Path: .collab/<session-name>/documents/design.md

## REQUIRED: Read Design Doc First
Before implementing, read the design doc and find:
- Interface Definition section → function signatures, types
- Pseudocode section → step-by-step logic for your task

The design doc is the SOURCE OF TRUTH. Follow it exactly.

## Task Details
Task ID: <task-id>
Files: <task-files>
Description: <task-description>

## Your Task's Design Spec
Interface:
<paste-relevant-interface-section>

Pseudocode:
<paste-relevant-pseudocode-section>

## Instructions
1. Read the design doc sections above
2. Implement EXACTLY as specified - no interpretation
3. Write tests
4. Report what you implemented
```

### Task Prompt with Test Patterns

When dispatching tasks, include the `tests` field in the prompt:

```
## Targeted Tests

During TDD (RED-GREEN-REFACTOR), run ONLY these tests:
{task.tests}

Command: npm test -- {tests joined by space}

Do NOT run the full test suite during TDD cycles.
```

**Task Completion Handling:**
When a task completes:
1. Move task from `in_progress` to `completed`
2. Check what tasks are now unblocked (their `depends-on` all satisfied)
3. Add newly unblocked tasks to the ready queue
4. Repeat until all tasks done

### Wave Completion Checkpoint

After all tasks in a wave complete:

1. Run full test suite:
   ```bash
   npm test
   ```

2. If tests fail:
   ```
   Full test suite failed after wave completion.
   Investigate failures before proceeding to next wave.
   ```
   STOP and report.

3. If tests pass:
   ```
   Full test suite passed. Proceeding to next wave.
   ```

**Example Execution Flow:**
```
Wave 1: [auth-types, utils] (parallel: true) → dispatch together
  ↓ both complete
Wave 2: [auth-service] (depends-on: auth-types) → dispatch
  ↓ complete
Wave 3: [auth-middleware] (depends-on: auth-service) → dispatch
```

## Snapshot Saving

Save context snapshots to enable recovery after compaction events. This preserves the executing-plans skill's state and progress across context compaction.

### When to Save

Call `saveSnapshot()` at these critical points:
- After each wave of tasks completes
- After full test suite passes (post-wave verification)
- After each individual task completes (per-task verification)
- Before asking for user feedback
- At major milestones (all tasks complete)

### Save Function

```javascript
FUNCTION saveSnapshot():
  session = current session name
  state = READ collab-state.json

  snapshot = {
    version: 1,
    timestamp: now(),  // ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ
    activeSkill: "executing-plans",
    currentStep: "implementation",
    pendingQuestion: null,
    inProgressItem: null,
    completedTasks: [list of completed task IDs from collab-state.json],
    pendingTasks: [list of remaining pending task IDs],
    recentContext: [
      {
        type: "progress",
        content: "Completed tasks: {list}. Pending: {list}. Last wave: {wave number}"
      }
    ]
  }

  WRITE to .collab/{session}/context-snapshot.json

  // Update collab state to mark snapshot exists
  state.hasSnapshot = true
  state.lastSnapshot = timestamp
  WRITE state back to collab-state.json
```

### Save Points with Examples

**After wave completes with test suite passing:**
```
[Wave N tasks all complete]
→ Run full test suite: npm test
→ If tests FAIL: Stop, report failure (don't save)
→ If tests PASS:
   - saveSnapshot()
   - Update task diagram (all Wave N tasks → "completed")
   - Show wave completion report
   - Proceed to next wave
```

Example snapshot after Wave 1:
```json
{
  "version": 1,
  "timestamp": "2026-01-21T14:35:22Z",
  "activeSkill": "executing-plans",
  "currentStep": "implementation",
  "completedTasks": ["task-planning-skill", "gather-goals-types", "brainstorming-cleanup"],
  "pendingTasks": ["collab-routing", "executing-plans-tdd-skip", "pre-compact-script"],
  "recentContext": [
    {
      "type": "progress",
      "content": "Completed tasks: task-planning-skill, gather-goals-types, brainstorming-cleanup. Pending: 3 tasks. Last wave: 1"
    }
  ]
}
```

**After each task completes (per-task verification):**
```
[Task execution completes]
→ Compare implementation against design doc
→ Check for drift
→ If verification PASSES:
   - saveSnapshot() with updated completedTasks list
   - Unlock dependent tasks
   - Proceed to next ready task
→ If verification FAILS:
   - Keep task as in_progress
   - Request fixes before saving
```

**Before batch completion report:**
```
[All ready tasks complete, about to report to user]
→ saveSnapshot()
→ Show progress report with completed tasks
→ Show which tasks are ready next
→ Wait for user feedback
```

**At final completion:**
```
[All tasks complete and verified]
→ saveSnapshot()
→ Show implementation summary
→ Invoke finishing-a-development-branch skill
→ (After finishing-a-development-branch completes: cleanup collab session)
```

### Step 2.5: Per-Task Verification (Collab Workflow)

When within a collab workflow, run verification after each task completes:

**Verification Steps:**
1. After task completion, trigger `verify-phase` hook (if available)
2. Compare task output against design doc specification
3. Check for drift:
   - Are implemented interfaces matching design?
   - Any undocumented additions?
   - Missing components?

**On Verification Success:**
- Mark task as verified
- Update `collab-state.json`: move task from `pendingTasks` to `completedTasks`
- Update `lastActivity` timestamp
- Unlock dependent tasks
- Proceed to next ready tasks

**On Verification Failure:**
- Keep task as `in_progress` (not completed)
- Show drift report with pros/cons
- Ask user: accept drift, reject and fix, or review each
- If drift accepted: update design doc, then unlock dependents
- If drift rejected: fix implementation before proceeding

**Unlocking Dependents:**
```
for each task T where T.depends-on includes completed_task:
  if all(T.depends-on) are completed:
    move T from pending to ready
```

### Step 2.6: Drift Detection

After implementer reports completion, check for drift:

**Step 1: Read design doc and implementation**

1. Read design doc:
   Tool: mcp__mermaid__get_document
   Args: { "project": "<cwd>", "session": "<session>", "id": "design" }

2. Read implemented files (from task's file list)

**Step 2: Compare implementation to design**

FOR each function/type in the task's Interface section:
  Compare:
    - Function name matches?
    - Parameter names and types match?
    - Return type matches?
    - Logic follows Pseudocode steps?

  IF mismatch found:
    ADD to drift_list: {
      type: "signature" | "logic" | "scope" | "missing",
      design_says: <from design doc>,
      implementation_has: <from code>,
      file: <file path>,
      line: <line number if applicable>
    }

**Step 3: If drift detected, analyze and present**

IF drift_list is not empty:
  FOR each drift in drift_list:

    Analyze:
      severity = assess_severity(drift)  // contract vs detail
      intent = assess_intent(drift)      // improvement vs misunderstanding
      precedent = assess_precedent(drift) // will this encourage more drift?
      reversibility = assess_reversibility(drift)

    Generate pros:
      - [benefit of keeping this change]
      - [another benefit if applicable]

    Generate cons:
      - [drawback of keeping this change]
      - [another drawback if applicable]

    Determine recommendation:
      IF drift.type == "signature": recommend = "REJECT"
      ELSE IF drift.type == "logic" AND same_result: recommend = "ACCEPT"
      ELSE IF drift.type == "scope": recommend = "REJECT"
      ELSE IF drift.type == "missing": recommend = "REJECT"

    Present to user:
      ```
      DRIFT DETECTED in task [task-id]:

      ## What Changed
      | Type | Design Says | Implementation Has |
      |------|-------------|-------------------|
      | {drift.type} | {drift.design_says} | {drift.implementation_has} |

      ## Analysis

      **Pros of keeping this change:**
      - {pro1}
      - {pro2}

      **Cons of keeping this change:**
      - {con1}
      - {con2}

      **Suggested choice:** {recommend}
      **Reasoning:** {explanation based on severity, intent, precedent, reversibility}

      ## Your Decision
      1. Reject - revert and re-implement per design
      2. Accept - update design doc to include this change
      3. Discuss - need more context before deciding
      ```

**Step 4: Handle user decision**

IF user chooses "Reject":
  - Do NOT mark task as complete
  - Tell implementer to re-implement per design
  - Return to Step 2 (re-execute task)

IF user chooses "Accept":
  - Read current design doc
  - Update relevant section to match implementation
  - Write updated design doc via MCP
  - Log decision in Decision Log section
  - Mark task as complete
  - Proceed to next task

IF user chooses "Discuss":
  - Pause execution
  - Gather more context from user
  - Re-present options after discussion

**Step 5: No drift case**

IF drift_list is empty:
  - Mark task as complete
  - Proceed to next task

### Proposing Design Doc Changes

When drift is detected and requires a design doc update, use the proposed tag:

**For section-level changes:**
```markdown
<!-- status: proposed: <drift-description> -->
<new-section-content>
```

**For inline changes:**
```markdown
<!-- propose-start: <drift-description> --><new-text><!-- propose-end -->
```

**Process:**
1. Identify the unique text at the insertion point
2. Use patch to insert proposed content:
   ```
   Tool: mcp__mermaid__patch_document
   Args: {
     "project": "<cwd>",
     "session": "<session>",
     "id": "design",
     "old_string": "<unique text at insertion point>",
     "new_string": "<unique text><!-- propose-start: description --><content><!-- propose-end -->"
   }
   ```
3. If patch fails (not unique), fall back to full update:
   `mcp__mermaid__update_document({ "id": "design", "content": <updated> })`
4. Notify user: "Proposed change visible in design doc (cyan). Accept/reject in mermaid-collab UI."
5. Wait for user decision before proceeding

**After user decision:**
- If accepted: proposed marker removed, content remains → continue execution
- If rejected: content removed → address the drift differently or stop

### Step 3: Report
When batch complete:
- Show what was implemented
- Show verification output (including any drift decisions)
- Say: "Ready for feedback."

### Step 4: Continue
Based on feedback:
- Apply changes if needed
- Execute next batch
- Repeat until complete

### Step 5: Complete Development

After all tasks complete and verified, show summary and ask for confirmation:

```
Implementation complete:
- [N] tasks completed: [list task IDs]
- All tests passing
- All TODOs resolved

Ready to move to finishing-a-development-branch?

1. Yes
2. No
```

- If **1 (Yes)**: Invoke finishing-a-development-branch skill
- If **2 (No)**: Ask what needs to be addressed

**On confirmation:**
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice

### Step 5.1: Offer Collab Cleanup (Within Collab Workflow)

**REQUIRED** when executing within a collab session:

After development work completes (whether through finishing-a-development-branch or direct user commands like "commit and push"), always offer collab session cleanup:

```
Development complete.

Clean up collab session? This will archive or delete design artifacts.
Run /collab-cleanup?

1. Yes
2. No
```

- If **1 (Yes)**: Invoke collab-cleanup skill
- If **2 (No)**: "Session kept open. Run `/collab-cleanup` when ready."

**This step ensures users always get the option to clean up, regardless of how they chose to finish the work.**

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker mid-batch (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Between batches: just report and wait
- Stop when blocked, don't guess

## Integration with Collab Workflow

This skill can be invoked in two contexts:

### Standalone (Traditional)
- Called directly by user with a plan file
- No dependency graph
- Standard batch execution (3 tasks at a time)
- Uses `writing-plans` output format

### Within Collab Workflow
- Called by `rough-draft` skill after skeleton phase completes
- Receives task dependency graph from design doc
- Uses dependency-aware parallel execution
- Per-task verification via `verify-phase` hook
- On completion, triggers `collab-cleanup` hook

**Collab Workflow Chain:**
```
collab → brainstorming → rough-draft → executing-plans → finishing-a-development-branch
                                            ↑
                                     (you are here)
```

**When called from rough-draft:**
1. Design doc is already complete with task dependency graph
2. Skeleton files already exist with TODOs
3. Your job: implement TODOs respecting dependency order
4. Parallel dispatch independent tasks via `subagent-driven-development`
5. Verify each task against design before unlocking dependents
