# Skill Interfaces

## Overview

This document defines the interfaces (inputs, outputs, contracts) for each skill in the collab workflow redesign.

---

## 1. gather-session-goals

### Input
- Active collab session (folder exists at `.collab/<session-name>/`)
- Empty or minimal design doc at `.collab/<session-name>/documents/design.md`

### Output
- Design doc populated with Work Items section
- Each item has: Title, Type, Status (pending), empty fields for Problem/Goal, Approach, etc.

### Contract
```
PRECONDITIONS:
- Collab session exists
- Design doc exists (may be empty template)

POSTCONDITIONS:
- Design doc contains ## Work Items section
- At least one work item defined
- All items have Status: pending
- User has confirmed the list

SIDE EFFECTS:
- Writes to design doc
- Does NOT modify collab-state.json (collab skill handles that)
```

### Invocation
```
Called by: collab skill (after session creation)
Returns to: collab skill (to start work item loop)
```

---

## 2. collab (Work Item Loop)

### Input
- Session name (from user selection or new creation)
- Design doc with Work Items section

### Output
- All work items processed (Status: documented)
- Control passed to ready-to-implement

### Contract
```
PRECONDITIONS:
- Server running
- Session exists or will be created

POSTCONDITIONS (new session):
- Session folder created
- gather-session-goals invoked
- Work item loop processes all items
- ready-to-implement invoked when loop completes

POSTCONDITIONS (resume):
- ready-to-implement invoked immediately
- If pending items exist, loop continues
- If all documented, proceeds to rough-draft
```

### Work Item Loop Interface
```
function processWorkItemLoop():
  while true:
    item = findFirstPendingItem(designDoc)
    if item == null:
      break  # All done
    
    if item.type == "bugfix":
      invokeSkill("systematic-debugging", item)
    else:
      invokeSkill("brainstorming", item)
    
    updateItemStatus(item, "documented")
  
  invokeSkill("ready-to-implement")
```

### State Updates
- Sets `currentItem` in collab-state.json during processing
- Clears `currentItem` when loop completes

---

## 3. systematic-debugging (Investigation-Only)

### Input
- Active collab session
- Current work item (from collab skill context)
- Item type must be "bugfix"

### Output
- Work item updated with:
  - Root Cause (filled)
  - Approach (filled)
  - Success Criteria (filled)

### Contract
```
PRECONDITIONS:
- Collab session active
- Work item exists with Type: bugfix
- Item Status: pending

POSTCONDITIONS:
- Root Cause field populated
- Approach field populated (fix strategy, not implementation)
- Success Criteria field populated
- NO code changes made
- NO fixes implemented

PROHIBITED:
- Edit tool on source files
- Write tool on source files
- Any code modifications
```

### Invocation
```
Called by: collab skill (work item loop)
Returns to: collab skill (loop continues)
```

---

## 4. brainstorming (Within Collab)

### Input
- Active collab session
- Current work item (from collab skill context)
- Item type: feature, refactor, or spike

### Output
- Work item updated with:
  - Problem/Goal (filled)
  - Approach (filled)
  - Success Criteria (filled)
  - Decisions (if any)

### Contract
```
PRECONDITIONS:
- Collab session active
- Work item exists with Type: feature|refactor|spike
- Item Status: pending

POSTCONDITIONS:
- Problem/Goal field populated
- Approach field populated
- Success Criteria field populated
- Follows brainstorming phases (EXPLORING → CLARIFYING → DESIGNING → VALIDATING)
- Returns when item is fully documented
```

### Invocation
```
Called by: collab skill (work item loop)
Returns to: collab skill (loop continues)
```

---

## 5. Collab-Required Check (Shared Pattern)

### Interface
```
function checkCollabSession():
  if not exists(".collab/"):
    error("⚠️ No active collab session found.\n\nUse /collab to start a session first.")
    STOP
  
  sessions = listDirectories(".collab/")
  if sessions.length == 0:
    error("⚠️ No active collab session found.\n\nUse /collab to start a session first.")
    STOP
  
  if sessions.length == 1:
    return sessions[0]
  
  if env.COLLAB_SESSION_PATH:
    return parseSessionFromPath(env.COLLAB_SESSION_PATH)
  
  return askUser("Multiple sessions found. Which one?", sessions)
```

### Skills That Use This
- brainstorming
- systematic-debugging
- rough-draft
- ready-to-implement
- executing-plans
- gather-session-goals

### Skills That Don't Use This
- collab (it's the entry point)

---

## 6. ready-to-implement

### Input
- Active collab session
- Design doc with Work Items section

### Output
- If pending items: returns to collab for more loop iterations
- If all documented: proceeds to rough-draft (on user confirmation)

### Contract
```
PRECONDITIONS:
- Collab session active
- Design doc exists with Work Items

POSTCONDITIONS (pending items):
- Lists incomplete items
- Returns control to collab skill
- Does NOT change phase

POSTCONDITIONS (all documented):
- Shows summary of documented items
- On user confirmation: updates phase to rough-draft/interface
- Invokes rough-draft skill
```

### Interface
```
function checkReadiness():
  items = parseWorkItems(designDoc)
  pending = items.filter(i => i.status == "pending")
  documented = items.filter(i => i.status == "documented")
  
  if pending.length > 0:
    display("Work items still need documentation:")
    for item in pending:
      display(f"- [ ] {item.title} (pending)")
    return { ready: false, action: "return_to_loop" }
  
  display("All work items documented:")
  for item in documented:
    display(f"- [x] {item.title} (documented)")
  
  if userConfirms("Ready to proceed to rough-draft?"):
    updatePhase("rough-draft/interface")
    return { ready: true, action: "invoke_rough_draft" }
  else:
    return { ready: false, action: "return_to_loop" }
```

---

## Control Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         /collab                                  │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────┐ │
│  │ Check Server │───▶│ Create/Resume    │───▶│ NEW: gather-   │ │
│  └─────────────┘    │ Session          │    │ session-goals  │ │
│                     └──────────────────┘    └───────┬────────┘ │
│                                                     │          │
│  ┌──────────────────────────────────────────────────▼────────┐ │
│  │                    WORK ITEM LOOP                          │ │
│  │  ┌─────────────┐                                          │ │
│  │  │ Next item?  │──No──▶ ready-to-implement ──▶ rough-draft│ │
│  │  └──────┬──────┘                     ▲                    │ │
│  │         │ Yes                        │ (if pending)       │ │
│  │         ▼                            │                    │ │
│  │  ┌─────────────┐                     │                    │ │
│  │  │ Route by    │                     │                    │ │
│  │  │ type        │                     │                    │ │
│  │  └──────┬──────┘                     │                    │ │
│  │         │                            │                    │ │
│  │    ┌────┴────┐                       │                    │ │
│  │    ▼         ▼                       │                    │ │
│  │ bugfix    feature/                   │                    │ │
│  │    │      refactor/                  │                    │ │
│  │    │      spike                      │                    │ │
│  │    ▼         ▼                       │                    │ │
│  │ systematic  brainstorming            │                    │ │
│  │ -debugging     │                     │                    │ │
│  │    │           │                     │                    │ │
│  │    └─────┬─────┘                     │                    │ │
│  │          ▼                           │                    │ │
│  │    Mark item                         │                    │ │
│  │    documented ───────────────────────┘                    │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `skills/gather-session-goals/SKILL.md` | NEW | Collect and classify work items |
| `skills/collab/SKILL.md` | MODIFY | Add work item loop, change resume flow |
| `skills/systematic-debugging/SKILL.md` | MODIFY | Add investigation-only constraint, collab check |
| `skills/brainstorming/SKILL.md` | MODIFY | Add collab check, per-item focus |
| `skills/ready-to-implement/SKILL.md` | MODIFY | Parse new doc structure, central checkpoint |
| `skills/rough-draft/SKILL.md` | MODIFY | Add collab check only |
| `skills/executing-plans/SKILL.md` | MODIFY | Add collab check only |