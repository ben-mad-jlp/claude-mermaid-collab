---
name: pair
description: Propose a code edit via the MonacoDiffEditor and wait for the user to accept or reject it in the browser
user-invocable: true
allowed-tools: mcp__mermaid__propose_code_edit, mcp__mermaid__review_code_edits
---

# Pair Mode — v2 Workflow

Claude proposes code edits through the UI's MonacoDiffEditor and blocks until the user makes a decision. This replaces the old toggle/curl workflow.

## Workflow

### Step 1 — Propose the edit

Call `propose_code_edit` to push a full-file diff into the UI's MonacoDiffEditor:

```
mcp__mermaid__propose_code_edit({
  project: <project-id>,
  session: <session-id>,
  file: <relative-file-path>,
  content: <full new file content as string>
})
```

The tool returns an edit `id` that identifies this proposal.

### Step 2 — Wait for the user's decision

Immediately after proposing, call `review_code_edits` with the edit `id`. This call **blocks** until the user clicks Accept or Reject in the browser:

```
mcp__mermaid__review_code_edits({
  project: <project-id>,
  session: <session-id>,
  id: <edit-id from Step 1>
})
```

### Step 3 — Handle the decision

The tool returns:

```json
{ "decision": "accepted" | "rejected", "comment": "<optional user comment>" }
```

It may also time out if the user does not respond.

| Outcome | How Claude should respond |
|---------|--------------------------|
| `accepted` | Confirm the edit was applied, then continue with the next task. |
| `rejected` (with comment) | Read the comment carefully. Adjust the approach based on the feedback, then re-propose a revised edit or ask a clarifying question before proceeding. |
| `rejected` (no comment) | Acknowledge the rejection, ask the user what they would like changed, and wait for guidance before re-proposing. |
| timeout | Treat as an implicit rejection. Surface to the user that no decision was received ("I didn't get a response on the proposed edit — would you like me to try again or take a different approach?"). |

## Notes

- Always propose the **full file content**, not a partial diff. The MonacoDiffEditor computes the visual diff from the original automatically.
- Do not make any further edits to the file on disk until the user accepts. The accepted path writes the file; rejection means the disk content is unchanged.
- If multiple files need to change, propose them one at a time and wait for a decision on each before moving to the next.
