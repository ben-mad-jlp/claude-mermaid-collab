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
Uses a chained agent pattern: analyze → implement → verify → fix loop.
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

If user says **yes**: proceed to Step 3 immediately. Do NOT ask again between waves.

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

For each wave (batch), in order. **Auto-proceed between waves — never ask for confirmation.**

### 4.1 Mark tasks in_progress and announce

Mark all tasks in the wave as in_progress:

```
Tool: mcp__plugin_mermaid-collab_mermaid__update_task_status
Args: { "project": "<cwd>", "session": "<session>", "taskId": "<id>", "status": "in_progress", "minimal": true }
```

```
Launching Wave [N] — [task-count] task(s): [task-ids]
```

### 4.2 Spawn ANALYZE agents (one per task, in parallel)

Each analyze agent handles ONE task — reads only that task's files. This keeps context small.

**Spawn all analyze agents for the wave in parallel:**

```
Agent(
  description: "Analyze {task-id}",
  prompt: "
You are an ANALYZE agent. Read files and return a plan. Do NOT make any edits.

Project: {project}
Task: {task-id}
Files: {files array from blueprint}
Description: {description from blueprint}

Blueprint section for this task:
{relevant blueprint section only — NOT the whole blueprint}

Read the source files listed above. For each file, determine:
- What functions/blocks need to change
- The surrounding context (what's above/below the edit point)
- The specific code to add or modify

Use the Read tool (NEVER cat, head, tail, or ls) and Grep tool (NEVER shell grep or rg).

If the task touches multiple files, return ONE implement step per file.

Return in this EXACT format (include the TASK_ID on every line):

STATUS: parallel
TASK_ID: {task-id}
TASKS:
- FILE: {absolute path} | CHANGES: {exactly what to edit — be specific: function name, what to add/remove/modify, the logic}
- FILE: {absolute path} | CHANGES: { ... }
  "
)
```

### 4.3 Dispatch IMPLEMENT agents

Collect all analyze results. Each analyze agent returned a `TASK_ID` and a list of file edits.

**Group by TASK_ID** — you need this mapping later to know when a task is fully implemented (all its files edited successfully).

**Spawn one IMPLEMENT agent per file edit, in parallel (across all tasks in the wave):**

Each implement agent touches exactly ONE file with ONE focused change. This is critical — if an agent has too much to do, it drifts to shell commands.

```
Agent(
  description: "Edit {filename}",
  prompt: "
You are an IMPLEMENT agent. Make ONE specific edit to ONE file. Nothing else.

File: {absolute file path}
Changes: {specific changes from analyze agent}

RULES (these are strict — violations cause rejection):
- Use the Read tool to read files — NEVER use cat, head, tail, sed, or awk
- Use the Edit tool to modify files — NEVER use sed -i, awk, or shell redirects
- Use the Grep tool to search — NEVER use shell grep, rg, or find
- Use the Glob tool to find files — NEVER use ls or find
- Only use Bash for running build/test commands, NOTHING else

Steps:
1. Read the file with the Read tool
2. Make the edit with the Edit tool
3. Return what you changed

STATUS: done | failed
CONTEXT: { file, what was changed, any issues }
  "
)
```

### 4.4 Collect IMPLEMENT results

After all parallel implement agents return, check results grouped by TASK_ID:

- If any returned `STATUS: failed`: stop the wave, report which task/file failed, do not proceed
- If all returned `STATUS: done`: proceed to verify
- Track which files belong to which TASK_ID — you need this for marking tasks completed after verify

### 4.5 Spawn VERIFY agent

One agent that checks all changes from the wave:

```
Agent(
  description: "Verify wave [N]",
  prompt: "
You are a VERIFY agent. Check that changes are correct. Do NOT make edits.

Files changed: {list from implement results}

RULES:
- Use the Grep tool to search — NEVER shell grep or rg
- Only use Bash for build/test commands

Steps:
1. Run TypeScript check: cd {project} && npx tsc --noEmit 2>&1 | head -30
2. Run relevant tests if any were specified
3. Use Grep for any obvious issues (dangling imports, undefined references) in changed files

Return:

STATUS: done | failed
CONTEXT: { build result, test result, any issues found — include exact error messages }
  "
)
```

### 4.6 Handle VERIFY result

- If `STATUS: done`: mark all tasks in wave as completed, save impl summary, proceed to next wave
- If `STATUS: failed`: enter the fix loop (4.6a)

### 4.6a Fix loop

Track `previousErrors` (initially empty). On each verify failure:

1. Compare current errors to `previousErrors`
2. If errors are **identical** to previous iteration → stuck, escalate to user
3. If errors are **new or different** → making progress, spawn FIX agent

**FIX agent:**

```
Agent(
  description: "Fix wave [N] errors (attempt [M])",
  prompt: "
You are a FIX agent. Fix the errors described below. Do NOT run tests or verify.

Errors:
{exact error messages from verify agent}

Files involved: {file list}

RULES:
- Use the Read tool to read files — NEVER cat, head, tail, sed, or awk
- Use the Edit tool to modify files — NEVER sed -i or shell redirects
- Use the Grep tool to search — NEVER shell grep or rg
- Fix ONLY the reported errors — do not refactor or change anything else

Return:

STATUS: done | failed
CONTEXT: { what was fixed, which files were edited }
  "
)
```

After the FIX agent returns:
- If `STATUS: failed`: escalate to user
- If `STATUS: done`: spawn VERIFY agent again (same prompt as 4.5)
  - Set `previousErrors` to the current errors before re-verifying
  - Go back to 4.6 with the new verify result

This loop continues as long as errors keep changing. The moment the same errors appear twice, stop:

```
Wave [N] fix loop stuck — same errors after [M] attempts.

Errors:
{error details}

Options:
1. Fix manually and re-run /vibe-go
2. Skip this wave
```

### 4.7 Wave complete

**Mark tasks completed:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__update_task_status
Args: { "project": "<cwd>", "session": "<session>", "taskId": "<id>", "status": "completed", "minimal": true }
```

**Save wave implementation summary:**
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

**Immediately proceed to next wave. Do NOT ask the user.**

## Step 5 — All waves complete

When all waves finish:

```
All tasks complete across [M] waves.

Run /vibe-review to check for bugs and verify completeness.
```

## Agent Design Principles

1. **One agent, one job** — analyze reads, implement edits ONE file, verify checks, fix fixes
2. **Small context** — each agent gets only the info it needs, nothing extra
3. **Tool rules in every prompt** — NEVER cat, head, tail, sed, grep, ls, find, awk via Bash
4. **Multi-file tasks get split** — if a task touches 3 files, that's 3 implement agents
5. **Auto-proceed** — never pause between waves for confirmation
6. **Fix loops self-terminate** — same errors twice = stuck = escalate
