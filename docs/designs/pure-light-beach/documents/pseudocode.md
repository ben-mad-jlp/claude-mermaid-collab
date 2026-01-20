# Skill Pseudocode

## 1. gather-session-goals/SKILL.md

```
SKILL: gather-session-goals

## Collab Session Required
RUN checkCollabSession()  # Shared pattern

## Step 1: Open Question
ASK user: "What do you want to accomplish this session?"
STORE initial_response

## Step 2: Explore Iteratively
SET work_items = []

# Parse initial response for items
FOR each item mentioned in initial_response:
  ADD to work_items with type = "unknown"

# Ask targeted follow-ups (one at a time)
ASK: "Any bugs you're trying to fix?"
IF user mentions bugs:
  FOR each bug:
    ADD to work_items with type = "bugfix"

ASK: "Any new features to add?"
IF user mentions features:
  FOR each feature:
    ADD to work_items with type = "feature"

ASK: "Any code to refactor or clean up?"
IF user mentions refactors:
  FOR each refactor:
    ADD to work_items with type = "refactor"

ASK: "Any unknowns to investigate?"
IF user mentions spikes:
  FOR each spike:
    ADD to work_items with type = "spike"

## Step 3: Classify Unknown Items
FOR each item in work_items WHERE type == "unknown":
  ASK user: "What type is '{item.title}'? (feature/bugfix/refactor/spike)"
  SET item.type = user_response

## Step 4: Present Summary
DISPLAY:
  "Here are the work items for this session:"
  FOR i, item in enumerate(work_items):
    DISPLAY: "{i+1}. [{item.type}] {item.title}"

ASK: "Does this list look correct? (yes / add more / remove / edit)"

IF user says "add more":
  GOTO Step 2
IF user says "remove":
  ASK which item to remove
  REMOVE item
  GOTO Step 4
IF user says "edit":
  ASK which item to edit
  UPDATE item
  GOTO Step 4

## Step 5: Write to Design Doc
READ current design doc

WRITE Work Items section:
  "## Work Items\n\n"
  FOR i, item in enumerate(work_items):
    WRITE:
      "### Item {i+1}: {item.title}\n"
      "**Type:** {item.type}\n"
      "**Status:** pending\n"
      "**Problem/Goal:**\n\n"
      "**Approach:**\n\n"
      IF item.type == "bugfix":
        "**Root Cause:**\n\n"
      "**Success Criteria:**\n\n"
      "**Decisions:**\n\n"
      "---\n\n"

DISPLAY: "Work items written to design doc. Returning to collab workflow."
RETURN to collab skill
```

---

## 2. collab/SKILL.md (Work Item Loop Addition)

```
SKILL: collab

## Step 1: Check Server (unchanged)
...existing code...

## Step 2: Find Sessions (unchanged)
...existing code...

## Step 3: Create Session (modified)
IF creating new session:
  ...existing folder creation code...
  
  # NEW: Invoke gather-session-goals
  INVOKE skill: gather-session-goals
  
  # NEW: Enter work item loop
  GOTO WorkItemLoop

## Step 4: Resume Session (modified)
IF resuming existing session:
  # NEW: Always go through ready-to-implement
  INVOKE skill: ready-to-implement
  
  # ready-to-implement will either:
  # - Return with action "return_to_loop" → GOTO WorkItemLoop
  # - Return with action "invoke_rough_draft" → END (rough-draft takes over)

## WorkItemLoop:
LOOP:
  # Read design doc
  READ .collab/<session>/documents/design.md
  
  # Parse work items
  items = parseWorkItems(design_doc)
  
  # Find first pending item
  pending_item = items.find(i => i.status == "pending")
  
  IF pending_item == null:
    # All items documented
    INVOKE skill: ready-to-implement
    BREAK
  
  # Update state with current item
  UPDATE collab-state.json:
    SET currentItem = pending_item.number
  
  # Route by type
  IF pending_item.type == "bugfix":
    DISPLAY: "Processing bugfix: {pending_item.title}"
    DISPLAY: "Invoking systematic-debugging for investigation..."
    INVOKE skill: systematic-debugging
    # Context: skill knows current item from state
  ELSE:
    # feature, refactor, or spike
    DISPLAY: "Processing {pending_item.type}: {pending_item.title}"
    DISPLAY: "Invoking brainstorming..."
    INVOKE skill: brainstorming
    # Context: skill knows current item from state
  
  # After skill returns, mark item as documented
  UPDATE design doc:
    SET pending_item.status = "documented"
  
  # Clear current item from state
  UPDATE collab-state.json:
    SET currentItem = null
  
  # Continue loop
  CONTINUE

# Helper function
FUNCTION parseWorkItems(doc):
  items = []
  FOR each "### Item N:" section in doc:
    item = {
      number: N,
      title: parse title,
      type: parse Type field,
      status: parse Status field
    }
    ADD item to items
  RETURN items
```

---

## 3. systematic-debugging/SKILL.md (Investigation-Only)

```
SKILL: systematic-debugging

## Collab Session Required
RUN checkCollabSession()  # Shared pattern

## Get Current Work Item
READ collab-state.json
current_item_num = state.currentItem
READ design doc
current_item = findItem(design_doc, current_item_num)

DISPLAY: "Investigating: {current_item.title}"

## Investigation Process (mostly unchanged)

### Step 1: Read Error Messages
...existing code for reading errors...

### Step 2: Reproduce
...existing code for reproduction...

### Step 3: Check Recent Changes
...existing code for git diff, etc...

### Step 4: Trace Data Flow
...existing code using root-cause-tracing.md...

### Step 5: Form Hypothesis
...existing hypothesis formation...

### Step 6: Test Hypothesis
# MODIFIED: Read-only testing only
DISPLAY: "Testing hypothesis with read-only checks..."
# Can run tests, add logging, inspect state
# CANNOT modify source files

### Step 7: Document Findings
IF root_cause_found:
  # Update the work item in design doc
  UPDATE design doc item {current_item_num}:
    SET "**Root Cause:**" = detailed explanation
    SET "**Approach:**" = proposed fix strategy
    SET "**Success Criteria:**" = verification steps
  
  DISPLAY:
    "Root cause documented."
    "Proposed fix approach documented."
    "DO NOT IMPLEMENT - fixes happen in implementation phase."
  
  RETURN to collab skill

IF hypothesis_failed AND attempts >= 3:
  DISPLAY:
    "⚠️ 3+ hypotheses failed."
    "STOP: Question the architecture."
    "Discuss with human before proceeding."
  
  ASK user for guidance
  # May revise approach or document as "needs architecture review"

## EXPLICIT PROHIBITION
⚠️ The following are FORBIDDEN in this skill:
- Using Edit tool on source files (except design doc)
- Using Write tool on source files
- Making any code changes to fix the bug
- Implementing the fix

Fixes are implemented later via rough-draft → executing-plans.
```

---

## 4. brainstorming/SKILL.md (Per-Item Focus)

```
SKILL: brainstorming

## Collab Session Required
RUN checkCollabSession()  # Shared pattern - ADD THIS

## Get Current Work Item (NEW)
READ collab-state.json
IF state.currentItem exists:
  # Called from work item loop - focus on single item
  current_item_num = state.currentItem
  READ design doc
  current_item = findItem(design_doc, current_item_num)
  mode = "single_item"
ELSE:
  # Standalone invocation (shouldn't happen with collab-required)
  mode = "full_session"

## Phase State Machine (modified for single item)

IF mode == "single_item":
  DISPLAY: "Brainstorming: {current_item.title} ({current_item.type})"
  
  ### EXPLORING (scoped to item)
  DISPLAY: "EXPLORING - Gathering context for this item..."
  # Read relevant files based on item description
  # Check git history for related changes
  
  ### CLARIFYING (scoped to item)
  DISPLAY: "CLARIFYING - Let's discuss this item..."
  ASK questions about this specific item (one at a time)
  ASK: "Is there anything else about this item?"
  
  ### DESIGNING (scoped to item)
  DISPLAY: "DESIGNING - Documenting the approach..."
  
  # Update the work item in design doc
  WRITE to design doc item {current_item_num}:
    "**Problem/Goal:**" = documented problem/goal
    "**Approach:**" = documented approach
    "**Success Criteria:**" = documented criteria
    "**Decisions:**" = any item-specific decisions
  
  ### VALIDATING (for this item)
  CHECK item has:
    - Problem/Goal filled
    - Approach filled
    - Success Criteria filled
  
  IF validation passes:
    DISPLAY: "Item documented. Returning to work item loop."
    RETURN to collab skill
  ELSE:
    DISPLAY: "Missing: {missing_fields}"
    GOTO DESIGNING

ELSE:
  # Full session mode (existing behavior)
  ...existing brainstorming phases...
```

---

## 5. Collab-Required Check (Shared Pattern)

```
## Collab Session Required

# Add this section at the TOP of each skill that requires collab

FUNCTION checkCollabSession():
  # Check .collab directory exists
  IF NOT exists(".collab/"):
    DISPLAY:
      "⚠️ No active collab session found."
      ""
      "Use /collab to start a session first."
    STOP - do not proceed
  
  # Check for session folders
  sessions = listDirectories(".collab/")
  IF sessions.length == 0:
    DISPLAY:
      "⚠️ No active collab session found."
      ""
      "Use /collab to start a session first."
    STOP - do not proceed
  
  # Single session - use it
  IF sessions.length == 1:
    RETURN sessions[0]
  
  # Multiple sessions - check env var
  IF env.COLLAB_SESSION_PATH exists:
    session_name = parseSessionName(env.COLLAB_SESSION_PATH)
    IF session_name in sessions:
      RETURN session_name
  
  # Multiple sessions - ask user
  ASK user: "Multiple sessions found. Which one?"
  OPTIONS: sessions
  RETURN user_selection
```

---

## 6. ready-to-implement/SKILL.md

```
SKILL: ready-to-implement

## Collab Session Required
RUN checkCollabSession()  # Shared pattern

## Step 1: Read Design Doc
session = getActiveSession()
READ .collab/{session}/documents/design.md

## Step 2: Parse Work Items (NEW LOGIC)
items = []
FOR each "### Item N:" section in design_doc:
  item = {
    number: N,
    title: parseTitle(section),
    type: parseField(section, "Type"),
    status: parseField(section, "Status")
  }
  ADD item to items

## Step 3: Check Status (NEW LOGIC)
pending = items.filter(i => i.status == "pending")
documented = items.filter(i => i.status == "documented")

## Step 4: Report Results
IF pending.length > 0:
  DISPLAY:
    "Work items still need documentation:"
    ""
  FOR item in pending:
    DISPLAY: "- [ ] Item {item.number}: {item.title} (pending)"
  
  DISPLAY:
    ""
    "Returning to work item loop..."
  
  # Return to collab skill to continue loop
  RETURN { action: "return_to_loop" }

ELSE:
  DISPLAY:
    "All work items documented:"
    ""
  FOR item in documented:
    DISPLAY: "- [x] Item {item.number}: {item.title} (documented)"
  
  DISPLAY: ""
  ASK: "Ready to proceed to rough-draft? (y/n)"
  
  IF user confirms:
    # Update state
    UPDATE .collab/{session}/collab-state.json:
      SET phase = "rough-draft/interface"
      SET lastActivity = now()
    
    DISPLAY:
      "Transitioning to rough-draft phase..."
    
    INVOKE skill: rough-draft
    RETURN { action: "invoke_rough_draft" }
  
  ELSE:
    DISPLAY: "Returning to work item loop for more work..."
    RETURN { action: "return_to_loop" }

## Helper Functions
FUNCTION parseField(section, fieldName):
  # Find line starting with "**{fieldName}:**"
  # Return value after the colon
  MATCH regex: /\*\*{fieldName}:\*\*\s*(.+)/
  RETURN match[1].trim()
```

---

## 7. rough-draft/SKILL.md and executing-plans/SKILL.md

```
# These skills only need the collab-required check added

## Collab Session Required
RUN checkCollabSession()  # ADD THIS at top

# Rest of skill unchanged
...existing content...
```