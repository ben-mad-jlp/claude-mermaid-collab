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
Uses a chained agent pattern: analyze → implement (parallel) → verify.
Each agent gets a tiny focused prompt with fresh context — no tool drift.

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

## Step 4 — Execute waves using chained agents

For each wave (batch), in order:

### 4.1 Mark tasks in_progress

Before spawning any agents, mark all tasks in the wave as in_progress:

```
Tool: mcp__plugin_mermaid-collab_mermaid__update_task_status
Args: { "project": "<cwd>", "session": "<session>", "taskId": "<id>", "status": "in_progress", "minimal": true }
```

### 4.2 Announce the wave

```
Launching Wave [N] — [task-count] task(s): [task-ids]
```

### 4.3 Spawn ANALYZE agent

One agent per wave. Its job: read the blueprint and relevant source files for ALL tasks in this wave, then return a parallel implementation plan.

```
Agent(
  description: "Analyze wave [N]",
  prompt: "
You are an ANALYZE agent. Read files and return a plan. Do NOT make any edits.

Project: {project}
Wave {N} tasks:
{For each task: id, files, tests, description, relevant blueprint section}

For each task:
1. Read the source files listed in the blueprint
2. Determine exactly what needs to change (specific functions, line locations, code to add/modify)
3. Note any interactions between tasks that could cause conflicts

Use the Read tool (not cat/head/tail) and Grep tool (not shell grep).

Return in this EXACT format:

STATUS: parallel
TASKS:
- NEXT: implement | TASK_ID: {id} | CONTEXT: { file: '...', changes: 'specific description of what code to write/edit — include function signatures, exact locations, and the logic to implement' }
- NEXT: implement | TASK_ID: {id} | CONTEXT: { ... }
JOIN: verify
JOIN_CONTEXT: { list of files changed, what tests to run }
  "
)
```

### 4.4 Dispatch based on ANALYZE response

Parse the response. The analyze agent returns `STATUS: parallel` with a list of tasks.

**Spawn one IMPLEMENT agent per task in parallel:**

```
Agent(
  description: "Implement {task-id}",
  prompt: "
You are an IMPLEMENT agent. Make the specific changes described below. Nothing else.

File: {file from CONTEXT}
Changes: {changes from CONTEXT}

Rules:
- Use the Read tool to read files — NEVER cat, head, tail, or sed
- Use the Edit tool to modify files — NEVER sed -i or shell redirects
- Use the Grep tool to search — NEVER shell grep or rg
- Only use Bash for running tests or build commands

Make the changes, then return:

STATUS: done | failed
CONTEXT: { files changed, what was implemented, any issues }
  "
)
```

### 4.5 Collect IMPLEMENT results

After all parallel implement agents return:

- If any returned `STATUS: failed`: stop the wave, report failures to user, do not proceed
- If all returned `STATUS: done`: proceed to verify

### 4.6 Spawn VERIFY agent

One agent that checks all changes from the wave:

```
Agent(
  description: "Verify wave [N]",
  prompt: "
You are a VERIFY agent. Check that changes are correct. Do NOT make edits.

Files changed: {from JOIN_CONTEXT + implement results}
Tests to run: {from JOIN_CONTEXT}

1. Run the project's TypeScript check: cd {project} && npx tsc --noEmit 2>&1 | head -30
2. Run relevant tests: {test commands from JOIN_CONTEXT}
3. Grep for any obvious issues (dangling imports, undefined references)

Return:

STATUS: done | failed
CONTEXT: { build result, test result, any issues found }
  "
)
```

### 4.7 Handle VERIFY result

- If `STATUS: done`: mark all tasks in wave as completed, save impl summary, announce wave complete
- If `STATUS: failed`: report to user, mark tasks as failed

**Mark tasks completed:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__update_task_status
Args: { "project": "<cwd>", "session": "<session>", "taskId": "<id>", "status": "completed", "minimal": true }
```

**Save wave implementation summary (one doc per wave, not per task):**
```
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "name": "impl-wave-[N]",
  "content": "# Wave [N] Implementation\n\n## Tasks\n{task summaries from implement agents}\n\n## Verification\n{verify agent results}"
}
```

```
Wave [N] complete.
```

### 4.8 Move to next wave

Repeat from 4.1 for the next wave.

## Step 5 — All waves complete

When all waves finish:

```
All tasks complete across [M] waves.

Run /vibe-review to check for bugs and verify completeness.
```

## Why Chained Agents

The chain pattern (analyze → implement → verify) prevents tool drift:
- Each agent gets a **tiny, focused prompt** with fresh context
- Tool preferences are near the top, not buried under accumulated conversation
- Agents never accumulate enough context to "forget" instructions
- Failed steps can be retried without re-running the entire task

The main context stays clean — it only sees structured return values, not file contents or diffs.
