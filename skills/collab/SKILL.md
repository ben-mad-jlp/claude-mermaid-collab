---
name: collab
description: Start or resume a collab session - session management only
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Collab Sessions

Entry point for collab workflow. Handles session management and delegates to MCP state machine.

## Step 1: Check Server Health

Check if the collaboration server is running:
```
Tool: mcp__plugin_mermaid-collab_mermaid__check_server_health
Args: {}
```

**If healthy:** Continue to Step 2.

**If NOT healthy or MCP tools unavailable:** Tell the user:

```
The collaboration server is not running. Please start it in a terminal:

cd ~/.claude/plugins/cache/mermaid-collab-dev/mermaid-collab/*/
bun run bin/mermaid-collab.ts start

Then restart Claude Code and run /collab again.
```

**STOP** - Do not proceed without a healthy server.

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
5. Route via state machine (same for both types):
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
   Args: { "project": "<cwd>", "session": "<name>", "skill": "collab-start" }
   ```
   Invoke: result.next_skill (will be "gather-session-goals" for structured, "vibe-active" for vibe)

## Step 4: Resume Existing Session

1. Get session state: `mcp__plugin_mermaid-collab_mermaid__get_session_state()`
2. Route based on sessionType, nextSkill, and state:
   - If sessionType is "vibe" or state is "vibe-active": Invoke skill "vibe-active"
   - If `nextSkill` field exists and is not null: Invoke that skill directly (this is set after context clears)
   - Otherwise: Get the current skill from the state and invoke it directly
     - The state field maps to a skill (e.g., "brainstorm-exploring" → "brainstorming-exploring")
     - Invoke that skill to continue the workflow

## No Manual Routing

This skill does NOT:
- Route by item type (MCP state machine does this)
- Invoke brainstorming/rough-draft directly (complete_skill returns next skill)
- Manage the work item loop (routing nodes handle this)
