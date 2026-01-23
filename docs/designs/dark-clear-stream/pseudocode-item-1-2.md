# Pseudocode: Items 1 & 2
## Add collab-compact at phase transitions + Verify invocations

[APPROVED]

These are markdown skill file edits, not code. Pseudocode describes the edit logic.

---

### Edit: rough-draft/SKILL.md

**Location 1: After Interface Phase (before Pseudocode)**

```
FIND section containing:
  "## Phase 2: Pseudocode"

INSERT BEFORE that section:
  ---
  
  ### Compaction Checkpoint: Interface → Pseudocode
  
  After Interface phase completes and is approved:
  
  Ask user: "Ready to compact context before Pseudocode phase?"
  
  Options:
  1. Yes - compact now
  2. No - continue without compaction
  
  - If **1 (Yes)**: Invoke skill: collab-compact, then continue to Pseudocode
  - If **2 (No)**: Continue to Pseudocode without compaction
  
  ---
```

**Location 2: After Pseudocode Phase (before Skeleton)**

```
FIND section containing:
  "## Phase 3: Skeleton"

INSERT BEFORE that section:
  ---
  
  ### Compaction Checkpoint: Pseudocode → Skeleton
  
  After Pseudocode phase completes and is approved:
  
  Ask user: "Ready to compact context before Skeleton phase?"
  
  Options:
  1. Yes - compact now
  2. No - continue without compaction
  
  - If **1 (Yes)**: Invoke skill: collab-compact, then continue to Skeleton
  - If **2 (No)**: Continue to Skeleton without compaction
  
  ---
```

**Location 3: After Skeleton Phase (before Implementation Handoff)**

```
FIND section containing:
  "## Phase 4: Implementation Handoff"

INSERT BEFORE that section:
  ---
  
  ### Compaction Checkpoint: Skeleton → Implementation
  
  After Skeleton phase completes and is approved:
  
  Ask user: "Ready to compact context before Implementation?"
  
  Options:
  1. Yes - compact now
  2. No - continue without compaction
  
  - If **1 (Yes)**: Invoke skill: collab-compact, then continue to Implementation Handoff
  - If **2 (No)**: Continue to Implementation Handoff without compaction
  
  ---
```

---

### Edit: brainstorming/transition.md

```
FIND end of file (before any closing section)

APPEND:
  ---
  
  ### Pre-Transition Compaction
  
  Before transitioning to rough-draft:
  
  Ask user: "Compact context before starting rough-draft?"
  
  Options:
  1. Yes
  2. No
  
  - If **1 (Yes)**: Invoke skill: collab-compact, wait for completion, then invoke rough-draft
  - If **2 (No)**: Invoke rough-draft directly
```

---

### Edit: rough-draft/handoff.md

```
FIND section that invokes executing-plans
  (look for "Invoke skill: executing-plans" or similar)

INSERT BEFORE that invocation:
  ---
  
  ### Pre-Implementation Compaction
  
  Before transitioning to implementation:
  
  Ask user: "Compact context before starting implementation?"
  
  Options:
  1. Yes
  2. No
  
  - If **1 (Yes)**: Invoke skill: collab-compact, wait for completion, then invoke executing-plans
  - If **2 (No)**: Invoke executing-plans directly
```

---

### Error Handling

- If section markers not found: Report error, ask user to verify file structure
- If file doesn't exist: Report error, this is a critical failure

### Edge Cases

- Multiple "## Phase" headings: Use the first occurrence of exact match
- File already has compaction checkpoints: Skip (idempotent operation)

### Dependencies

- `collab-compact` skill must exist and be invocable
- Skill tool must be available to invoke sub-skills
