---
name: ui-question
description: Ask user a question via browser UI and wait for response
user-invocable: false
model: haiku
allowed-tools: mcp__plugin_mermaid-collab_mermaid__render_ui, mcp__plugin_mermaid-collab_mermaid__get_ui_response, mcp__plugin_mermaid-collab_mermaid__list_sessions, mcp__plugin_mermaid-collab_mermaid__get_session_state, AskUserQuestion
---

# UI Question

Renders a question in the browser and polls for user response. This skill is intended to be invoked by other skills that need to ask questions via the browser UI.

**Important:** This skill checks the session's `useRenderUI` setting. If `false`, questions are asked via console (`AskUserQuestion`) instead of browser UI.

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

3. **Check useRenderUI setting**:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__get_session_state
   Args: {
     "project": "<project>",
     "session": "<session>"
   }
   ```
   Check the `useRenderUI` field in the response.

4. **If useRenderUI is false** → Use console fallback (skip to Console Fallback section)

5. **If useRenderUI is true or missing** → Use browser UI:

   a. **Render UI** (non-blocking):
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

   b. **Poll for response** in a loop:
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

6. **Output the response** in a structured format that the calling skill can parse:
   ```
   UI_RESPONSE:
   action: <action>
   data: <JSON data>
   ```

## Console Fallback (when useRenderUI is false)

When browser UI is disabled, convert UI components to `AskUserQuestion` format:

### MultipleChoice → AskUserQuestion
```
UI: {
  "type": "MultipleChoice",
  "props": {
    "options": [
      {"value": "a", "label": "Option A", "description": "First option"},
      {"value": "b", "label": "Option B", "description": "Second option"}
    ],
    "name": "choice",
    "label": "Which approach?"
  }
}

AskUserQuestion: {
  "questions": [{
    "question": "Which approach?",
    "header": "Choice",
    "options": [
      {"label": "Option A", "description": "First option"},
      {"label": "Option B", "description": "Second option"}
    ],
    "multiSelect": false
  }]
}
```

The response mapping:
- User selects "Option A" → `UI_RESPONSE: action: submit, data: {"choice": "a"}`

### TextInput → Direct prompt
For TextInput components, use AskUserQuestion with a single option for "Submit":
```
UI: {
  "type": "TextInput",
  "props": {
    "name": "reason",
    "label": "Enter your reason"
  }
}
```
Since AskUserQuestion doesn't support free-text, inform the user the question is displayed and prompt them to respond. The "Other" option in AskUserQuestion allows free text.

### Confirmation → Yes/No question
```
UI: {
  "type": "Confirmation",
  "props": {
    "message": "Are you sure you want to proceed?"
  }
}

AskUserQuestion: {
  "questions": [{
    "question": "Are you sure you want to proceed?",
    "header": "Confirm",
    "options": [
      {"label": "Yes", "description": "Proceed with the action"},
      {"label": "No", "description": "Cancel"}
    ],
    "multiSelect": false
  }]
}
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
