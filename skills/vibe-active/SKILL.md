---
name: vibe-active
description: Freeform collab session for creating diagrams, docs, and designs
user-invocable: false
allowed-tools: mcp__plugin_mermaid-collab_mermaid__*, Read, Glob, Grep, Bash, Agent
---

# Vibe Active

Freeform collab session mode. No structured workflow - just create content freely.

## Entry

### Step 1 — Check for vibe instructions

Call `mcp__plugin_mermaid-collab_mermaid__list_documents` with the current project and session.


Look for a document whose `name` ends with `vibeinstructions`.

**If found:** Call `mcp__plugin_mermaid-collab_mermaid__get_document` to read the full content. Display it to the user verbatim so they can reorient, then say:
```
Vibe session resumed. Continuing from checkpoint above.
```
Then read the `## Pair Mode` section from the vibeinstructions content. If its value is `Enabled`, immediately invoke the `pair` skill via the Skill tool to load it into context.

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
Vibe session active! [Agent mode: on | off] [Pair mode: on | off]

You can freely:
- Create diagrams (Mermaid flowcharts, sequence diagrams, etc.)
- Create documents (markdown design docs, notes)
- Create designs (UI mockups with rough hand-drawn styling)

The collab UI is available at http://localhost:3737

Use /vibe-checkpoint before /clear to save your place.
Use /vibe-agents on|off to toggle agent mode.
Use /vibe-agents pair on|off to toggle pair mode.
When you're done, use /collab-cleanup to archive or delete the session.
```

Show actual agent mode status in the bracket.
Show actual pair mode status in the bracket.

## Available Actions

In vibe mode, respond to user requests to:

1. **Create diagrams** - Use `mcp__plugin_mermaid-collab_mermaid__create_diagram`
2. **Create documents** - Use `mcp__plugin_mermaid-collab_mermaid__create_document`
3. **Create designs** - Use `mcp__plugin_mermaid-collab_mermaid__create_design`
4. **View/edit existing** - Use get/update variants of above
5. **Checkpoint before /clear** - When user invokes /vibe-checkpoint: invoke skill `vibe-checkpoint`
6. **Cleanup** - When user says "done" or invokes /collab-cleanup: invoke skill `collab-cleanup`

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

### Tool Preferences (all agents)

Include this in every agent prompt:

```
Tool preferences — always prefer native tools over shell commands:
- Read files: use the Read tool with offset/limit — never cat, sed, head, or tail
- Search content: use the Grep tool — never shell grep or rg
- Find files: use the Glob tool — never find or ls
- Create/modify files: use the Write or Edit tool — never cat > heredocs or sed -i
- Run scripts: use Bash only for commands that genuinely require shell execution
```

### Research Agent

Investigates and saves findings as a session document.

```
Agent(
  description: "Research: [topic]",
  prompt: "
Project: {project}
Session: {session}

Research task: {user's request}

Tool preferences — always prefer native tools over shell commands:
- Read files: use the Read tool with offset/limit — never cat, sed, head, or tail
- Search content: use the Grep tool — never shell grep or rg
- Find files: use the Glob tool — never find or ls
- Create/modify files: use the Write or Edit tool — never cat > heredocs or sed -i

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

Implements directly, saves a summary document, returns what changed.

```
Agent(
  description: "Implement: [what]",
  prompt: "
Project: {project}
Session: {session}

Implementation task: {user's request}

Tool preferences — always prefer native tools over shell commands:
- Read files: use the Read tool with offset/limit — never cat, sed, head, or tail
- Search content: use the Grep tool — never shell grep or rg
- Find files: use the Glob tool — never find or ls
- Create/modify files: use the Write or Edit tool — never cat > heredocs or sed -i

1. Read relevant files to understand existing code
2. Implement the changes
3. Run tests to verify (use the project's test command)
4. Save a summary document:
   Tool: mcp__plugin_mermaid-collab_mermaid__create_document
   Args: { project, session, name: 'impl-[topic]', content: markdown summary including:
     - What was implemented
     - Files changed (with brief description of each change)
     - Test results
     - Decisions made or assumptions taken
   }
5. Return: document name created + one-paragraph summary
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

Tool preferences — always prefer native tools over shell commands:
- Read files: use the Read tool with offset/limit — never cat, sed, head, or tail
- Search content: use the Grep tool — never shell grep or rg
- Find files: use the Glob tool — never find or ls
- Create/modify files: use the Write or Edit tool — never cat > heredocs or sed -i

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

Runs deployment commands, saves a log document, returns outcome.

```
Agent(
  description: "Deploy: [what]",
  prompt: "
Project: {project}
Session: {session}

Deployment task: {user's request}

Tool preferences — always prefer native tools over shell commands:
- Read files: use the Read tool with offset/limit — never cat, sed, head, or tail
- Search content: use the Grep tool — never shell grep or rg
- Find files: use the Glob tool — never find or ls
- Create/modify files: use the Write or Edit tool — never cat > heredocs or sed -i

1. Run the required build/deploy/migration commands
2. Capture output at each step
3. Save a deployment log document:
   Tool: mcp__plugin_mermaid-collab_mermaid__create_document
   Args: { project, session, name: 'deploy-[topic]', content: markdown log including:
     - Each step run and its result (success/failure)
     - Any errors encountered with full output
     - Final deployment status
   }
4. Return: document name created + final deployment status
  ",
  run_in_background: false
)
```

### After Agent Returns

Summarize the result to the user in 2-3 sentences. If a document was created, mention its name so they can open it in the collab UI.

## Completion

This skill completes when:
- User explicitly requests cleanup (/collab-cleanup or "I'm done")

## Artifact Type Rules

Always follow these rules when saving content to the session:

| Content | Tool |
|---------|------|
| Pure code (single language, no prose) | `create_snippet` |
| Pure markdown / text | `create_document` |
| Mixed (code blocks + explanation) | `create_document` |

**Code → snippet:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__create_snippet
Args: { project, session, name: '[filename.ext]', content: [code] }
```
Always include a file extension in the name so syntax highlighting is applied (e.g. `auth.ts`, `migration.sql`, `Dockerfile`).

**Markdown / mixed → document:**
```
Tool: mcp__plugin_mermaid-collab_mermaid__create_document
Args: { project, session, name: '[topic]', content: [markdown] }
```

## Long Answers as Artifacts

When answering a question where the response would be long (code explanations, architecture overviews, step-by-step guides, comparisons, summaries), **write it as a document instead of responding in the console.**

**Threshold:** If your answer would exceed ~10 lines, default to a document.

**Pattern:**
1. Create the document:
   ```
   Tool: mcp__plugin_mermaid-collab_mermaid__create_document
   Args: { project, session, name: '[topic]', content: [full answer in markdown] }
   ```
2. Respond briefly in console: `"Saved to '[topic]' — open it in the collab UI for the full answer."`

**Why:** Keeps the context window clean, gives you a persistent artifact you can reference later, and avoids walls of text in the chat.

**Exceptions:** Short factual answers (yes/no, a single value, a quick definition) are fine in the console.

