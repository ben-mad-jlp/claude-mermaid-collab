---
name: vibe-go
description: Review the task graph and launch agents to execute tasks in dependency waves
user-invocable: true
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
  - mcp__plugin_mermaid-collab_mermaid__*
---

# Vibe Go

Review the task graph and launch agents to execute tasks in waves.
Each agent implements one task, updates its status, and saves a summary doc.

## Step 1 — Load the task graph

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_task_graph
Args: { "project": "<cwd>", "session": "<session>" }
```

**If no task graph exists** (empty batches or error):
```
No task graph found. Run /vibe-blueprint first to generate one.
```
Stop here.

## Step 2 — Show the task graph and confirm

Display the task graph to the user:

```
Task graph — [N] tasks across [M] waves:

Wave 1 (parallel): task-1, task-2, task-3
Wave 2 (depends on Wave 1): task-4
Wave 3 (depends on Wave 2): task-5

Ready to launch? (yes / edit first)
```

If user says **edit first**: let them describe changes, update the blueprint document accordingly, then call `sync_task_graph` again to re-initialize, and re-show.

If user says **yes**: proceed.

## Step 3 — Read the blueprint

```
Tool: mcp__plugin_mermaid-collab_mermaid__list_documents
Args: { "project": "<cwd>", "session": "<session>" }
```

Find the blueprint document (name contains `blueprint`, `blueprint: true`).

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_document
Args: { "project": "<cwd>", "session": "<session>", "id": "<blueprint-doc-id>" }
```

## Step 4 — Execute waves

For each wave (batch), in order:

### 4.1 Announce the wave

```
Launching Wave [N] — [task-count] task(s) in parallel: [task-ids]
```

### 4.2 Spawn one agent per task (in parallel)

Use the Agent tool for each task in the current wave simultaneously.

Agent prompt template:

```
Project: {project}
Session: {session}

Task: {task-id}
Files: {files array from blueprint}
Tests: {tests array from blueprint}
Description: {description from blueprint}

Blueprint context:
{Relevant section from the blueprint document for this task}

Tool preferences — always prefer native tools over shell commands:
- Read files: use the Read tool with offset/limit — never cat, sed, head, or tail
- Search content: use the Grep tool — never shell grep or rg
- Find files: use the Glob tool — never find or ls
- Create/modify files: use the Write or Edit tool — never cat > heredocs or sed -i

Instructions:

1. Mark task as in_progress:
   Tool: mcp__plugin_mermaid-collab_mermaid__update_task_status
   Args: { "project": "{project}", "session": "{session}", "taskId": "{task-id}", "status": "in_progress", "minimal": true }

2. Read relevant existing files to understand the codebase context

3. Implement the task:
   - Follow the blueprint's function signatures and pseudocode
   - Write tests alongside implementation
   - Match existing code style and patterns

4. Run tests to verify:
   Use Bash to run the project's test command for the changed files

5. Save an implementation summary:
   Tool: mcp__plugin_mermaid-collab_mermaid__create_document
   Args: {
     "project": "{project}",
     "session": "{session}",
     "name": "impl-{task-id}",
     "content": "# Implementation: {task-id}\n\n## Files Changed\n[List each file with brief description]\n\n## What Was Implemented\n[Summary]\n\n## Test Results\n[Pass/fail + relevant output]\n\n## Decisions / Assumptions\n[Any non-obvious choices made]"
   }

6. Mark task as completed:
   Tool: mcp__plugin_mermaid-collab_mermaid__update_task_status
   Args: { "project": "{project}", "session": "{session}", "taskId": "{task-id}", "status": "completed", "minimal": true }

7. Return: "Task {task-id} complete. impl-{task-id} saved."

If implementation fails or tests fail:
- Mark task as failed:
  Tool: mcp__plugin_mermaid-collab_mermaid__update_task_status
  Args: { "project": "{project}", "session": "{session}", "taskId": "{task-id}", "status": "failed", "minimal": true }
- Return a description of what failed and why
```

### 4.3 Wait for all agents in the wave to complete

After all parallel agents return, check for failures:
- If any task failed: stop and report to user — do not proceed to next wave
- If all succeeded: announce wave complete and continue

```
Wave [N] complete. [Optionally summarize what changed]
```

### 4.4 Move to next wave

Repeat from 4.1 for the next wave.

## Step 5 — All waves complete

When all waves finish:

```
All tasks complete across [M] waves.

Run /vibe-review to check for bugs and verify completeness.
```

Mark any deprecated blueprint items if applicable.
