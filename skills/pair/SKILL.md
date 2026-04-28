---
name: pair
description: Behavior diff review workflow — loads into context when pair mode is on. For any behavioral code change, build before/after diagrams and wait for human approval before writing code.
user-invocable: false
allowed-tools: mcp__plugin_mermaid-collab_mermaid__create_diagram, mcp__plugin_mermaid-collab_mermaid__list_diagrams, mcp__plugin_mermaid-collab_mermaid__create_document, mcp__plugin_mermaid-collab_mermaid__get_document
---

# Pair Mode — Behavior Diff Review

When pair mode is on, every behavioral code change requires a before/after diagram approved by the human BEFORE writing any code. After approval, changes are executed via a chained agent pipeline — implement (haiku) → verify (sonnet) → fix loop (haiku).

## Agent Models

| Agent | Model | Reason |
|-------|-------|--------|
| Implement | sonnet | interprets change description reliably |
| Verify | sonnet | semantic review requires reasoning |
| Fix | sonnet | needs judgment to apply corrections correctly |

## Step 1 — Classify the change

Classify every proposed file change:

| Class | Definition | Action |
|-------|-----------|--------|
| behavioral | Changes logic, control flow, async, error handling, API shape, state transitions, side effects | Build diagram → wait for approval → agent chain |
| structural | Refactor without behavior change: extracting helpers, renaming, type tightening | Proceed with native approvals |
| trivial | Typo, comment, one-liner, dependency bump | Proceed immediately |

**Uncertain → treat as behavioral.**

## Step 2 — For behavioral changes: read the code

Read every file the change will touch. The before diagram MUST be grounded in code you have actually read. State which files and functions you read alongside the diagram.

If you cannot confidently diagram the current behavior after reading: stop and tell the human — "this change is too risky to propose without deeper investigation."

## Step 3 — Build and post the diagram

One diagram per file. Before and after in the same artifact — use subgraphs or sections.

Style the before subgraph with `fill:#ffdddd,stroke:#ffaaaa` (pale red) and the after subgraph with `fill:#ddffdd,stroke:#aaffaa` (pale green).

Example structure:
```
flowchart TD
  subgraph before["Before"]
    ...nodes...
  end
  subgraph after["After"]
    ...nodes...
  end
  style before fill:#ffdddd,stroke:#ffaaaa
  style after fill:#ddffdd,stroke:#aaffaa
```

Post to collab using a `/`-separated name — the UI renders each `/`-delimited segment as a nested folder in the Diagrams tree.

Name format: `Implementing/Ad-hoc/{slug}/{filename}` (e.g. `Implementing/Ad-hoc/auth-refactor/TokenService.ts`)

Call `create_diagram` with the full slash-separated name as above. Never use hyphens as folder separators — only `/` creates folder nesting in the UI.

## Step 4 — Stop and wait

Tell the human: "Diagram posted for [file] — review in collab and respond approve / revise / reject."

**Do not write any code until approved.**

## Step 5 — Handle response

| Response | Action |
|----------|--------|
| approve | Proceed to Step 6 |
| revise [feedback] | Update the same diagram and wait again |
| reject | Stop. Discuss before re-proposing. |

## Step 6 — Dispatch IMPLEMENT agents (parallel)

Spawn one IMPLEMENT agent per file, all in parallel.

```
Agent(
  model: "sonnet",
  description: "Edit {filename}",
  prompt: "
You are an IMPLEMENT agent. Make ONE specific edit to ONE file. Nothing else.

File: {absolute file path}
Changes: {specific changes from your planning}

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
CONTEXT: { what was changed, any issues }
  "
)
```

## Step 7 — Chain VERIFY agents

As each implement agent returns, immediately spawn its paired VERIFY agent — do not wait for all implement agents to finish first.

```
Agent(
  model: "sonnet",
  description: "Verify {filename}",
  prompt: "
You are a VERIFY agent. Check that ONE file was implemented correctly. Do NOT make code edits.

Project: {project}
File: {absolute file path}
Expected change: {description of what should have changed, from your planning in Step 2}
Diagram: {diagram name, or \"none\" if structural/trivial}

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

If ANY check fails:

STATUS: failed
FILE: {absolute path}
CORRECTIONS:
- {specific correction — re-state exactly what still needs to change, not just the error}
TSC_ERRORS: {relevant tsc lines, or \"none\"}
  "
)
```

## Step 8 — Per-file fix loop

For each file where verify returned `STATUS: failed`, enter a fix loop independently. Other files are not blocked.

Track `previousErrors` per file (initially empty). On each verify failure:

1. Compare current errors to `previousErrors` for that file
2. If errors are **identical** → stuck, escalate to user for that file only
3. If errors are **new or different** → spawn FIX agent

```
Agent(
  model: "sonnet",
  description: "Fix {filename} (attempt [M])",
  prompt: "
You are a FIX agent. Apply the corrections below to ONE file. Do NOT run tests or verify.

File: {absolute file path}
Corrections:
{CORRECTIONS list from verify agent — re-stated instructions, not raw error messages}

TSC errors (if any):
{TSC_ERRORS from verify agent}

RULES:
- Use the Read tool to read files — NEVER cat, head, tail, sed, or awk
- Use the Edit tool to modify files — NEVER sed -i or shell redirects
- Use the Grep tool to search — NEVER shell grep or rg
- Fix ONLY what the corrections specify — do not refactor or change anything else

STATUS: done | failed
FILE: {absolute path}
CONTEXT: { what was fixed }
  "
)
```

After fix returns:
- `STATUS: failed` → escalate to user
- `STATUS: done` → spawn VERIFY again for that file, set `previousErrors`, loop

Stuck message:
```
File {filename} fix loop stuck — same errors after [M] attempts.
Fix manually and re-run, or skip.
```

## Step 9 — Final TypeScript check

After all per-file loops settle, run a single tsc in the main context:

```bash
cd {project} && npx tsc --noEmit 2>&1 | head -50
```

- **Clean** → done, report to user
- **Errors** → report and stop:
  ```
  tsc failed after per-file verification. Fix manually.
  {errors}
  ```

## Mermaid conventions

| Change type | Diagram |
|-------------|---------|
| Request/response, call-path | sequence diagram |
| Lifecycle, state machine | state diagram |
| Branching logic, control flow | flowchart |
| Concurrency, idempotency, subtle race | one-paragraph description labeled "Not diagrammable" |

## Escape hatches

- "skip behavior review for this one" → treat next change as trivial
- "behavior review everything" → treat all changes as behavioral until told otherwise
- "we're exploring" → ask if looser mode is wanted before applying
