---
name: collab
description: Start or resume a collab session - session management only
user-invocable: true
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash, Agent
---

# Collab Sessions

Entry point for collab workflow. Handles session management and delegates to MCP state machine.

## Step 1: Check Server Health

Check if the collaboration server is running:
```
Tool: mcp__plugin_mermaid-collab_mermaid__check_server_health
Args: {}
```

**If `healthy: true`:** Continue to Step 2.

**If `healthy: false` but `services.api.running: true` (UI not active):** Warn the user:
```
⚠️  The collab UI is not active (run `bun run dev` or `bun run start` to enable it).
Continuing anyway — MCP tools will work but the browser UI won't be available.
```
Then continue to Step 2.

**If MCP tools unavailable or API not reachable:** Tell the user:
```
The collaboration server is not running. Please start it in a terminal:

cd ~/.claude/plugins/cache/mermaid-collab-dev/mermaid-collab/*/
bun run bin/mermaid-collab.ts start

Then restart Claude Code and run /collab again.
```
**STOP** - Do not proceed without a running API server.

## Step 2: Find/Create Session

**If the skill was invoked with a session name argument** (e.g. `/collab my-session-name`):
- Skip the list — go directly to Step 4 using that session name.

Otherwise:

1. List all sessions:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__list_sessions
   Args: {}
   ```

2. **Filter results to current project** (match `project` field against absolute cwd path)

3. **If sessions exist for current project:** ALWAYS present the full list with a "Create new session" option — never auto-select, even if there is only one session. Let the user choose.
4. **If no sessions for current project:** Go to Step 3

## Step 3: Create New Session

1. Generate name: `mcp__plugin_mermaid-collab_mermaid__generate_session_name()`
2. Ask user to confirm or pick own name
3. Ask session type: "What type of session?"
   - Options: "Structured (guided workflow)" or "Vibe (freeform)"
4. Initialize state with sessionType:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__update_session_state
   Args: { "project": "<cwd>", "session": "<name>", "sessionType": "<structured|vibe>", "currentItem": null }
   ```
5. Route via state machine (same for both types):
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__complete_skill
   Args: { "project": "<cwd>", "session": "<name>", "skill": "collab-start" }
   ```
   Invoke: result.next_skill (will be "gather-session-goals" for structured, "vibe-active" for vibe)

## Step 4: Resume Existing Session

1. Get session state: `mcp__plugin_mermaid-collab_mermaid__get_session_state()`
2. Route based on sessionType and state:
   - If sessionType is "vibe" or state is "vibe-active": Invoke skill "vibe-active"
   - Otherwise: Look up the skill from the state using the mapping below

### State-to-Skill Mapping

| State | Skill to invoke |
|-------|----------------|
| gather-goals | gather-session-goals |
| brainstorm-exploring | brainstorming-exploring |
| brainstorm-clarifying | brainstorming-clarifying |
| brainstorm-designing | brainstorming-designing |
| brainstorm-validating | brainstorming-validating |
| systematic-debugging | systematic-debugging |
| task-planning | task-planning |
| rough-draft-confirm | rough-draft-confirm |
| rough-draft-blueprint | rough-draft-blueprint |
| ready-to-implement | ready-to-implement |
| execute-batch | executing-plans |
| bug-review | executing-plans-bugreview |
| completeness-review | executing-plans-completeness |
| workflow-complete | finishing-a-development-branch |
| cleanup | collab-cleanup |

### Execution Phase Resume

When state is `execute-batch`, `bug-review`, or `completeness-review`, show progress before invoking:

1. Read `batches`, `currentBatch`, `completedTasks`, `pendingTasks` from state
2. Display: "Resuming [skill]. Batch [N]/[total], [X] tasks completed, [Y] remaining."
3. Then invoke the mapped skill

## Agent-Eligible Skills

The following skills are headless (no user interaction mid-run) and **must be dispatched as agents** to keep the main context window clean:

| Skill | Why |
|-------|-----|
| `brainstorming-exploring` | Heavy file reading, Kodex queries, diagram creation |
| `rough-draft-blueprint` | Deep code analysis, multi-phase document generation |
| `systematic-debugging` | Code tracing, root cause investigation |

### How to Dispatch

When `next_skill` is one of the above (from `complete_skill` response or state-to-skill mapping), use the Agent tool instead of Skill tool:

```
Agent(
  description: "Run [skill-name] for session [session]",
  prompt: "
Project: {project}
Session: {session}

1. Invoke the Skill tool: skill='{skill-name}'
2. Follow all skill instructions exactly, including calling complete_skill at the end
3. Capture the next_skill value returned by complete_skill
4. Return a message in this format:
   next_skill: <value or 'null'>
   summary: <3-5 sentences: what was found/created, key insights, any artifacts produced>
  ",
  run_in_background: false
)
```

### After Agent Returns

Read the agent's return message:
- Extract `next_skill`
- If `next_skill` is also agent-eligible → dispatch another agent using the same pattern
- If `next_skill` is interactive (clarifying, designing, etc.) → invoke directly with Skill tool
- If `next_skill` is null → workflow complete

## No Manual Routing

This skill does NOT:
- Route by item type (MCP state machine does this)
- Invoke brainstorming/rough-draft directly (complete_skill returns next skill)
- Manage the work item loop (routing nodes handle this)
