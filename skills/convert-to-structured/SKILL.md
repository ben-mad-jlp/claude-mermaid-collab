---
name: convert-to-structured
description: Convert a vibe session to structured mode, preserving existing artifacts
user-invocable: false
model: opus
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep
---

# Convert to Structured

Convert an active vibe session to a structured workflow session. Preserves all existing artifacts (diagrams, documents, wireframes) while collecting work items and transitioning to the brainstorm phase.

## Overview

**Invoked by:** vibe-active skill when user requests structured workflow

**Result:** Session converts to structured mode, `complete_skill('vibe-active')` triggers routing to brainstorm phase via `pending_brainstorm_items` condition.

## The Process

### Step 1: List Existing Artifacts

Gather all artifacts created during the vibe session:

```
Tool: mcp__plugin_mermaid-collab_mermaid__list_diagrams
Args: { "project": "<cwd>", "session": "<session>" }
```

```
Tool: mcp__plugin_mermaid-collab_mermaid__list_documents
Args: { "project": "<cwd>", "session": "<session>" }
```

```
Tool: mcp__plugin_mermaid-collab_mermaid__list_wireframes
Args: { "project": "<cwd>", "session": "<session>" }
```

Display to user:

```
Converting to structured session.

Existing artifacts from this session:
- Diagrams: [list or "none"]
- Documents: [list or "none"]
- Wireframes: [list or "none"]

These will be preserved and available during the structured workflow.
```

### Step 2: Collect Work Items

Follow the same pattern as gather-session-goals:

1. Ask: **"What do you want to accomplish? (You can reference the existing artifacts above.)"**

2. Parse items and infer types from context:
   - Contains "setup", "install", "configure", "organize", "clean up", "docker", "deploy" -> type = "task"
   - Contains "fix", "bug", "broken", "error", "crash", "fail" -> type = "bugfix"
   - Contains "add", "new", "create", "implement", "build", "refactor", "clean", "simplify", "restructure", "investigate", "explore", "spike" -> type = "code"
   - Otherwise -> type = "unknown"

3. Ask: **"Anything else?"**
   - If yes: parse new items, repeat
   - If no/done: proceed

### Step 3: Classify Unknown Items

For each item with type = "unknown":

Ask: **"What type is '[item title]'?"**
```
1. code
2. bugfix
3. task
```

### Step 4: Present Summary

```
Here are the work items for this session:

1. [type] Item title
2. [type] Item title
...

Does this list look correct?

1. Yes
2. Add more
3. Remove item
4. Edit item
```

Handle responses:
- **1 (Yes)** - Proceed to Step 5
- **2 (Add more)** - Return to Step 2
- **3 (Remove)** - Ask which, remove, return to Step 4
- **4 (Edit)** - Ask which, update, return to Step 4

### Step 5: Create/Update Design Doc

Build a design doc that references existing artifacts:

```markdown
# Session: <session-name>

## Session Context
**Converted from:** Vibe session
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Existing Artifacts

(Created during vibe phase - preserved for reference)

[list each artifact with name and type]

---

## Work Items

### Item 1: <title>
**Type:** <type>
**Status:** pending

**Problem/Goal:**

**Approach:**

**Root Cause:** (only if type is bugfix)

**Success Criteria:**

**Decisions:**

---

### Item 2: <title>
...

---

## Diagrams
(auto-synced)
```

Create or update the design doc:
```
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: { "project": "<cwd>", "session": "<session>", "name": "design", "content": "<full-content>" }
```

If document already exists, use `update_document` instead.

### Step 6: Update Session State

Single call to update everything:

```
Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "sessionType": "structured",
  "workItems": [
    { "number": 1, "title": "<title>", "type": "<code|bugfix|task>", "status": "pending" },
    { "number": 2, "title": "<title>", "type": "<code|bugfix|task>", "status": "pending" },
    ...
  ],
  "currentItem": 1,
  "currentItemType": "<type of first item>"
}
```

### Step 7: Complete Skill

```
Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
Args: { "project": "<cwd>", "session": "<session>", "skill": "vibe-active" }
```

Since all workItems have `status: 'pending'`, the `pending_brainstorm_items` condition is true, routing to `clear-pre-item` -> `brainstorm-item-router` -> structured brainstorm flow.

**Handle response:**
- If `action == "clear"`: Invoke skill: collab-clear
- If `next_skill` is not null: Invoke that skill
- If `next_skill` is null: Workflow complete

Display:

```
Session converted to structured mode. Starting brainstorm phase with your first work item.
```

## Key Constraints

- **One question at a time** - Never batch multiple questions
- **Don't skip classification** - Every item must have a type
- **Must get explicit confirmation** - User must approve the list
- **Preserve all artifacts** - Never delete or modify existing vibe artifacts

## Browser-Based Questions

When a collab session is active, prefer `render_ui` for user interactions.

**For item type classification:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<absolute-path-to-cwd>",
  "session": "<session-name>",
  "ui": {
    "type": "Card",
    "props": { "title": "Classify item" },
    "children": [
      { "type": "Markdown", "props": { "content": "What type is **[item title]**?" } },
      {
        "type": "RadioGroup",
        "props": {
          "name": "type",
          "options": [
            { "value": "code", "label": "Code (feature, refactor, investigation)" },
            { "value": "bugfix", "label": "Bugfix (fix, error, crash)" },
            { "value": "task", "label": "Task (setup, config, organization)" }
          ]
        }
      }
    ],
    "actions": [{ "id": "classify", "label": "Continue", "primary": true }]
  },
  "blocking": true
}
```

**For work items list confirmation:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<absolute-path-to-cwd>",
  "session": "<session-name>",
  "ui": {
    "type": "Card",
    "props": { "title": "Confirm work items" },
    "children": [
      { "type": "Markdown", "props": { "content": "[markdown list of items]" } },
      {
        "type": "RadioGroup",
        "props": {
          "name": "action",
          "options": [
            { "value": "yes", "label": "Yes, this is correct" },
            { "value": "add", "label": "Add more items" },
            { "value": "remove", "label": "Remove an item" },
            { "value": "edit", "label": "Edit an item" }
          ]
        }
      }
    ],
    "actions": [{ "id": "confirm", "label": "Continue", "primary": true }]
  },
  "blocking": true
}
```

## Contract

**Preconditions:**
- Active vibe session exists
- Session is in `vibe-active` state

**Postconditions:**
- Session state `sessionType` set to `'structured'`
- Session state contains `workItems` array with all items `status: 'pending'`
- Session state contains `currentItem` and `currentItemType` for first item
- Design doc created/updated with work items and existing artifacts
- `complete_skill('vibe-active')` called to trigger state machine routing
- All existing artifacts preserved

**Side effects:**
- Updates session state (sessionType, workItems, currentItem, currentItemType)
- Creates/updates design doc
