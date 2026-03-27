---
name: vibe-read
description: Read and display the vibe instructions for the current session
user-invocable: true
model: sonnet
allowed-tools: mcp__plugin_mermaid-collab_mermaid__get_session_state, mcp__plugin_mermaid-collab_mermaid__list_documents, mcp__plugin_mermaid-collab_mermaid__get_document
---

# Vibe Read

Display the vibe instructions for the current session so you can reorient.

## Steps

### Step 1 — Get session context

Call `mcp__plugin_mermaid-collab_mermaid__get_session_state` with the current project and session.

### Step 2 — Find the vibeinstructions document

Call `mcp__plugin_mermaid-collab_mermaid__list_documents` with the current project and session.

Look for a document whose `name` ends with `vibeinstructions`.

### Step 3 — Display

**If found:** Call `mcp__plugin_mermaid-collab_mermaid__get_document` and display the full content verbatim to the user. Then say:
```
Vibe instructions loaded. Ready to continue.
```

**If not found:** Tell the user:
```
No vibe instructions found for this session.
Run /vibe-active to create them.
```
