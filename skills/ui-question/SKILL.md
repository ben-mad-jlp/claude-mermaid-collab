---
name: ui-question
description: Ask user a question via browser UI and wait for response
user-invocable: false
allowed-tools: mcp__plugin_mermaid-collab_mermaid__render_ui, mcp__plugin_mermaid-collab_mermaid__get_ui_response, mcp__plugin_mermaid-collab_mermaid__list_sessions
---

# UI Question

Renders a question in the browser and polls for user response. This skill is intended to be invoked by other skills that need to ask questions via the browser UI.

## Input

The skill receives arguments in the format:
```
project: <project_path> | session: <session_name> | ui: <UI component JSON>
```

The `ui` parameter is the same object that would be passed to `render_ui`.

Example invocation:
```
Tool: Skill
Args: {
  "skill": "ui-question",
  "args": "project: /path/to/project | session: my-session | ui: {\"type\": \"MultipleChoice\", \"props\": {\"options\": [{\"value\": \"a\", \"label\": \"Option A\"}, {\"value\": \"b\", \"label\": \"Option B\"}], \"name\": \"choice\", \"label\": \"Which approach?\"}}"
}
```

If project and session are not provided, the skill will attempt to find the active collab session.

## Steps

1. **Parse arguments** to extract project, session, and UI component.

2. **Find active session** (if not provided):
   - Call `mcp__plugin_mermaid-collab_mermaid__list_sessions` to find active sessions
   - Use the most recently active session

3. **Render UI** (non-blocking):
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
   Args: {
     "project": "<project>",
     "session": "<session>",
     "ui": <parsed UI object>,
     "blocking": false
   }
   ```
   Save the returned `uiId`.

4. **Poll for response** in a loop:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__get_ui_response
   Args: {
     "project": "<project>",
     "session": "<session>",
     "uiId": "<uiId>"
   }
   ```

   - If status is `pending`: poll again (the server adds a delay)
   - If status is `responded`: extract action and data, proceed to output
   - If status is `stale` or `not_found`: report error

5. **Output the response** in a structured format that the calling skill can parse:
   ```
   UI_RESPONSE:
   action: <action>
   data: <JSON data>
   ```

## Completion

This skill completes after outputting the user's response. The calling context will have access to this response.

## Error Handling

- If no active session found: Output error asking caller to provide project/session
- If render_ui fails: Output error message
- If UI becomes stale: Output that UI was replaced (another render_ui call occurred)
- If not_found: Output that the UI ID is invalid

## Usage by Other Skills

Skills that want to use browser UI for questions should:

1. Invoke this skill with the question details:
   ```
   Tool: Skill
   Args: {
     "skill": "ui-question",
     "args": "project: /path | session: name | ui: {\"type\": \"MultipleChoice\", ...}"
   }
   ```

2. After the skill completes, look for `UI_RESPONSE:` in the context to find:
   - `action`: The button/action the user clicked
   - `data`: Form data collected from the UI

3. Continue with the task using the response.
