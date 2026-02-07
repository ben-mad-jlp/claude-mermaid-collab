---
name: collab-todo
description: Vibe on a project todo - select a todo and enter freeform mode to create artifacts
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Collab Todo

Select a project todo and enter vibe mode to create artifacts for it.

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

## Step 2: List Todos

Get the project's todos:
```
Tool: mcp__plugin_mermaid-collab_mermaid__list_todos
Args: { "project": "<cwd>" }
```

**If no todos exist:** Tell the user:
```
No todos found for this project.

You can add todos through the collab UI (Todos section in the header),
or use the add_todo MCP tool directly.
```
**STOP**

**If todos exist:** Continue to Step 3.

## Step 3: Select a Todo

Present the todos to the user via render_ui with a RadioGroup:
```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<cwd>",
  "session": "_collab-todo",
  "ui": {
    "form": {
      "fields": [
        {
          "type": "RadioGroup",
          "name": "todoId",
          "label": "Select a todo to work on",
          "options": [
            { "value": "<id>", "label": "<title>" }
          ]
        }
      ],
      "submitLabel": "Start Vibing"
    }
  }
}
```

Wait for the user's selection:
```
Tool: mcp__plugin_mermaid-collab_mermaid__get_ui_response
Args: { "project": "<cwd>", "session": "_collab-todo" }
```

## Step 4: Enter Vibe Mode

Once the user selects a todo:

1. Get the selected todo's `sessionName` from the todos list
2. Get the session state:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__get_session_state
   Args: { "project": "<cwd>", "session": "<sessionName>" }
   ```
3. Tell the user which todo they selected and that they're entering vibe mode
4. Follow the **vibe-active** skill instructions - enter freeform mode where the user can create diagrams, documents, and wireframes for this todo's session
