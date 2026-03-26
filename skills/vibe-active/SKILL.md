---
name: vibe-active
description: Freeform collab session for creating diagrams, docs, and designs
user-invocable: false
model: sonnet
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Vibe Active

Freeform collab session mode. No structured workflow - just create content freely.

## Entry

### Step 1 — Check for vibe instructions

Call `mcp__plugin_mermaid-collab_mermaid__list_snippets` with the current project and session.

Look for a snippet whose `name` ends with `.vibeinstructions`.

**If found:** Call `mcp__plugin_mermaid-collab_mermaid__get_snippet` to read the full content. Display it to the user verbatim so they can reorient, then say:
```
Vibe session resumed. Continuing from checkpoint above.
```

**If not found:** Create a new `.vibeinstructions` snippet to establish the vibe context:
1. Ask the user: "What are we working on in this vibe? (I'll save this as your vibe instructions so we can resume after a /clear)"
2. Once they answer, call `mcp__plugin_mermaid-collab_mermaid__create_snippet` with:
   - `name`: `vibe.vibeinstructions`
   - `content`: a markdown document using this template, filled in from their answer:
     ```
     # Vibe: [session name]

     ## Goal
     [What the user described]

     ## Context
     [Any relevant context from the conversation so far]

     ## Currently Doing
     [Nothing yet — just started]
     ```
3. Then display the entry message below.

### Entry Message (new vibes only)

```
Vibe session active!

You can freely:
- Create diagrams (Mermaid flowcharts, sequence diagrams, etc.)
- Create documents (markdown design docs, notes)
- Create designs (UI mockups with rough hand-drawn styling)

The collab UI is available at http://localhost:3737

Use /vibe-checkpoint before /clear to save your place.
When you're done, use /collab-cleanup to archive or delete the session.
```

## Available Actions

In vibe mode, respond to user requests to:

1. **Create diagrams** - Use `mcp__plugin_mermaid-collab_mermaid__create_diagram`
2. **Create documents** - Use `mcp__plugin_mermaid-collab_mermaid__create_document`
3. **Create designs** - Use `mcp__plugin_mermaid-collab_mermaid__create_design`
4. **View/edit existing** - Use get/update variants of above
5. **Checkpoint before /clear** - When user invokes /vibe-checkpoint: invoke skill `vibe-checkpoint`
6. **Cleanup** - When user says "done" or invokes /collab-cleanup:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
   Args: { "project": "<cwd>", "session": "<session>", "skill": "vibe-active" }
   ```
   Invoke: result.next_skill (will be "collab-cleanup")
6. **Convert to structured** - When user wants structured workflow (work items, brainstorming, blueprints):
   Invoke skill: convert-to-structured

## Completion

This skill completes when:
- User explicitly requests cleanup (/collab-cleanup or "I'm done")
- At completion, call complete_skill to transition to cleanup state

## No Structured Workflow

This skill does NOT:
- Track work items
- Require brainstorming phases
- Enforce any particular flow

Just help the user create whatever content they need.

**Want structure?** If the user asks for work item tracking, brainstorming, or a guided workflow, invoke the `convert-to-structured` skill to convert this session while preserving all existing artifacts.
