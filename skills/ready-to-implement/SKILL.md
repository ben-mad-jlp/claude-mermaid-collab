---
name: ready-to-implement
description: Validate design completion and transition to implementation phase
---

# Ready to Implement

## Overview

Validates that all design decisions are complete and transitions from brainstorming to implementation phase.

**Core principle:** No implementation without complete design decisions.

**Announce at start:** "I'm using the ready-to-implement skill to validate design completion."

## When to Use

Use this skill when:
- Brainstorming is complete and you want to verify the design is ready
- You need to check for undecided items before starting implementation
- You want to transition from brainstorming to implementation phase

## When NOT to Use

Do NOT use this skill when:
- No collab session is active (use `/collab` first)
- Design document does not exist yet (use `/brainstorming` first)
- Already in implementation phase (use `/executing-plans` instead)

## Behavior

1. Find active collab session
2. Read design document
3. Check for undecided items (items without checkmarks or strikethrough)
4. If incomplete: list missing decisions
5. If complete: ask user confirmation
6. On confirm: update state.phase to "implementation"

## Implementation

When invoked, follow these steps:

### Step 1: Find Active Session

```bash
# List collab sessions
ls -d .collab/*/ 2>/dev/null | xargs -I{} basename {}
```

If no sessions exist, report: "No active collab sessions found."

If multiple sessions exist, ask user which session to check.

### Step 2: Read Collab State

```bash
cat .collab/<session-name>/collab-state.json
```

**Check current phase:**
- If `phase` is already `"implementation"`:
  ```
  Session is already in implementation phase.
  Use /executing-plans to continue implementation.
  ```
  Return without further action.

- If `phase` is `"brainstorming"` or `"rough-draft/*"`:
  Continue to Step 3.

### Step 3: Read Design Document

Use the MCP tool to get the design document:

```
Tool: mcp__mermaid__get_document
Args: { "project": "<project-path>", "session": "<session-name>", "id": "design" }
```

Or read from filesystem:

```bash
cat .collab/<session-name>/documents/design.md
```

### Step 4: Parse Decision Items

Look for the "Items to Discuss" or "Key Decisions" section in the design document.

**Decision markers:**
- Decided items have one of these markers:
  - Line starts with or contains a checkmark
  - Text is wrapped in strikethrough (`~~text~~`)
  - Explicit "Decision:" or "Decided:" prefix
- Undecided items lack these markers

**Example patterns:**

```markdown
## Items to Discuss

- Use Redis for caching              # UNDECIDED - no marker
- ~~Use PostgreSQL for storage~~     # DECIDED - strikethrough (rejected)
- Database: PostgreSQL               # DECIDED - explicit decision format
- [x] Authentication via JWT         # DECIDED - checkbox checked
```

### Step 5: Report Results

**If undecided items exist:**

```
Design has undecided items:

1. [Item 1 text]
2. [Item 2 text]
3. [Item 3 text]

Please resolve these decisions before transitioning to implementation.
Return to brainstorming to finalize the design.
```

Do NOT transition to implementation phase.

**If all items are decided:**

```
All design decisions are complete:

- [Summary of key decisions]

Ready to transition to implementation phase?
This will:
1. Update collab state to "implementation"
2. Enable use of executing-plans skill

Confirm? (yes/no)
```

### Step 6: Transition to Implementation

On user confirmation ("yes", "y", "confirm"):

**Update collab-state.json:**

```bash
# Read current state
cat .collab/<session-name>/collab-state.json

# Update phase to implementation
# Write updated JSON with phase: "implementation"
```

The updated state should be:

```json
{
  "phase": "implementation",
  "template": "<existing-template>",
  "lastActivity": "<current-ISO-timestamp>",
  "pendingVerificationIssues": []
}
```

**Confirm transition:**

```
TRANSITIONED TO IMPLEMENTATION PHASE

Session: <session-name>
Previous phase: <previous-phase>
Current phase: implementation

Next steps:
- Use /executing-plans to begin implementation
- Use /subagent-driven-development for parallel task execution
- Use /verification-before-completion before claiming work is done
```

## Decision Detection Patterns

The skill checks for these patterns to determine if an item is decided:

| Pattern | Status | Example |
|---------|--------|---------|
| `~~text~~` | Decided (rejected) | `~~Use MongoDB~~` |
| `[x]` checkbox | Decided (accepted) | `[x] Use PostgreSQL` |
| `Decision:` prefix | Decided | `Decision: Use REST API` |
| `Decided:` prefix | Decided | `Decided: 3 microservices` |
| Line with explicit choice | Decided | `Database: PostgreSQL` |
| Plain text without marker | Undecided | `- Consider caching strategy` |
| `[ ]` empty checkbox | Undecided | `[ ] Choose auth method` |
| `TBD` or `TODO` | Undecided | `Auth method: TBD` |

## Error Handling

**No collab session found:**
```
No active collab session found.
Start a new session with /collab first.
```

**Design document not found:**
```
Design document not found at .collab/<session>/documents/design.md
Ensure brainstorming has created the design document.
```

**Already in implementation:**
```
Session "<session-name>" is already in implementation phase.
Current phase: implementation
Use /executing-plans to continue.
```

## Integration

**Called by:**
- User directly via `/ready-to-implement` command
- After completing brainstorming when user wants to verify readiness

**Transitions to:**
- **executing-plans** skill - When design is complete and user confirms

**Related skills:**
- **brainstorming** - Where design decisions are made
- **rough-draft** - Intermediate phase between brainstorming and implementation
- **collab** - Session management

**Collab Workflow Chain:**
```
collab --> brainstorming --> ready-to-implement --> executing-plans --> finishing-a-development-branch
                                    ^
                             (you are here)
```

This skill acts as a gate between design and implementation phases, ensuring no implementation begins without complete design decisions.

## Quick Reference

```
/ready-to-implement

1. Finds active collab session
2. Checks design document for undecided items
3. If undecided items found: lists them, stays in current phase
4. If all decided: asks confirmation, then transitions to implementation
```
