---
name: vibe-active
description: Freeform collab session for creating diagrams, docs, and designs
user-invocable: false
model: sonnet
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash, Agent
---

# Vibe Active

Freeform collab session mode. No structured workflow - just create content freely.

## Entry

### Step 1 — Set session state

Call `mcp__plugin_mermaid-collab_mermaid__update_session_state` with:
- `state`: `vibe-active`
- `sessionType`: `vibe`

This ensures the UI reflects the active vibe session regardless of whether this is a new session or a resume.

### Step 1.5 — Agent mode (new sessions only)

For **new sessions** (no vibeinstructions doc exists yet), after setting state ask:

```
Use agents for heavy tasks? Agent mode dispatches research, implementation,
debugging, and deployment to isolated agents to keep this context window clean.

1. Yes — enable agent mode
2. No — run everything here
```

- If **Yes**: call `update_session_state` with `agentMode: true`
- If **No**: call `update_session_state` with `agentMode: false`

For **resumed sessions**: read `agentMode` from session state.
- If `true` or `false`: do not ask again — use the stored value.
- If **unset** (session predates agent mode): ask the same question as new sessions and save the answer.

### Step 2 — Check for vibe instructions

Call `mcp__plugin_mermaid-collab_mermaid__list_documents` with the current project and session.


Look for a document whose `name` ends with `vibeinstructions`.

**If found:** Call `mcp__plugin_mermaid-collab_mermaid__get_document` to read the full content. Display it to the user verbatim so they can reorient, then say:
```
Vibe session resumed. Continuing from checkpoint above.
```

**If not found:** Create a new `vibeinstructions` document to establish the vibe context:
1. Ask the user: "What are we working on in this vibe? (I'll save this as your vibe instructions so we can resume after a /clear)"
2. Once they answer, call `mcp__plugin_mermaid-collab_mermaid__create_document` with:
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
Vibe session active! [Agent mode: on | off]

You can freely:
- Create diagrams (Mermaid flowcharts, sequence diagrams, etc.)
- Create documents (markdown design docs, notes)
- Create designs (UI mockups with rough hand-drawn styling)

The collab UI is available at http://localhost:3737

Use /vibe-checkpoint before /clear to save your place.
Use /vibe-agents on|off to toggle agent mode.
When you're done, use /collab-cleanup to archive or delete the session.
```

Show actual agent mode status in the bracket.

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

## Agent Dispatch

When `agentMode` is `true` in session state, proactively offer to dispatch heavy tasks as agents.

### When to offer

After understanding a user request, if it falls into one of these categories — offer before starting:

| Type | Trigger phrases |
|------|----------------|
| Research | "how does X work", "investigate", "find all usages", "explore", "what is" |
| Implementation | "implement", "build", "add", "create", "refactor", "update" |
| Debugging | "why is X failing", "fix", "trace", "what's causing" |
| Deployment | "deploy", "push to", "release", "run migrations", "build and" |

**Offer text:**
```
Agent mode is on — want me to run this as an agent to keep our context clean? (yes/no)
```

If yes, dispatch using the appropriate template below. If no, proceed normally in main context.

### Research Agent

Investigates and saves findings as a session document.

```
Agent(
  description: "Research: [topic]",
  prompt: "
Project: {project}
Session: {session}

Research task: {user's request}

1. Read relevant files, search codebase, check git history as needed
2. Save findings as a document:
   Tool: mcp__plugin_mermaid-collab_mermaid__create_document
   Args: { project, session, name: 'research-[topic]', content: [findings in markdown] }
3. Return a concise summary of key findings
  ",
  run_in_background: false
)
```

### Implementation Agent

Implements directly, returns what changed.

```
Agent(
  description: "Implement: [what]",
  prompt: "
Project: {project}
Session: {session}

Implementation task: {user's request}

1. Read relevant files to understand existing code
2. Implement the changes
3. Run tests to verify (use the project's test command)
4. Return:
   - Files changed and what was done
   - Test results (pass/fail)
   - Any decisions made or assumptions taken
  ",
  run_in_background: false
)
```

### Debug Agent

Investigates a failure, saves findings, returns root cause.

```
Agent(
  description: "Debug: [issue]",
  prompt: "
Project: {project}
Session: {session}

Debug task: {user's request}

1. Read relevant source files and trace the code path
2. Identify root cause, affected files, and proposed fix
3. Save findings as a document:
   Tool: mcp__plugin_mermaid-collab_mermaid__create_document
   Args: { project, session, name: 'debug-[issue]', content: [findings] }
4. Return: root cause, affected files, proposed fix approach
  ",
  run_in_background: false
)
```

### Deployment Agent

Runs deployment commands, returns outcome.

```
Agent(
  description: "Deploy: [what]",
  prompt: "
Project: {project}
Session: {session}

Deployment task: {user's request}

1. Run the required build/deploy/migration commands
2. Capture output at each step
3. Return:
   - Each step run and its result (success/failure)
   - Any errors encountered with full output
   - Final deployment status
  ",
  run_in_background: false
)
```

### After Agent Returns

Summarize the result to the user in 2-3 sentences. If a document was created, mention its name so they can open it in the collab UI.

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
