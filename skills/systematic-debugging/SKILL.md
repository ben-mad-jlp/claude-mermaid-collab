---
name: systematic-debugging
description: Investigate bugfix items to identify root cause and document findings
user-invocable: false
model: sonnet
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Task, Read, Glob, Grep
---

# Systematic Debugging (Investigation)

Investigate bugfix items to identify the root cause and document findings for the execution phase.

## Core Principle

**Investigation only.** This skill identifies the root cause, affected files, and suggests a test strategy. The actual fix happens during execution (rough-draft-blueprint + executing-plans).

## Overview

When a work item has `Type: bugfix`, this skill:
1. Reads the bug report from the design doc
2. Reproduces the issue mentally by tracing the code path
3. Identifies the root cause and affected files
4. Documents findings in the design doc
5. Suggests a test strategy (but does NOT write tests)
6. Calls complete_skill to proceed

## Step 1: Get Current Item Context

Read the design doc to get the current bugfix item:

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_document
Args: { "project": "<cwd>", "session": "<session>", "id": "design" }
```

Find the work item marked as current (from session state's `currentItem`).

## Step 2: Reproduce Mentally

Trace the code path to understand the bug:

1. **Read the affected code** - Use Read, Glob, Grep to find and read the relevant source files
2. **Trace the execution flow** - Follow the code path from input to buggy output
3. **Identify where behavior diverges** - Find the exact point where expected != actual
4. **Check for related patterns** - Search for similar patterns elsewhere that may also be affected

## Step 3: Identify Root Cause

Determine the underlying cause:

1. **What** is the incorrect behavior?
2. **Where** in the code does it occur? (file, function, line)
3. **Why** does it happen? (logic error, missing check, race condition, etc.)
4. **What files** need to change to fix it?

## Step 4: Document Findings

Update the design doc with investigation results:

```
Tool: mcp__plugin_mermaid-collab_mermaid__patch_document
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "id": "design",
  "old_string": "**Status:** pending",
  "new_string": "**Status:** investigated\n\n**Root Cause:**\n<description of the root cause>\n\n**Affected Files:**\n- <file1> - <what needs to change>\n- <file2> - <what needs to change>\n\n**Proposed Approach:**\n<brief description of the fix approach>\n\n**Suggested Test Strategy:**\n- Test: <describe a test that would reproduce the bug>\n- Verify: <what the test should assert>\n- Regression: <any related areas to test>"
}
```

## Step 5: Record Lessons (Optional)

If debugging revealed insights worth preserving, record them:

```
Tool: mcp__plugin_mermaid-collab_mermaid__add_lesson
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "lesson": "<insight>",
  "category": "gotcha"  // or codebase/workflow/universal
}
```

**Good lesson candidates:**
- Bug patterns that could recur (e.g., "Race condition in X when Y happens")
- Unexpected component behaviors discovered during investigation
- Diagnostic approaches that worked well for this type of bug
- Root causes that weren't obvious from the symptoms

**Category guidance:**
| Category | When to use |
|----------|-------------|
| gotcha | Tricky situations, non-obvious failure modes |
| codebase | Project-specific behaviors, undocumented assumptions |
| workflow | Better debugging approaches for this project |
| universal | Broadly applicable debugging insights |

## Step 6: Complete Skill

```
Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
Args: { "project": "<cwd>", "session": "<session>", "skill": "systematic-debugging" }
```

**Handle response:**
- If `action == "clear"`: Invoke skill: collab-clear
- If `next_skill` is not null: Invoke that skill
- If `next_skill` is null: Workflow complete

## What Happens Next

After investigation, the bugfix item is marked as `brainstormed` and follows the standard pipeline:
1. **rough-draft-blueprint** creates a simplified blueprint with a single task: write failing test + fix
2. **executing-plans** executes the fix using the test-first approach with the investigation findings
