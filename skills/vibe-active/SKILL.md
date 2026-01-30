---
name: vibe-active
description: Freeform collab session for creating diagrams, docs, and wireframes
user-invocable: false
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash
---

# Vibe Active

Freeform collab session mode. No structured workflow - just create content freely.

## Entry Message

Display to user:
```
Vibe session active!

You can freely:
- Create diagrams (Mermaid flowcharts, sequence diagrams, etc.)
- Create documents (markdown design docs, notes)
- Create wireframes (UI mockups with rough hand-drawn styling)

The collab UI is available at http://localhost:3737

When you're done, use /collab-cleanup to archive or delete the session.
```

## Available Actions

In vibe mode, respond to user requests to:

1. **Create diagrams** - Use `mcp__plugin_mermaid-collab_mermaid__create_diagram`
2. **Create documents** - Use `mcp__plugin_mermaid-collab_mermaid__create_document`
3. **Create wireframes** - Use `mcp__plugin_mermaid-collab_mermaid__create_wireframe`
4. **View/edit existing** - Use get/update variants of above
5. **Cleanup** - When user says "done" or invokes /collab-cleanup:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
   Args: { "project": "<cwd>", "session": "<session>", "skill": "vibe-active" }
   ```
   Invoke: result.next_skill (will be "collab-cleanup")

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
