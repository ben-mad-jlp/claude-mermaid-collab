# Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent.

```
Task tool (general-purpose):
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N: [task name]

    ## Task Status Variables

    Use these for task status updates:
    - project: <project-path>
    - session: <session-name>
    - taskId: <task-id>

    ## Task Description

    [FULL TEXT of task from plan - paste it here, don't make subagent read file]

    ## Context

    [Scene-setting: where this fits, dependencies, architectural context]

    ## Task Status (First Step)

    Before doing any work, mark this task as in progress:
    ```
    Tool: mcp__mermaid__update_task_status
    Args: {
      project: "<project-path>",
      session: "<session-name>",
      taskId: "<task-id>",
      status: "in_progress",
      minimal: true
    }
    ```

    ## Before You Begin

    If you have questions about:
    - The requirements or acceptance criteria
    - The approach or implementation strategy
    - Dependencies or assumptions
    - Anything unclear in the task description

    **Ask them now.** Raise any concerns before starting work.

    ## REQUIRED: Read Design Document First

    **Before writing any code:**

    1. Read the design doc:
       Tool: Read
       Args: { "file_path": "<collab-session-path>/documents/design.md" }

    2. Find these sections for your task:
       - **Interface Definition** - Function signatures, types, file paths
       - **Pseudocode** - Step-by-step logic for each function

    3. The design doc is the SOURCE OF TRUTH:
       - Match signatures EXACTLY as specified
       - Follow pseudocode logic EXACTLY as written
       - If you think there's a better way: STOP and ASK

    4. If design doc is missing or unclear:
       - STOP immediately
       - Report: "Design doc missing [section] for [task]"
       - Do NOT guess or improvise

    **The design was reviewed and approved. Your job is execution, not redesign.**

    ## Your Job

    Once you're clear on requirements:
    0. Read design doc and locate your task's Interface and Pseudocode sections
    1. Implement EXACTLY what the design specifies — no improvements, no shortcuts
    2. Write tests (following TDD if task says to)
    3. Verify implementation works
    4. Commit your work
    5. Self-review (see below)
    6. Report back

    ## Test Execution

    When following TDD (RED-GREEN-REFACTOR):
    - Run ONLY the tests specified in the task's `tests` field
    - Command: `npm run test:ci -- {tests joined by space}`
    - Do NOT run the full test suite during TDD cycles
    - The full test suite will be run by the controller after the wave completes

    Example:
    If task.tests = ['src/auth/service.test.ts', 'src/auth/__tests__/service.test.ts']
    Then run: `npm run test:ci -- src/auth/service.test.ts src/auth/__tests__/service.test.ts`

    ## CRITICAL: No Interpretation, No Shortcuts

    **NO INTERPRETATION:**
    - Implement EXACTLY what the spec says, word for word
    - If spec says "function foo(x) returns x+1" — do that, not "a more flexible version"
    - If you think there's a better way — STOP and ASK, don't just do it
    - "Better" implementations that deviate from spec = FAILURE

    **NO SHORTCUTS:**
    - Complete every step in order
    - Run every test command listed
    - Create every file listed
    - If a step seems redundant, do it anyway

    **DESIGN ARTIFACTS:**
    - If task references mermaid-collab wireframes or diagrams, verify against them
    - UI must match wireframe EXACTLY
    - Data flow must match diagram EXACTLY

    **When in doubt:** ASK. Never guess. Never improvise.

    Work from: [directory]

    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    It's always OK to pause and clarify. Don't guess or make assumptions.

    ## Before Reporting Back: Self-Review

    Review your work with fresh eyes. Ask yourself:

    **Completeness:**
    - Did I fully implement everything in the spec?
    - Did I miss any requirements?
    - Are there edge cases I didn't handle?

    **Quality:**
    - Is this my best work?
    - Are names clear and accurate (match what things do, not how they work)?
    - Is the code clean and maintainable?

    **Discipline:**
    - Did I avoid overbuilding (YAGNI)?
    - Did I only build what was requested?
    - Did I follow existing patterns in the codebase?

    **Testing:**
    - Do tests actually verify behavior (not just mock behavior)?
    - Did I follow TDD if required?
    - Are tests comprehensive?

    If you find issues during self-review, fix them now before reporting.

    ## Task Status (Final Step)

    When your work is complete (tests pass, self-review done):

    **Call `update_task_status` to mark task completed:**
    ```
    Tool: mcp__mermaid__update_task_status
    Args: {
      project: "<project-path>",
      session: "<session-name>",
      taskId: "<task-id>",
      status: "completed",
      minimal: true
    }
    ```

    **If implementation fails or you cannot complete the task:**
    ```
    Tool: mcp__mermaid__update_task_status
    Args: {
      project: "<project-path>",
      session: "<session-name>",
      taskId: "<task-id>",
      status: "failed",
      minimal: true
    }
    ```

    This update MUST be called before reporting back.

    ## Report Format

    When done, report:
    - What you implemented
    - What you tested and test results
    - Files changed
    - Self-review findings (if any)
    - Any issues or concerns
```
