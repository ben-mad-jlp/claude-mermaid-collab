---
name: systematic-debugging
description: Investigate bugfix items using systematic debugging methodology
user-invocable: false
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Task, Read
---

# Systematic Debugging (Skill Wrapper)

This skill wraps the systematic-debugging agent for use within the collab workflow. It handles bugfix-type work items.

## Overview

When a work item has `Type: bugfix`, the MCP state machine routes to this skill. This skill:
1. Reads the work item details from the design doc
2. Spawns the systematic-debugging agent to investigate
3. Updates the design doc with the diagnostic report
4. Calls complete_skill to proceed

**Important:** This skill does NOT implement fixes. It only investigates and documents root cause. Fixes happen later via rough-draft → executing-plans.

## Step 1: Get Current Item Context

Read the design doc to get the current bugfix item:

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_document
Args: { "project": "<cwd>", "session": "<session>", "id": "design" }
```

Find the work item marked as current (from session state's `currentItem`).

## Step 2: Spawn Debugging Agent

Use the Task tool to invoke the systematic-debugging agent:

```
Tool: Task
Args: {
  "subagent_type": "mermaid-collab:systematic-debugging:systematic-debugging",
  "description": "Investigate bugfix: <item-title>",
  "prompt": "<context about the bug from design doc>"
}
```

The agent will:
- Investigate the root cause
- Document findings
- NOT implement any fixes

## Step 3: Mark Item as Documented

### 3a. Update session state workItems

Read current state and update the item's status:

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_session_state
Args: { "project": "<cwd>", "session": "<session>" }
```

Update the item's status in workItems array:

```
Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "workItems": [<updated array with item status changed to "documented">]
}
```

### 3b. Update design doc

Take the agent's diagnostic report and add it to the work item in the design doc:

```
Tool: mcp__plugin_mermaid-collab_mermaid__patch_document
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "id": "design",
  "old_string": "**Status:** pending",
  "new_string": "**Status:** documented\n\n**Root Cause Analysis:**\n<agent's findings>\n\n**Proposed Fix:**\n<agent's recommendation>"
}
```

## Step 4: Complete Skill

Call complete_skill to get the next workflow state:

```
Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
Args: { "project": "<cwd>", "session": "<session>", "skill": "systematic-debugging" }
```

**Handle response:**
- If `action == "clear"`: Invoke skill: collab-clear
- If `next_skill` is not null: Invoke that skill
- If `next_skill` is null: Workflow complete
