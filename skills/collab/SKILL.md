---
name: collab
description: Start or resume a collab session - session management only
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Collab Sessions

Entry point for collab workflow. Handles session management and delegates to MCP state machine.

## Step 1: Check Server

```
Tool: mcp__plugin_mermaid-collab_mermaid__check_server_health
Args: {}
```

If not healthy: "Server not running. Start with: bun run bin/mermaid-collab.ts start"
**STOP** if server not running.

## Step 2: Find/Create Session

List sessions for this project:
```
Tool: mcp__plugin_mermaid-collab_mermaid__list_sessions
Args: {}
```

**If sessions exist:** Present list with "Create new" option
**If no sessions:** Go to Step 3

## Step 3: Create New Session

1. Generate name: `mcp__plugin_mermaid-collab_mermaid__generate_session_name()`
2. Ask user to confirm or pick own name
3. Ask session type: "What type of session?"
   - Options: "Structured (guided workflow)" or "Vibe (freeform)"
4. Initialize state with sessionType:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
   Args: { "project": "<cwd>", "session": "<name>", "phase": "initialize", "sessionType": "<structured|vibe>", "currentItem": null }
   ```
5. Route based on type:
   - If structured:
     ```
     Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
     Args: { "project": "<cwd>", "session": "<name>", "skill": "collab-start" }
     ```
     Invoke: result.next_skill
   - If vibe:
     ```
     Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
     Args: { "project": "<cwd>", "session": "<name>", "state": "vibe-active" }
     ```
     Display: "Vibe session active. Create diagrams, docs, or wireframes. Use /collab-cleanup when done."

## Step 4: Resume Existing Session

1. Get session state: `mcp__plugin_mermaid-collab_mermaid__get_session_state()`
2. Check sessionType:
   - If vibe: Display "Vibe session '<name>' resumed. Create diagrams, docs, or wireframes. Use /collab-cleanup when done." **STOP** (no further routing)
   - If structured or undefined: Continue to step 3
3. Call complete_skill with current state to get next skill:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
   Args: { "project": "<cwd>", "session": "<name>", "skill": "collab-resume" }
   ```
4. Invoke result.next_skill

## No Manual Routing

This skill does NOT:
- Route by item type (MCP state machine does this)
- Invoke brainstorming/rough-draft directly (complete_skill returns next skill)
- Manage the work item loop (routing nodes handle this)
