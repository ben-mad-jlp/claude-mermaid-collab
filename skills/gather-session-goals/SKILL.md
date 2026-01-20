---
name: gather-session-goals
description: "Collect and classify work items at the start of a collab session. Invoked by collab skill after creating a new session."
---

# Gather Session Goals

## Overview

Collect and classify work items at the start of a collab session through iterative questioning.

**Invoked by:** collab skill after creating a new session

**Returns to:** collab skill (which manages the work item loop)

## Collab Session Required

Before proceeding, check for active collab session:

1. Check if `.collab/` directory exists
2. Check if any session folders exist within
3. If no session found:
   ```
   No active collab session found.

   Use /collab to start a session first.
   ```
   **STOP** - do not proceed with this skill.

4. If multiple sessions exist, check `COLLAB_SESSION_PATH` env var or ask user which session.

## The Process

### Step 1: Open Question

Ask the user: **"What do you want to accomplish this session?"**

Store the initial response. Parse any items mentioned and add them to the work items list with type = "unknown".

### Step 2: Explore Iteratively

Ask targeted follow-up questions **one at a time** (never batch):

1. "Any bugs you're trying to fix?"
   - If user mentions bugs, add each as type = "bugfix"

2. "Any new features to add?"
   - If user mentions features, add each as type = "feature"

3. "Any code to refactor or clean up?"
   - If user mentions refactors, add each as type = "refactor"

4. "Any unknowns to investigate?"
   - If user mentions spikes, add each as type = "spike"

### Step 3: Classify Unknown Items

For each item still marked as type = "unknown":

Ask: **"What type is '[item title]'? (feature/bugfix/refactor/spike)"**

Set the item type based on user response.

### Step 4: Present Summary

Display the work items for confirmation:

```
Here are the work items for this session:

1. [bugfix] Fix login redirect issue
2. [feature] Add user authentication
3. [refactor] Clean up database layer

Does this list look correct? (yes / add more / remove / edit)
```

**Handle user responses:**
- **"yes"** - Proceed to Step 5
- **"add more"** - Return to Step 2
- **"remove"** - Ask which item to remove, remove it, return to Step 4
- **"edit"** - Ask which item to edit, update it, return to Step 4

### Step 5: Write to Design Doc

Read the current design doc at `.collab/<session>/documents/design.md`.

Write the Work Items section:

```markdown
## Work Items

### Item 1: <title>
**Type:** <feature|bugfix|refactor|spike>
**Status:** pending
**Problem/Goal:**

**Approach:**

**Root Cause:** (only if type is bugfix)

**Success Criteria:**

**Decisions:**

---

### Item 2: <title>
...
```

After writing, display:

```
Work items written to design doc. Returning to collab workflow.
```

Return control to the collab skill.

## Key Constraints

- **One question at a time** - Never batch multiple questions together
- **Don't skip classification** - Every item must have a type before proceeding
- **Must get explicit confirmation** - User must approve the list before writing to design doc

## Contract

**Preconditions:**
- Collab session exists
- Design doc exists (may be empty template)

**Postconditions:**
- Design doc contains `## Work Items` section
- At least one work item defined
- All items have `Status: pending`
- User has confirmed the list

**Side effects:**
- Writes to design doc
- Does NOT modify collab-state.json (collab skill handles that)

## Integration

**Called by:**
- **collab** skill - After session creation

**Returns to:**
- **collab** skill - To start the work item loop
