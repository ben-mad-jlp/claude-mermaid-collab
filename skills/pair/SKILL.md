---
name: pair
description: Propose a code edit via the MonacoDiffEditor and wait for the user to accept or reject it in the browser
user-invocable: true
allowed-tools: mcp__mermaid__list_code_files, mcp__mermaid__propose_code_edit, mcp__mermaid__wait_for_edit_decision
---

# Pair Mode — v2 Workflow

Claude proposes code edits through the UI's MonacoDiffEditor and blocks until the user makes a decision.

## Key Concepts

- **Code file artifacts** are tracked files linked from disk. They are distinct from snippets.
- Use `list_code_files` to discover what's linked in the current session.
- `propose_code_edit` takes a code file artifact `id` and the full proposed file content.
- `wait_for_edit_decision` blocks until the user accepts or rejects in the browser.

## Workflow

### Step 1 — Find the artifact ID

If you don't already know the artifact ID, list linked code files:

```
mcp__mermaid__list_code_files({ project, session })
```

Returns a list of `{ id, name, filePath, language, dirty }` entries. Find the one matching the file you want to edit.

### Step 2 — Propose the edit

Call `propose_code_edit` with the artifact ID and the **full new file content**:

```
mcp__mermaid__propose_code_edit({
  project: <project>,
  session: <session>,
  id: <code file artifact id>,
  newCode: <full new file content as string>,
  message: <short description of what changed and why>
})
```

The UI switches the editor to MonacoDiffEditor mode showing the diff automatically.

### Step 3 — Wait for the user's decision

Immediately call `wait_for_edit_decision` with the same artifact ID. This **blocks** until the user clicks Accept or Reject:

```
mcp__mermaid__wait_for_edit_decision({
  project: <project>,
  session: <session>,
  id: <same code file artifact id>
})
```

### Step 4 — Handle the decision

The tool returns:

```json
{ "decision": "accepted" | "rejected", "comment": "<optional user comment>" }
```

| Outcome | How Claude should respond |
|---------|--------------------------|
| `accepted` | Confirm the edit was applied. Remind the user to Push if they want the changes written to disk. Continue with the next task. |
| `rejected` (with comment) | Read the comment carefully. Adjust the approach based on the feedback, then re-propose a revised edit or ask a clarifying question. |
| `rejected` (no comment) | Acknowledge the rejection, ask what they'd like changed, wait for guidance before re-proposing. |
| `timeout` | Surface to the user: "I didn't get a response on the proposed edit — would you like me to try again or take a different approach?" |

## Notes

- Always propose the **full file content** (`newCode`), not a partial diff. The MonacoDiffEditor computes the visual diff from the original automatically.
- Code files are **not snippets**. Don't use snippet tools (`create_snippet`, `update_snippet`, etc.) to edit linked code files.
- Acceptance only updates the in-editor content. The user must click **Push** to write the change to disk.
- If multiple files need to change, propose them one at a time and wait for a decision on each before moving to the next.
- If the file isn't linked yet, use `create_code` first to link it, then propose.
