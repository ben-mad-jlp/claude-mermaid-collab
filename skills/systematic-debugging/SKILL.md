---
name: systematic-debugging
description: Investigate bugfix items using test-first debugging methodology
user-invocable: false
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Task, Read, Write, Edit, Bash, Glob, Grep
---

# Systematic Debugging (Test-First)

Fix bugs by writing a failing test first, then having subagents race to fix it.

## Core Principle

**Don't start by trying to fix the bug. Start by writing a test that reproduces it.**

A passing test is the only proof that a fix works. Subagents compete to make the test pass.

## Overview

When a work item has `Type: bugfix`, this skill:
1. Reads the bug report from the design doc
2. Writes a failing test that reproduces the bug
3. Verifies the test fails for the right reason
4. Spawns parallel subagents to attempt fixes
5. First subagent to make the test pass wins
6. Updates the design doc with the fix
7. Calls complete_skill to proceed

## Step 1: Get Current Item Context

Read the design doc to get the current bugfix item:

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_document
Args: { "project": "<cwd>", "session": "<session>", "id": "design" }
```

Find the work item marked as current (from session state's `currentItem`).

## Step 2: Write a Failing Test

Before any fix attempts, write a test that reproduces the bug.

**Requirements:**
- Test must fail with the current code
- Test must fail for the right reason (bug behavior, not syntax error)
- Test must be minimal - isolate the bug
- Test name should describe the expected behavior: `test('rejects empty email', ...)`

**Process:**
1. Analyze the bug report to understand expected vs actual behavior
2. Find the appropriate test file (or create one)
3. Write a test that asserts the expected behavior
4. Run the test to confirm it fails

```bash
npm run test:ci -- path/to/test.test.ts
```

**Escape hatch:** If after 3 attempts you cannot write a reproducing test (timing issues, environment-specific, etc.), document why and fall back to manual investigation. Ask the user for guidance.

## Step 3: Verify Test Fails Correctly

**MANDATORY. Never skip.**

The test must:
- Fail (not error)
- Fail because of the bug (not typos or missing imports)
- Show the actual buggy behavior in the failure message

If the test passes immediately, you're not testing the bug. Rewrite.

If the test errors, fix the error and re-run until it fails correctly.

## Step 4: Spawn Fix Subagents

Once you have a verified failing test, spawn 2-3 subagents in parallel to attempt fixes:

```
Tool: Task (call multiple in parallel)
Args: {
  "subagent_type": "mermaid-collab:systematic-debugging:systematic-debugging",
  "description": "Fix bug: <item-title> - Approach A",
  "prompt": "Bug: <description>

Failing test location: <path/to/test.ts>
Test name: <test name>

Your goal: Make this test pass with minimal code changes.

Constraints:
- Do NOT modify the test
- Keep changes minimal and focused
- Run the test after your fix to verify it passes
- If you can't fix it, explain why

Run this command to verify:
npm run test:ci -- <path/to/test.ts>"
}
```

**Subagent approaches to try:**
- Approach A: Most obvious/direct fix
- Approach B: Alternative approach if A seems risky
- Approach C: (Optional) Different angle if bug is complex

## Step 5: Evaluate Results

Wait for subagents to complete. Evaluate:

| Result | Action |
|--------|--------|
| One subagent passes test | Use that fix |
| Multiple pass | Choose simplest/cleanest |
| None pass | Analyze attempts, write better test or try new approaches |
| Test was wrong | Fix test, re-run subagents |

**Validation:** After selecting a fix, run the full test suite to ensure no regressions:

```bash
npm run test:ci
```

## Step 6: Update Design Doc

Record the fix in the design doc:

```
Tool: mcp__plugin_mermaid-collab_mermaid__patch_document
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "id": "design",
  "old_string": "**Status:** pending",
  "new_string": "**Status:** fixed\n\n**Reproducing Test:**\n`<test file>`: `<test name>`\n\n**Fix:**\n<brief description of the fix>\n\n**Files Changed:**\n- <file1>\n- <file2>"
}
```

## Step 7: Update Session State

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_session_state
Args: { "project": "<cwd>", "session": "<session>" }
```

```
Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "workItems": [<updated array with item status changed to "fixed">]
}
```

## Step 8: Record Lessons (Optional)

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

## Step 9: Complete Skill

```
Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
Args: { "project": "<cwd>", "session": "<session>", "skill": "systematic-debugging" }
```

**Handle response:**
- If `action == "clear"`: Invoke skill: collab-clear
- If `next_skill` is not null: Invoke that skill
- If `next_skill` is null: Workflow complete

## Why Test-First?

| Old Approach | Test-First Approach |
|--------------|---------------------|
| Investigate → Document → Fix later | Test → Fix → Done |
| "I think I understand the bug" | Test proves you understand it |
| "I think the fix works" | Test proves the fix works |
| Root cause documented, fix uncertain | Fix verified, regression prevented |
| Sequential: investigate then implement | Parallel: subagents race to fix |

The test *is* the investigation. If you can reproduce it, you understand it.
