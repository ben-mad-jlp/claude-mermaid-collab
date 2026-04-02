---
name: collab
description: Start or resume a collab session - session management only
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash, Agent
---

# Collab Sessions

Entry point for collab workflow. Handles session management and routes to vibe-active.

## Step 1: Check Server Health

Check if the collaboration server is running:
```
Tool: mcp__plugin_mermaid-collab_mermaid__check_server_health
Args: {}
```

**If `healthy: true`:** Continue to Step 2.

**If `healthy: false` but `services.api.running: true` (UI not active):** Warn the user:
```
The collab UI is not active (run `bun run dev` or `bun run start` to enable it).
Continuing anyway — MCP tools will work but the browser UI won't be available.
```
Then continue to Step 2.

**If MCP tools unavailable or API not reachable:** Tell the user:
```
The collaboration server is not running. Please start it in a terminal:

cd ~/.claude/plugins/cache/mermaid-collab-dev/mermaid-collab/*/
bun run bin/mermaid-collab.ts start

Then restart Claude Code and run /collab again.
```
**STOP** - Do not proceed without a running API server.

## Step 2: Find/Create Session

**If the skill was invoked with a session name argument** (e.g. `/collab my-session-name`):
- Skip the list — go directly to Step 4 using that session name.

Otherwise:

1. List all sessions:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__list_sessions
   Args: {}
   ```

2. **Filter results to current project** (match `project` field against absolute cwd path)

3. **If sessions exist for current project:** ALWAYS present the full list with a "Create new session" option — never auto-select, even if there is only one session. Let the user choose.
4. **If no sessions for current project:** Go to Step 3

## Step 3: Create New Session

1. Generate name: `mcp__plugin_mermaid-collab_mermaid__generate_session_name()`
2. Ask user to confirm or pick own name
3. Create the session by creating an initial document:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__create_document
   Args: { "project": "<cwd>", "session": "<name>", "name": "vibe.vibeinstructions", "content": "# Vibe: <name>\n\n## Goal\n[Not yet defined]\n\n## Context\n[No context recorded]\n\n## Currently Doing\n[Nothing recorded yet]" }
   ```
4. Invoke skill: `vibe-active`

## Step 4: Resume Existing Session

Invoke skill: `vibe-active`

The vibe-active skill handles reading the vibeinstructions document and resuming from where the user left off.
