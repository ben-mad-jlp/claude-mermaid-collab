---
name: executing-plans-completeness
description: Completeness review comparing design spec against implementation to catch gaps before declaring done
user-invocable: false
model: sonnet
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__*
---

# Completeness Review Phase

Systematic review comparing the design spec against actual implementation to catch gaps — missing functions, incomplete stubs, missing tests, and unmet success criteria. Runs after bug review (Step 4.5), before declaring implementation done.

**Core principle:** Catch what wasn't implemented before leaving the implementation phase.

**Announce at start:** "I'm running a completeness review comparing the design spec against the implementation."

## Step 1: Gather the Spec

Load all design artifacts to build the full picture of what was supposed to be implemented.

**1a. Read the design document:**

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_document
Args: { "project": "<cwd>", "session": "<session>", "id": "design" }
```

Extract from the design doc:
- **Work Items** — each item with its type, description, and acceptance criteria
- **Success Criteria** — the overall definition of done
- **Out of Scope** — items explicitly excluded (these are NOT gaps)
- **Decision Log** — any accepted drift or design changes during implementation

**1b. List and read blueprint documents:**

```
Tool: mcp__plugin_mermaid-collab_mermaid__list_documents
Args: { "project": "<cwd>", "session": "<session>" }
```

For each document matching `blueprint-item-*`:

```
Tool: mcp__plugin_mermaid-collab_mermaid__get_document
Args: { "project": "<cwd>", "session": "<session>", "id": "blueprint-item-N" }
```

Extract from each blueprint:
- **Function signatures** — every function/method/type defined
- **File lists** — every file that should exist
- **Task graph** — every task that should have been completed

## Step 2: Dispatch Completeness Review Agent

Spawn a Task agent (subagent_type: general-purpose, model: sonnet) with the following prompt:

```
# Completeness Review

You are comparing a design spec against the actual implementation to find gaps — things that were specified but not implemented, or were implemented incompletely.

## Design Spec

{Paste the full design doc content here}

## Blueprint Documents

{Paste all blueprint-item-N documents here}

## Review Instructions

For each blueprint document, systematically check:

### Missing Functions/Types
- Every function signature in the spec → verify it exists in the codebase
- Every type/interface defined → verify it exists
- Every export listed → verify it's exported
- Use Glob and Grep to search for each function/type name

### Incomplete Implementations
- Search for stub patterns: `throw new Error('Not implemented')`, `TODO`, `FIXME`, `HACK`
- Check that function bodies actually implement the described logic, not just return placeholder values
- Verify non-trivial functions have real logic, not just pass-through

### Missing Tests
- If the spec mentions tests for a feature, verify test files exist
- Check that test files have actual test cases (not just empty describe blocks)
- Verify critical paths have test coverage

### Unmet Success Criteria
- For each success criterion in the design doc, verify it's been met
- Check both functional criteria (feature works) and non-functional (performance, error handling)

### Leftover TODO/FIXME/HACK
- Search the implementation files for TODO, FIXME, HACK comments
- Flag any that indicate incomplete work (not informational TODOs)

## Exclusions — Do NOT Flag These

- Anything listed in the design doc's "Out of Scope" section
- Anything noted as accepted drift in the Decision Log
- Style/formatting issues (not a completeness concern)
- Alternative implementations that achieve the same result differently

## Output Format

For each gap found:

```
### Gap {N}: {short title}

**Severity:** Required | Nice-to-have
**Category:** Missing Function | Incomplete Implementation | Missing Test | Unmet Criterion | Leftover TODO
**Spec Reference:** {which section of the design doc or blueprint}

**What's missing:**
{Describe precisely what the spec says should exist}

**Current state:**
{What actually exists (or doesn't) in the codebase}
```

### Severity Definitions
- **Required**: The spec explicitly defines this and it's missing or incomplete — a gap in the contract
- **Nice-to-have**: Implied by the spec but not explicitly required, or partially met in a different way

### Rules
- Only report genuine gaps between spec and implementation
- Each finding must reference a specific part of the spec
- Don't flag things the spec doesn't actually require
- If nothing is missing, say so — don't invent gaps to look thorough
- Respect Out of Scope and Decision Log exclusions
```

## Step 3: Present Findings

Display the completeness review results to the user.

**If no gaps found:**

```
Completeness review done — implementation matches the design spec.
Ready to proceed to completion.
```

→ Return to executing-plans Step 5.

**If gaps found, present via `render_ui`:**

```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "ui": {
    "type": "Card",
    "props": { "title": "Completeness Review Results" },
    "children": [
      {
        "type": "Markdown",
        "props": {
          "content": "Found **{N}** gaps between design spec and implementation ({required} required, {nice} nice-to-have).\n\n{For each gap, show the agent's output}"
        }
      }
    ],
    "actions": [
      { "id": "review", "label": "Review Each", "primary": true },
      { "id": "add-all", "label": "Add All as Todos" }
    ]
  },
  "blocking": true
}
```

## Step 4: Gate on Decisions

### Required Gaps

For each gap with severity **Required**, present individually and ask the user to decide:

```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "ui": {
    "type": "Card",
    "props": { "title": "Required Gap: {title}" },
    "children": [
      {
        "type": "Markdown",
        "props": {
          "content": "**Category:** {category}\n**Spec Reference:** {reference}\n\n**What's missing:**\n{description}\n\n**Current state:**\n{current_state}"
        }
      }
    ],
    "actions": [
      { "id": "todo", "label": "Add as Todo", "primary": true },
      { "id": "fix", "label": "Fix Now" },
      { "id": "oos", "label": "Out of Scope" }
    ]
  },
  "blocking": true
}
```

**If user chooses "Add as Todo":**

```
Tool: mcp__plugin_mermaid-collab_mermaid__add_todo
Args: {
  "project": "<cwd>",
  "title": "{gap title}: {brief description}"
}
```

Continue to next gap.

**If user chooses "Fix Now":**
- Implement the missing piece inline
- Run relevant tests to verify
- Show the fix to the user
- Continue to next gap

**If user chooses "Out of Scope":**
- Record as a lesson:
  ```
  Tool: mcp__plugin_mermaid-collab_mermaid__add_lesson
  Args: {
    "project": "<cwd>",
    "session": "<session>",
    "lesson": "Out of scope: {gap description}. Reason: {user's reasoning}",
    "category": "workflow"
  }
  ```
- Continue to next gap

### Nice-to-have Gaps

After all Required gaps are resolved, present Nice-to-have gaps as a batch:

```
Tool: mcp__plugin_mermaid-collab_mermaid__render_ui
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "ui": {
    "type": "Card",
    "props": { "title": "Nice-to-have Gaps" },
    "children": [
      {
        "type": "Markdown",
        "props": {
          "content": "These gaps are implied by the spec but not explicitly required:\n\n{numbered list of nice-to-have gaps}"
        }
      }
    ],
    "actions": [
      { "id": "add-all", "label": "Add All as Todos", "primary": true },
      { "id": "skip", "label": "Skip All" },
      { "id": "review", "label": "Review Each" }
    ]
  },
  "blocking": true
}
```

**If "Add All as Todos":** Call `add_todo` for each nice-to-have gap.

**If "Skip All":** Continue without action.

**If "Review Each":** Present each one individually with the same three-way decision (Todo / Fix Now / Out of Scope).

## Step 5: Verify Fixes

If any gaps were fixed inline:

```bash
npm run test:ci
```

**If tests pass:** Return to executing-plans Step 5.
**If tests fail:** Fix test failures, then return.

## Integration

**Called by:** executing-plans skill, after bug review (Step 4.6)

**Collab workflow position:**
```
executing-plans:
  Step 1-1.8: Setup
  Step 2: Execute batches
  Step 3-4: Report and continue
  Step 4.5: Bug review
  Step 4.6: Completeness review ← (you are here)
  Step 5: Complete development
```
