---
name: pair
description: Behavior diff review workflow — loads into context when pair mode is on. For any behavioral code change, build before/after diagrams and wait for human approval before writing code.
user-invocable: false
allowed-tools: mcp__plugin_mermaid-collab_mermaid__create_diagram, mcp__plugin_mermaid-collab_mermaid__list_diagrams
---

# Pair Mode — Behavior Diff Review

When pair mode is on, every behavioral code change requires a before/after diagram approved by the human BEFORE writing any code.

## Step 1 — Classify the change

Classify every proposed file change:

| Class | Definition | Action |
|-------|-----------|--------|
| behavioral | Changes logic, control flow, async, error handling, API shape, state transitions, side effects | Build diagram → wait for approval |
| structural | Refactor without behavior change: extracting helpers, renaming, type tightening | Proceed with native approvals |
| trivial | Typo, comment, one-liner, dependency bump | Proceed immediately |

**Uncertain → treat as behavioral.**

## Step 2 — For behavioral changes: read the code

Read every file the change will touch. The before diagram MUST be grounded in code you have actually read. State which files and functions you read alongside the diagram.

If you cannot confidently diagram the current behavior after reading: stop and tell the human — "this change is too risky to propose without deeper investigation."

## Step 3 — Build and post the diagram

One diagram per file. Before and after in the same artifact — use subgraphs or sections.

Post to collab under the appropriate session tree node:
- vibe-go wave context → post under Implementation → Wave N → Task name
- ad-hoc → post under Implementation → Ad-hoc

Call `create_diagram` with a descriptive name: `{task-or-slug}/{filename}`.

## Step 4 — Stop and wait

Tell the human: "Diagram posted for [file] — review in collab and respond approve / revise / reject."

**Do not write any code until approved.**

## Step 5 — Handle response

| Response | Action |
|----------|--------|
| approve | Proceed with code edits using native approvals. No further diagram ceremony for this change. |
| revise [feedback] | Update the same diagram and wait again |
| reject | Stop. Discuss before re-proposing. |

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

STATUS: done | failed
CONTEXT: { file, what was changed, any issues }
