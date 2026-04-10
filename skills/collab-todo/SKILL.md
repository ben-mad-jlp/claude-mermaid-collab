---
name: collab-todo
description: Pick a session to vibe on — lists available sessions in the current project
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Collab Todo

Select a session and enter freeform vibe mode on it.

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

Then restart Claude Code and run /collab-todo again.
```

**STOP** - Do not proceed without a healthy server.

## Step 2: List Sessions for This Project

Get all sessions and filter to the current project:
```
Tool: mcp__plugin_mermaid-collab_mermaid__list_sessions
Args: {}
```

Filter the returned sessions to only those whose `project` field equals the absolute path of the current working directory (cwd). Use the exact absolute cwd string for comparison.

**If zero sessions match the current project:** Tell the user:
```
No sessions in this project yet. Run /collab to create one.
```
**STOP**

**If one or more sessions match:** Continue to Step 3.

## Step 3: Present Sessions and Wait for Pick

Present the filtered sessions as a numbered list to the user directly in the chat:

```
1. <session name> — <short description or summary, if available>
2. <session name> — <short description or summary, if available>
3. <session name> — <short description or summary, if available>
```

Ask the user:
```
Which session do you want to vibe on? Reply with the number or name.
```

**Wait for the user's response.** Do not proceed until the user picks a session.

Match the user's reply against the numbered list (by index or by session name) to determine the selected session.

## Step 4: Register and Enter Vibe Mode

Once the user has picked a session:

1. Register the current Claude session for notifications on the picked session:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__register_claude_session
   Args: { "project": "<cwd>", "session": "<picked session name>" }
   ```

2. Tell the user which session they selected and that they're entering vibe mode.

3. Follow the **vibe-active** skill instructions — enter freeform mode where the user can create diagrams, documents, and designs on this session.
