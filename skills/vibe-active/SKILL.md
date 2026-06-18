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

**If found:** Call `mcp__plugin_mermaid-collab_mermaid__get_document` to read the full content. It has up to three sections:
- `## Goal` / `## Context` — the stable high-level orientation. Display verbatim so the user can reorient.
- `## Checkpoint` — the volatile "where we left off" detail written by `vibe-checkpoint`. If present, display it verbatim — **this is the resume point**, not any todo. (If absent, the session was never checkpointed; fall back to inferring state from the recent todos.)

Then load the live state from session todos — the real work list:
- Call `mcp__plugin_mermaid-collab_mermaid__list_session_todos` with `includeCompleted: false`.
- Display the open todos. Do NOT expect an `in_progress` todo to carry the checkpoint — interactive sessions have no `in_progress` todo (only the daemon claims), and the checkpoint lives in the `## Checkpoint` section, not on a todo.

Then say:
```
Vibe session resumed. Goal/Context above, and the ## Checkpoint section has where we left off.
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

     ## Checkpoint
     [None yet — vibe-checkpoint writes "where we left off" here before a /clear.]

     ## Pair Mode
     Disabled

     ## Agent Mode
     Enabled
     ```
     (Real work is tracked in session todos; the volatile "where we left off" checkpoint lives in the `## Checkpoint` section above — not on a todo.)
3. Then display the entry message below.

### Entry Message (new vibes only)

```
Vibe session active! [Agent mode: on | off] [Pair mode: on | off]

You can freely:
- Create diagrams (Mermaid flowcharts, sequence diagrams, etc.)
- Create documents (markdown design docs, notes)
- Create designs (UI mockups with rough hand-drawn styling)
- Control a real Chrome browser (screenshot, click, fill, navigate)

The collab UI is available at http://localhost:3737

Use /vibe-checkpoint before /clear to save your place.
Use /vibe-agents on|off to toggle agent mode.
Use /pair-mode on|off to toggle pair mode.
When you're done, use /collab-cleanup to archive or delete the session.
```

Show actual agent mode status in the bracket.
Show actual pair mode status in the bracket.

## Consult Grok on significant design decisions (default practice)

When the work involves a **non-trivial design or architecture decision** — a new system/feature design, a structural tradeoff, choosing between approaches, or hardening a plan — **consult Grok as part of the process**, don't treat it as optional. Grok is an independent model with different failure modes; it catches things a single perspective misses.

How:
- Call `mcp__plugin_mermaid-collab_mermaid__consult_grok { prompt, system?, model? }` with a **skeptical-reviewer** `system` framing ("be critical, prioritize flaws and simpler alternatives over validation, rank the risks"). Give it the real context (the design + the specific decisions you want challenged).
- Bring it in at the points that matter: after drafting a design, before locking a decision, and when grounding/agent investigation has produced options to choose between.
- **Weigh, don't obey.** Synthesize Grok's critique against this product's actual context (local-first, often single-user) — explicitly ACCEPT / TEMPER / DISCOUNT each point (Grok tends to over-rotate to multi-tenant SaaS scale). Record the consult + your synthesis as a session document so the reasoning survives a /clear.
- For deeper investigation that should ground the consult, spawn research agents first (see Agent Dispatch), then feed their findings to Grok.

This is standing guidance for design work in a vibe session — not something to ask permission for each time.

## Available Actions

In vibe mode, respond to user requests to:

1. **Create diagrams** - Use `mcp__plugin_mermaid-collab_mermaid__create_diagram`
2. **Create documents** - Use `mcp__plugin_mermaid-collab_mermaid__create_document`
3. **Create designs** - Use `mcp__plugin_mermaid-collab_mermaid__create_design`
4. **View/edit existing** - Use get/update variants of above
5. **Browser automation** - See Browser section below
6. **Checkpoint before /clear** - When user invokes /vibe-checkpoint: invoke skill `vibe-checkpoint`
7. **Cleanup** - When user says "done" or invokes /collab-cleanup: invoke skill `collab-cleanup`

## Browser Automation

Browser tools let Claude control a real Chrome browser running on the user's machine via CDP. Chrome is tunneled over SSH — Claude connects on Linux port 9333 which forwards to Windows Chrome. The CDP toggle button in the VSCodium status bar must be active (amber) for browser tools to work.

**Every browser tool requires a `session` parameter** — the collab session name. Each session gets its own registered tab in Chrome.

### Tab lifecycle

Always call `browser_open` first to create or navigate the session tab. All other tools reuse that tab.

```
browser_open(url, session)          → creates/reuses tab, navigates to URL
browser_navigate(url, session)      → navigate existing tab (errors if no tab open)
browser_screenshot(session, project)→ capture PNG, save to session images folder
browser_get_url(session)            → current URL and title
```

If `browser_open` returns "tab is gone", call it again — the registry cleared and it will create a fresh tab.

### Interaction tools

```
browser_click(selector, session, text?)   → click element; use text to disambiguate (e.g. selector:"button" text:"Login")
browser_fill(selector, value, session)    → set input value + dispatch input/change events
browser_fill_react(selector, value, session) → fill React-controlled inputs (use when browser_fill value resets)
browser_type_text(text, session)          → type character-by-character (good for autocomplete fields)
browser_select(selector, value, session)  → set <select> value
browser_press_key(key, session)           → dispatch a key event
browser_hover(selector, session)          → hover an element
browser_drag(sourceSelector, targetSelector, session) → drag and drop
browser_wait_for(selector, session, timeout?) → poll until selector exists in DOM
browser_evaluate(expression, session)    → run arbitrary JS and return the result
browser_console(session)                 → capture console events during this connection window
browser_network(session)                 → capture network requests during this connection window
```

### Browser Setups — save and replay navigation sequences

Browser setups let you save a named sequence of steps once and replay it on demand, instead of re-navigating to the same UI state every session.

```
browser_save_setup(session, project, name, steps, description?, parameters?, check?)
  → saves a named sequence of steps to .collab/sessions/<session>/setups/<name>.json

browser_run_setup(session, project, name, parameters?, start_step?, step_timeout_ms?, smart_skip?)
  → replays the setup on the current session tab

browser_list_setups(session, project)
  → lists all saved setups with name, description, step count, last modified

browser_get_setup(session, project, name)
  → returns the full setup definition including all steps

browser_delete_setup(session, project, name)
  → deletes a saved setup
```

**When to use setups:** Any time you navigate to the same UI state more than once (login flows, reaching a specific screen, selecting a user). Save it once, replay it with one tool call.

**Step actions:** `navigate`, `click` (with optional `text`), `fill`, `fill_react`, `type`, `select`, `press_key`, `wait`, `wait_for`, `wait_for_text`, `screenshot`, `eval`, `run_setup` (compose setups).

**Parameterization:** Use `{{variableName}}` in any step field and pass `parameters: { variableName: "value" }` to `browser_run_setup`.

**Smart skip:** If the setup has a `check` field (`{ url_contains, selector }`), pass `smart_skip: true` to skip all steps when the browser is already in the expected state.

**Example:**

```json
browser_save_setup(
  name: "app-login",
  description: "Log in as a given user",
  parameters: [{ name: "user", default: "BEN MADERAZO" }],
  check: { url_contains: "/dashboard" },
  steps: [
    { action: "navigate", url: "http://192.168.100.33:8081" },
    { action: "click", selector: ".user-option", text: "{{user}}" },
    { action: "fill_react", selector: "input[placeholder='Enter password']", value: "password" },
    { action: "click", selector: "button", text: "Login" },
    { action: "wait_for", selector: ".dashboard" }
  ]
)

browser_run_setup(name: "app-login", smart_skip: true)
```

### Screenshot workflow

After any interaction, take a screenshot to verify the result before proceeding:

```
browser_click(...)
browser_screenshot(session, project)
Read(screenshotPath)   ← view the result
```

Always read the screenshot immediately after saving — it gives you visual confirmation of the page state without asking the user to describe it.

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

## Session Artifact Storage

All session artifacts are stored on disk under `.collab/sessions/<session-name>/` in the project root, one folder per type:

```
.collab/sessions/<session-name>/
  documents/
  diagrams/
  designs/
  snippets/
  spreadsheets/
  embeds/
  images/     ← screenshots saved here
  setups/     ← browser setup JSON files saved here
```

When a user references a screenshot or other file by name, look in the appropriate folder here before searching elsewhere. Images uploaded via the collab UI are in `images/`; documents, snippets, etc. are in their respective folders.

## Context Usage — Proactive Checkpoint Nudge

Monitor context usage throughout the vibe session. When context reaches **75% or above**, proactively suggest a checkpoint before continuing:

```
Context is at [X]% — recommend running /vibe-checkpoint before we go further so we don't lose our place on /clear. Want me to checkpoint now?
```

If the user says yes, invoke skill `vibe-checkpoint` immediately. If no, continue but repeat the nudge at 90%.

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

