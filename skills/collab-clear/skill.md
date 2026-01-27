---
name: collab-clear
description: Save context and trigger clear for clean resume
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read
user-invocable: true
---

# Collab Clear

Save current collab session context and trigger clear for a fresh context resume.

## When to Use

- Context is full and you want to start fresh
- When compact isn't reducing context enough
- Before a long break in the session
- When you prefer a clean slate over summarized context

## Process

### Step 1: Verify Active Session

```bash
ls -d .collab/*/ 2>/dev/null | xargs -I{} basename {}
```

If no sessions: "No active collab session. Use /collab first." STOP.
If multiple sessions: Ask user which session.

### Step 2: Save Context Snapshot

Read current state via MCP:
```
Tool: mcp__plugin_mermaid-collab_mermaid__get_session_state
Args: { "project": "<absolute-path-to-cwd>", "session": "<session-name>" }
```
Returns: `{ "phase": "...", "currentItem": ..., ... }`

Determine activeSkill from phase:
- "brainstorming" → activeSkill = "brainstorming"
- "rough-draft/*" → activeSkill = "rough-draft"
- "implementation" → activeSkill = "executing-plans"

Save snapshot via MCP:
```
Tool: mcp__plugin_mermaid-collab_mermaid__save_snapshot
Args: {
  "project": "<absolute-path-to-cwd>",
  "session": "<session-name>",
  "activeSkill": "<determined-skill>",
  "currentStep": "<phase-from-state>",
  "inProgressItem": <currentItem-from-state>,
  "pendingQuestion": null,
  "recentContext": []
}
```
Note: `version` and `timestamp` are automatically added by the MCP tool.

### Step 3: Update State

Update collab state via MCP:
```
Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
Args: { "project": "<absolute-path-to-cwd>", "session": "<session-name>", "hasSnapshot": true }
```

### Step 4: Trigger Clear

```
Context snapshot saved to .collab/<session>/context-snapshot.json

Triggering clear now...
```

Invoke the /clear command.

### Step 5: Auto-Resume Session

After clear, automatically resume the session:

```
Clear complete. Resuming session...
```

Invoke skill: collab

This will restore context from the snapshot and continue where you left off.

## Context Full Detection

When context usage is high before triggering clear, render an Alert to notify the user:

**Tool call:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<absolute-path-to-cwd>",
  "session": "<session-name>",
  "ui": {
    "type": "Alert",
    "props": {
      "type": "warning",
      "title": "Context Full",
      "message": "Run /clear in terminal, then /collab to resume."
    }
  },
  "blocking": false
}
```

This provides a non-blocking visual notification without interrupting the skill execution.
