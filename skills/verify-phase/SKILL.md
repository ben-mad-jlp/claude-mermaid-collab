---
name: verify-phase
description: Verify rough-draft phase alignment with design doc
---

# Verify Phase

## Overview

Checks if rough-draft output aligns with original design. Called after each rough-draft phase (INTERFACE, PSEUDOCODE, SKELETON).

**Core principle:** Detect drift early before implementation diverges from design.

**Announce at start:** "I'm using the verify-phase skill to check alignment with the design document."

## When to Use

Use this skill when:
- Completing a rough-draft phase (INTERFACE, PSEUDOCODE, or SKELETON)
- You want to verify phase output matches the original design decisions
- Before transitioning between rough-draft phases

## When NOT to Use

Do NOT use this skill when:
- No design document exists yet (use `/brainstorming` first)
- In implementation phase (design is already finalized)
- No rough-draft output to verify

## Behavior

1. Read current phase output
2. Read design document
3. Use LLM to evaluate alignment
4. If aligned: proceed
5. If drift detected:
   - Present what changed, pros/cons, suggestion
   - Ask user: Accept (return to brainstorm), Reject (redo), or Partial
6. Handle user choice

## Implementation

Called by rough-draft skill after each phase with:
- `currentPhase`: INTERFACE | PSEUDOCODE | SKELETON
- `phaseOutput`: content produced

### Step 1: Get Design Document

Use the MCP tool to get the design document:

```
Tool: mcp__mermaid__get_document
Args: { "project": "<project-path>", "session": "<session-name>", "id": "design" }
```

Or read from filesystem:

```bash
cat .collab/<session-name>/documents/design.md
```

### Step 2: Construct Comparison Prompt

Build a prompt to evaluate alignment:

```
Compare the following {currentPhase} output against the design document.

Design Document:
{design_doc_content}

{currentPhase} Output:
{phaseOutput}

Questions:
1. Does this align with the design decisions?
2. Are there any additions not in the original design?
3. Are there any omissions from the design?

If aligned, respond: ALIGNED
If drift detected, respond with:
DRIFT DETECTED
What changed: [list]
Pros: [list]
Cons: [list]
Suggestion: [recommendation]
```

### Step 3: Evaluate Response

**If ALIGNED:**

```
[checkmark] {currentPhase} phase aligned with design

Continuing to next phase...
```

Return: `{ aligned: true }`

### Step 4: Handle Drift

**If DRIFT DETECTED:**

Parse the drift details and present to user:

```
[warning] Drift detected in {currentPhase} phase

**What changed:**
- [Change 1]
- [Change 2]
- [Change N]

**Pros of accepting:**
- [Pro 1]
- [Pro 2]

**Cons of accepting:**
- [Con 1]
- [Con 2]

**Suggestion:** [recommendation]
```

### Step 5: Ask User Decision

Present options:

```
How would you like to handle this drift?

1. Accept - return to brainstorming to update design
2. Reject - redo this phase
3. Partial - specify what to keep
```

**Option descriptions:**
- **1 (Accept)**: Updates design doc with the drift, sets state.phase = "brainstorming", returns to design phase to formalize changes
- **2 (Reject)**: Discards the phase output, returns signal to redo the phase, implementation must match original design
- **3 (Partial)**: Asks user what to keep/discard, allows selective acceptance of changes

### Step 6: Execute User Choice

**On Accept:**

```javascript
// Update state to brainstorming
state = read_state(SESSION_PATH)
state.phase = "brainstorming"
state.lastAction = {
  type: "drift_accepted",
  details: drift.what_changed,
  timestamp: now_iso8601()
}
write_state(SESSION_PATH, state)
```

Return: `{ aligned: false, userChoice: "accept" }`

Output:
```
Returning to brainstorming phase to update design document.
Update the design to reflect the accepted changes.
```

**On Reject:**

Return: `{ aligned: false, userChoice: "reject" }`

Output:
```
Redoing {currentPhase} phase.
The phase output must align with the original design.
```

**On Partial:**

Ask: "What specific changes should be kept/discarded?"

Return: `{ aligned: false, userChoice: "partial", spec: partial_spec }`

## Drift Detection Patterns

The skill looks for these types of drift:

| Type | Example |
|------|---------|
| **Addition** | New function not in design |
| **Omission** | Missing required interface |
| **Modification** | Changed function signature |
| **Reordering** | Different dependency structure |
| **Renaming** | Different names for same concepts |

## Error Handling

**No design document found:**
```
Design document not found.
Cannot verify phase alignment without a design document.
Ensure brainstorming has created the design document first.
```

**No phase output provided:**
```
No phase output provided for verification.
Ensure the rough-draft phase has produced output before calling verify-phase.
```

**Invalid phase specified:**
```
Invalid phase: {phase}
Valid phases are: INTERFACE, PSEUDOCODE, SKELETON
```

## Integration

**Called by:**
- **rough-draft** skill - After each phase completion (INTERFACE, PSEUDOCODE, SKELETON)

**Transitions to:**
- **brainstorming** - If drift is accepted (to update design)
- **Current phase redo** - If drift is rejected
- **Next phase** - If aligned

**Related skills:**
- **brainstorming** - Where design decisions are made
- **rough-draft** - The calling skill
- **ready-to-implement** - Validates complete design before implementation

**Collab Workflow Chain:**
```
collab --> brainstorming --> rough-draft [verify-phase] --> executing-plans
                               ^             ^
                        (each phase)  (you are here)
```

This skill acts as a checkpoint between rough-draft phases, ensuring implementation plans don't drift from the original design decisions.

## Quick Reference

```
verify-phase(currentPhase, phaseOutput)

1. Reads design document from session
2. Compares phase output against design
3. If aligned: returns success, proceed to next phase
4. If drift: presents changes with pros/cons
5. User chooses: 1. Accept / 2. Reject / 3. Partial
6. Executes choice and returns signal
```
