---
name: collab-compact
description: Save context and trigger compaction for clean resume
disable-model-invocation: true
user-invocable: true
---

# Collab Compact

Save current collab session context and trigger compaction for a clean context resume.

## When to Use

- Context is getting large and compaction is approaching
- Before a long break in the session
- Proactively to ensure clean state

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
Tool: mcp__mermaid__get_session_state
Args: { "project": "<absolute-path-to-cwd>", "session": "<session-name>" }
```
Returns: `{ "phase": "...", "currentItem": ..., ... }`

Determine activeSkill from phase:
- "brainstorming" → activeSkill = "brainstorming"
- "rough-draft/*" → activeSkill = "rough-draft"
- "implementation" → activeSkill = "executing-plans"

Save snapshot via MCP:
```
Tool: mcp__mermaid__save_snapshot
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
Tool: mcp__mermaid__update_session_state
Args: { "project": "<absolute-path-to-cwd>", "session": "<session-name>", "hasSnapshot": true }
```

### Step 4: Trigger Compaction

```
Context snapshot saved to .collab/<session>/context-snapshot.json

Triggering compaction now...
```

Invoke the /compact command.

### Step 5: Resume Instructions

After compaction, the conversation resumes. Instruct user:

```
Compaction complete. Run /collab to resume your session.
The snapshot will restore your context automatically.
```
