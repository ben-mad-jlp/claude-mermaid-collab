---
name: vibe-checkpoint
description: Save current vibe state before a /clear — updates the .vibeinstructions snippet with what we're doing so we can resume after compact
user-invocable: true
model: sonnet
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Vibe Checkpoint

Save the current state of the vibe before clearing context. Updates the `.vibeinstructions` snippet with what we're currently working on so the next session can pick up immediately.

## Steps

### Step 1 — Get session context

Call `mcp__plugin_mermaid-collab_mermaid__get_session_state` with the current project and session to get the session name.

### Step 2 — Find the .vibeinstructions snippet

Call `mcp__plugin_mermaid-collab_mermaid__list_snippets` with the current project and session.

Look for a snippet whose `name` ends with `.vibeinstructions`.

### Step 3 — Read current instructions

If found, call `mcp__plugin_mermaid-collab_mermaid__get_snippet` to read the full content.

If not found, the content template is:
```
# Vibe: [session name]

## Goal
[Not yet defined]

## Context
[No context recorded]

## Currently Doing
[Nothing recorded yet]
```

### Step 4 — Write the checkpoint summary

Based on the recent conversation context, write a concise "Currently Doing" summary (3–8 bullet points) covering:
- What task/feature/problem we're in the middle of
- What files or components are relevant
- What the next concrete step is
- Any important decisions or blockers

### Step 5 — Update the instructions

Replace the entire `## Currently Doing` section (from the `## Currently Doing` heading to the end of the file, or to the next `##` heading if one exists after it) with the new checkpoint summary.

If the snippet exists: call `mcp__plugin_mermaid-collab_mermaid__patch_snippet` with the updated content.

If it does not exist: call `mcp__plugin_mermaid-collab_mermaid__create_snippet` with:
- `name`: `vibe.vibeinstructions`
- `content`: the full template with the checkpoint filled in

### Step 6 — Confirm and prompt

Tell the user:
```
Checkpoint saved to vibe.vibeinstructions.

Currently Doing section updated. You can now run /clear to compact the context.
When you return, the vibe-active skill will restore this context automatically.
```
