---
name: rough-draft-confirm
description: Ask user about auto-allow for rough-draft proposals before starting rough-draft phase
user-invocable: false
model: haiku
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*
---

# Rough-Draft Confirm Skill

## Overview

The **rough-draft-confirm** skill is invoked after all brainstorming is complete, before the rough-draft phase begins. It shows a summary of brainstormed code items and asks the user about their preference for auto-allowing proposals during rough-draft.

This is a quick transition skill - it gathers one preference then moves on.

## When Invoked

This skill is invoked by the workflow state machine when:
1. All items have completed brainstorming (no pending items left)
2. There are code items with status === 'brainstormed' ready for rough-draft
3. The workflow transitions from `brainstorm-item-router` to `rough-draft-confirm`

## Step 1: Get Session State

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_session_state
Args: { "project": "<cwd>", "session": "<session>" }
```

Extract:
- `workItems` array
- Filter for items with `type === 'code'` and `status === 'brainstormed'`

## Step 2: Show Summary and Ask Preference

Display the brainstormed code items and ask about auto-allow:

```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "ui": {
    "type": "Card",
    "props": { "title": "Ready for Rough-Draft Phase" },
    "children": [
      {
        "type": "Markdown",
        "props": {
          "content": "Brainstorming complete! The following code items are ready for rough-draft:\n\n- Item 1: <title>\n- Item 2: <title>\n\nDuring rough-draft, Claude will propose interface definitions, pseudocode, and file skeletons."
        }
      },
      {
        "type": "RadioGroup",
        "props": {
          "name": "autoAllow",
          "label": "How would you like to handle proposals?",
          "options": [
            { "value": "auto", "label": "Auto-allow all proposals (faster)" },
            { "value": "review", "label": "Review each proposal before proceeding" }
          ]
        }
      }
    ],
    "actions": [
      { "id": "continue", "label": "Continue", "primary": true }
    ]
  },
  "blocking": true
}
```

## Step 3: Save Preference

Based on user's choice, update session state:

```
Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "autoAllowRoughDraft": <true if "auto", false if "review">
}
```

## Step 4: Complete Skill

```
Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
Args: { "project": "<cwd>", "session": "<session>", "skill": "rough-draft-confirm" }
```

**Handle response:**
- If `action == "clear"`: Invoke skill: collab-clear
- If `next_skill` is not null: Invoke that skill
- If `next_skill` is null: Workflow complete

## Edge Cases

### No Code Items Ready

If there are no code items with status === 'brainstormed' (e.g., all items were tasks or bugfixes):

```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "ui": {
    "type": "Card",
    "props": { "title": "Brainstorming Complete" },
    "children": [{
      "type": "Markdown",
      "props": {
        "content": "All items have been processed. No code items require rough-draft phase.\n\nProceeding to implementation..."
      }
    }],
    "actions": [{ "id": "continue", "label": "Continue", "primary": true }]
  },
  "blocking": true
}
```

Then complete the skill (workflow will route to ready-to-implement).

## Notes

- This skill is designed to be quick and lightweight
- The autoAllowRoughDraft preference can be checked by rough-draft skills
- If preference is not set, rough-draft skills should default to review mode
