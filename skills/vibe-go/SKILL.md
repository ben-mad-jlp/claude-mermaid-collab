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
Uses a chained agent pattern: research → implement → verify → fix loop.
Each agent gets a tiny focused prompt with fresh context — no tool drift.

## Agent Models

| Agent | Model | Reason |
|-------|-------|--------|
| Research | sonnet | needs reasoning to plan edits |
| Implement | sonnet | interprets CHANGES description reliably |
| Verify | sonnet | semantic review requires reasoning |
| Fix | sonnet | needs judgment to apply corrections correctly |

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

### 4.1 Announce and spawn RESEARCH agents (one per task, in parallel)

```
Launching Wave [N] — [task-count] task(s): [task-ids]
```

Each research agent handles ONE task — reads only that task's files. This keeps context small.

**Spawn all research agents for the wave in parallel:**

```
Agent(
  model: "sonnet",
  description: "Research {task-id}",
  prompt: "
You are a RESEARCH agent. Read files and return a plan. Do NOT make any code edits.

Project: {project}
Session: {session}
Task: {task-id}
Wave: {wave-number}
Files: {files array from blueprint}
Description: {description from blueprint}

Blueprint section for this task:
{relevant blueprint section only — NOT the whole blueprint}

FIRST: Mark this task as in_progress:
Tool: mcp__mermaid__update_task_status
Args: { \"project\": \"{project}\", \"session\": \"{session}\", \"taskId\": \"{task-id}\", \"status\": \"in_progress\", \"minimal\": true }

THEN: Read the source files listed above. For each file, determine:
- What functions/blocks need to change
- The surrounding context (what's above/below the edit point)
- The specific code to add or modify

Use the Read tool (NEVER cat, head, tail, or ls) and Grep tool (NEVER shell grep or rg).

If the task touches multiple files, return ONE implement step per file.

For large files (>500 lines with multiple logical change groups), split into multiple TASKS entries for the same file, each covering a single narrow change. Label them: FILE: {path} | CHANGES: {one specific change only} | CLASS: ...

After reading all files:

1. Classify each file change as: behavioral / structural / trivial
   - behavioral: changes observable runtime behavior (logic, control flow, data flow, side effects)
   - structural: refactor/rename with no behavior change
   - trivial: comments, formatting, config values

2. For each behavioral file, post a before/after diagram to the collab tree:
   Tool: mcp__mermaid__create_diagram
   Args: { \"project\": \"{project}\", \"session\": \"{session}\", \"name\": \"Implementing/Go/Wave {wave-number}/{task-id}/{filename}\", \"content\": \"<mermaid flowchart diagram with before and after subgraphs. Style the before subgraph with fill:#ffdddd,stroke:#ffaaaa (pale red) and the after subgraph with fill:#ddffdd,stroke:#aaffaa (pale green). Example structure: flowchart TD\\n  subgraph before[\\\"Before\\\"]\\n    ...nodes...\\n  end\\n  subgraph after[\\\"After\\\"]\\n    ...nodes...\\n  end\\n  style before fill:#ffdddd,stroke:#ffaaaa\\n  style after fill:#ddffdd,stroke:#aaffaa>\" }

Return in this EXACT format (include the TASK_ID on every line):

STATUS: parallel
TASK_ID: {task-id}
TASKS:
- FILE: {absolute path} | CHANGES: {exactly what to edit — be specific: function name, what to add/remove/modify, the logic} | CLASS: behavioral|structural|trivial
- FILE: {absolute path} | CHANGES: { ... } | CLASS: behavioral|structural|trivial
DIAGRAMS:
- {filename}: Implementing/Go/Wave {N}/{task-id}/{filename} (or \"none\" if structural/trivial)
  "
)
```

### 4.2 Wave approval gate (pair mode only)

Check the `vibeinstructions` document for a `## Pair Mode` section. If absent or `Disabled`, skip this step and proceed directly to 4.3.

If Pair Mode is **Enabled**, present the wave approval gate after all research agents complete:

```
Wave [N] research complete. Diagrams posted to collab for:
{list each behavioral file with its diagram name}

Review the diagrams in collab and respond:
- "approve" to proceed with implementation
- "reject" to stop and fix the design doc
```

**Wait for human response before spawning any implement agents.**

- **approve** → proceed to 4.3
- **reject** → stop: "Implementation halted. Fix the design doc and re-run /vibe-blueprint, then /vibe-go."

### 4.3 Dispatch IMPLEMENT agents

**Before dispatching implement agents, fire open-diff requests for each file in the wave:**

For each file path in the TASKS list across all research results, send a fire-and-forget POST to the IDE bridge:
```
POST /api/ide/open-diff
{ "filePath": "<absolute file path>" }
```
This opens each file in a live git diff view in VSCode so the user can watch changes happen in real time. Do this in the main context (not as agents) — these are simple fetch calls. Failures are non-fatal; proceed regardless.

Collect all research results. Each research agent returned a `TASK_ID` and a list of file edits.

**Group by TASK_ID** — you need this mapping later to know when a task is fully implemented (all its files edited successfully).

**Spawn one IMPLEMENT agent per TASKS entry.**

For files with multiple TASKS entries (large file splits), spawn those agents SEQUENTIALLY — not in parallel — since they edit the same file. Agents for different files may still run in parallel.

Each implement agent touches exactly ONE file with ONE focused change.

```
Agent(
  model: "sonnet",
  description: "Edit {filename}",
  prompt: "
You are an IMPLEMENT agent. Make ONE specific edit to ONE file. Nothing else.

File: {absolute file path}
Changes: {specific changes from research agent}

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
FILE: {absolute path}
TASK_ID: {task-id}
CONTEXT: { what was changed, any issues }
  "
)
```

### 4.4 Chain VERIFY agents

As each implement agent returns, immediately spawn its paired VERIFY agent — do not wait for all implement agents to finish first.

```
Agent(
  model: "sonnet",
  description: "Verify {filename}",
  prompt: "
You are a VERIFY agent. Check that ONE file was implemented correctly. Do NOT make code edits.

Project: {project}
File: {absolute file path}
Expected change: {CHANGES from research result for this file}
Diagram: {diagram name from DIAGRAMS, or \"none\"}

RULES:
- Use the Read tool to read files — NEVER cat, head, tail, sed, or awk
- Use the Grep tool to search — NEVER shell grep or rg
- Only use Bash for build/test commands

Steps:
1. Read the current file state with the Read tool
2. Semantic review: does the file match the expected change? Check:
   - Was the correct function/block changed?
   - Does the logic match what was described?
   - Are there any obvious mistakes (wrong variable, missing return, logic inverted)?
3. Run TypeScript check: cd {project} && npx tsc --noEmit 2>&1 | head -30

If ALL checks pass:

STATUS: done
FILE: {absolute path}
TASK_ID: {task-id}

If ANY check fails:

STATUS: failed
FILE: {absolute path}
TASK_ID: {task-id}
CORRECTIONS:
- {specific correction 1 — re-state exactly what still needs to change, not just the error}
- {specific correction 2}
TSC_ERRORS: {relevant tsc lines, or \"none\"}
  "
)
```

### 4.5 Per-file fix loop

For each file where verify returned `STATUS: failed`, enter a fix loop for that file independently. Other files are not blocked.

Track `previousErrors` per file (initially empty). On each verify failure for a file:

1. Compare current errors to `previousErrors` for that file
2. If errors are **identical** to previous iteration → stuck, escalate to user for that file only
3. If errors are **new or different** → making progress, spawn FIX agent

**FIX agent:**

```
Agent(
  model: "sonnet",
  description: "Fix {filename} (attempt [M])",
  prompt: "
You are a FIX agent. Apply the corrections below to ONE file. Do NOT run tests or verify.

File: {absolute file path}
Corrections:
{CORRECTIONS list from verify agent — these are re-stated instructions, not raw error messages}

TSC errors (if any):
{TSC_ERRORS from verify agent}

RULES:
- Use the Read tool to read files — NEVER cat, head, tail, sed, or awk
- Use the Edit tool to modify files — NEVER sed -i or shell redirects
- Use the Grep tool to search — NEVER shell grep or rg
- Fix ONLY what the corrections specify — do not refactor or change anything else

Return:

STATUS: done | failed
FILE: {absolute path}
TASK_ID: {task-id}
CONTEXT: { what was fixed }
  "
)
```

After the FIX agent returns:
- If `STATUS: failed`: escalate to user for that file
- If `STATUS: done`: spawn VERIFY agent again for that file (same prompt as 4.4)
  - Set `previousErrors` to the current corrections before re-verifying
  - Loop until done or stuck

Stuck message per file:
```
File {filename} fix loop stuck — same errors after [M] attempts.

Corrections:
{correction details}

Fix this file manually and re-run /vibe-go, or skip and continue.
```

### 4.6 Wave-level TypeScript check

After ALL per-file verify+fix loops settle (all files either done or escalated), run a single wave-level tsc in the main context to catch cross-file type errors:

```bash
cd {project} && npx tsc --noEmit 2>&1 | head -50
```

- If **clean**: proceed to 4.7
- If **errors**: report to user and stop — do not attempt auto-fix at wave level:
  ```
  Wave [N] tsc failed after per-file verification.

  Errors:
  {tsc output}

  Fix these manually and re-run /vibe-go.
  ```

### 4.7 Wave complete

Mark all successfully verified tasks as completed:
```
Tool: mcp__mermaid__update_task_status
Args: { "project": "{project}", "session": "{session}", "taskId": "{task-id}", "status": "completed", "minimal": true }
```
(One call per task-id — do all in sequence.)

**Save wave implementation summary:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "name": "Implementing/Go/Wave [N]/summary",
  "content": "# Wave [N] Implementation\n\n## Tasks\n{task summaries from implement agents}\n\n## Verification\n{verify agent results per file}\n\n## Wave TSC\n{clean | errors}"
}
```

```
Wave [N] complete.
```

**Auto-checkpoint:** Update the vibe instructions "Currently Doing" section:
1. Find and read the `vibeinstructions` document
2. Replace everything after `## Currently Doing` with:
   ```
   - Executing blueprint: [blueprint name]
   - Wave [N]/[total] complete — [completed tasks] done, [remaining tasks] remaining
   - Next step: wave [N+1] or /vibe-review if all waves done
   ```
3. Write back with `update_document`

**Immediately proceed to next wave. Do NOT ask the user.**

## Step 5 — All waves complete

When all waves finish:

```
All tasks complete across [M] waves.

Run /vibe-review to check for bugs and verify completeness.
```

## Agent Design Principles

1. **One agent, one job** — research reads, implement edits ONE file, verify checks ONE file, fix fixes ONE file
2. **Small context** — each agent gets only the info it needs, nothing extra
3. **Tool rules in every prompt** — NEVER cat, head, tail, sed, grep, ls, find, awk via Bash
4. **Multi-file tasks get split** — if a task touches 3 files, that's 3 implement agents
5. **Auto-proceed** — never pause between waves for confirmation
6. **Fix loops self-terminate** — same errors twice = stuck = escalate
7. **Diagrams as the spec** — before/after diagram is the source of truth for behavioral changes; verify checks against CHANGES description and diagram, no separate instructions doc
8. **Right model for the job** — sonnet throughout; no haiku
