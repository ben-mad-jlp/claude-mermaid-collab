---
name: vibe-blueprint
description: Generate a blueprint and task graph from selected session artifacts
user-invocable: true
model: sonnet
effort: high
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - mcp__plugin_mermaid-collab_mermaid__*
---

# Vibe Blueprint

Generate a blueprint document and task graph from selected session artifacts.
The blueprint is saved as a locked read-only document in the session's Blueprint section.

## Step 1 — List available artifacts

Call `mcp__plugin_mermaid-collab_mermaid__list_documents` and `mcp__plugin_mermaid-collab_mermaid__list_snippets` to get all artifacts in the current session.

Filter out:
- Documents ending in `vibeinstructions`
- Documents that are already blueprints (`blueprint-*`)

## Step 2 — Ask which artifacts to use

Present the list and ask:

```
Which documents should I use to generate the blueprint?
(Enter names or IDs, or say "all")

Available:
1. [name] — [type]
2. [name] — [type]
...
```

Wait for the user's response.

## Step 3 — Read selected artifacts

Call `mcp__plugin_mermaid-collab_mermaid__get_document` (or `get_snippet`) for each selected artifact and read its full content.

Also read the codebase as needed to understand existing patterns:
- Use the Read tool with offset/limit — never cat, sed, head, or tail
- Use the Grep tool to search — never shell grep
- Use the Glob tool to find files — never find

## Step 4 — Generate the blueprint

Analyze the selected artifacts and produce a blueprint with three sections:

### 4.1 Structure Summary

- All files that will be created or modified
- Key function/class signatures
- Type definitions and interfaces
- How components interact

### 4.2 Function Blueprints

For each non-trivial function:
- Signature with types
- Step-by-step pseudocode
- Error handling approach
- Key edge cases
- Test strategy

### 4.3 Task Dependency Graph

Build tasks from the structure:
- One task per file or logical unit
- Task ID derived from file path (e.g., `src/auth/service.ts` → `auth-service`)
- `depends-on` based on import analysis
- `parallel: true` for tasks with no dependencies or only prior-wave dependencies
- Group into execution waves (topological sort)

**YAML format** (required — this is parsed by `sync_task_graph`):

```yaml
tasks:
  - id: task-id
    files: [src/path/to/file.ts]
    tests: [src/path/to/file.test.ts]
    description: "What this task implements"
    parallel: true
    depends-on: []
  - id: task-id-2
    files: [src/path/to/other.ts]
    tests: [src/path/to/other.test.ts]
    description: "What this task implements"
    parallel: false
    depends-on: [task-id]
```

## Step 5 — Create the blueprint document

```
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "name": "blueprint",
  "content": "<full blueprint content>"
}
```

Blueprint document structure:

```markdown
# Blueprint

## Source Artifacts
- [List of artifacts used to generate this blueprint]

## 1. Structure Summary

### Files
- [ ] `src/path/file.ts` — Description

### Type Definitions
[Key types and interfaces]

### Component Interactions
[How pieces connect]

---

## 2. Function Blueprints

### `functionName(param: Type): ReturnType`

**Pseudocode:**
1. Step one
2. Step two

**Error handling:** ...
**Edge cases:** ...
**Test strategy:** ...

[Repeat for each function]

---

## 3. Task Dependency Graph

### YAML Graph

\`\`\`yaml
tasks:
  - id: ...
\`\`\`

### Execution Waves

**Wave 1 (parallel):**
- task-id-1, task-id-2

**Wave 2 (depends on Wave 1):**
- task-id-3

### Summary
- Total tasks: N
- Total waves: M
- Max parallelism: P
```

## Step 6 — Mark as blueprint and initialize task graph

After the document is created, get its ID from the response, then:

**Mark it as a blueprint (locked, appears in Blueprint section):**
```
Tool: mcp__plugin_mermaid-collab_mermaid__set_artifact_metadata
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "id": "<document-id>",
  "blueprint": true
}
```

**Initialize the task graph from the blueprint:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__sync_task_graph
Args: {
  "project": "<cwd>",
  "session": "<session>"
}
```

## Step 7 — Confirm to user

Tell the user:

```
Blueprint created — [N] tasks across [M] waves.

The task graph is ready. Run /vibe-go to review and launch.
```

If `sync_task_graph` returned an error (e.g. no YAML found), tell the user and show what was returned so they can diagnose.
