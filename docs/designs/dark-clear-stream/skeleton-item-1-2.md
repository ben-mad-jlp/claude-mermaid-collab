# Skeleton: Items 1 & 2
## Add collab-compact at phase transitions + Verify invocations

[APPROVED]

## Planned Files

These are markdown skill files to be modified (not created):
- [ ] `skills/rough-draft/SKILL.md` - Add 3 compaction checkpoints
- [ ] `skills/brainstorming/transition.md` - Add pre-transition compaction
- [ ] `skills/rough-draft/handoff.md` - Add pre-implementation compaction

**Note:** These are MODIFICATIONS to existing files, documented here. Changes will be applied during implementation by executing-plans.

## File Contents

### Modification: skills/rough-draft/SKILL.md

**Insert after "## Phase 1: Interface" section (before "## Phase 2: Pseudocode"):**

```markdown
---

### Compaction Checkpoint: Interface → Pseudocode

After Interface phase completes and is approved:

Ask user: "Ready to compact context before Pseudocode phase?"

```
1. Yes - compact now
2. No - continue without compaction
```

- If **1 (Yes)**: Invoke skill: collab-compact, then continue to Pseudocode
- If **2 (No)**: Continue to Pseudocode without compaction

---
```

**Insert after "## Phase 2: Pseudocode" section (before "## Phase 3: Skeleton"):**

```markdown
---

### Compaction Checkpoint: Pseudocode → Skeleton

After Pseudocode phase completes and is approved:

Ask user: "Ready to compact context before Skeleton phase?"

```
1. Yes - compact now
2. No - continue without compaction
```

- If **1 (Yes)**: Invoke skill: collab-compact, then continue to Skeleton
- If **2 (No)**: Continue to Skeleton without compaction

---
```

**Insert after "## Phase 3: Skeleton" section (before "## Phase 4: Implementation Handoff"):**

```markdown
---

### Compaction Checkpoint: Skeleton → Implementation

After Skeleton phase completes and is approved:

Ask user: "Ready to compact context before Implementation?"

```
1. Yes - compact now
2. No - continue without compaction
```

- If **1 (Yes)**: Invoke skill: collab-compact, then continue to Implementation Handoff
- If **2 (No)**: Continue to Implementation Handoff without compaction

---
```

### Modification: skills/brainstorming/transition.md

**Append to end of file:**

```markdown
---

### Pre-Transition Compaction

Before transitioning to rough-draft:

Ask user: "Compact context before starting rough-draft?"

```
1. Yes
2. No
```

- If **1 (Yes)**: Invoke skill: collab-compact, wait for completion, then invoke rough-draft
- If **2 (No)**: Invoke rough-draft directly
```

### Modification: skills/rough-draft/handoff.md

**Insert before the section that invokes executing-plans:**

```markdown
---

### Pre-Implementation Compaction

Before transitioning to implementation:

Ask user: "Compact context before starting implementation?"

```
1. Yes
2. No
```

- If **1 (Yes)**: Invoke skill: collab-compact, wait for completion, then invoke executing-plans
- If **2 (No)**: Invoke executing-plans directly
```

## Task Dependency Graph

```yaml
tasks:
  - id: rough-draft-compaction-1
    files: [skills/rough-draft/SKILL.md]
    description: Add Interface→Pseudocode compaction checkpoint
    parallel: true

  - id: rough-draft-compaction-2
    files: [skills/rough-draft/SKILL.md]
    description: Add Pseudocode→Skeleton compaction checkpoint
    depends-on: [rough-draft-compaction-1]

  - id: rough-draft-compaction-3
    files: [skills/rough-draft/SKILL.md]
    description: Add Skeleton→Implementation compaction checkpoint
    depends-on: [rough-draft-compaction-2]

  - id: brainstorming-compaction
    files: [skills/brainstorming/transition.md]
    description: Add pre-rough-draft compaction
    parallel: true

  - id: handoff-compaction
    files: [skills/rough-draft/handoff.md]
    description: Add pre-implementation compaction
    parallel: true
```

## Execution Order

**Wave 1 (parallel):**
- rough-draft-compaction-1 (first checkpoint)
- brainstorming-compaction
- handoff-compaction

**Wave 2 (sequential on SKILL.md):**
- rough-draft-compaction-2

**Wave 3 (sequential on SKILL.md):**
- rough-draft-compaction-3

## Verification

- [ ] 3 compaction checkpoints visible in rough-draft/SKILL.md
- [ ] 1 compaction checkpoint visible in brainstorming/transition.md
- [ ] 1 compaction checkpoint visible in rough-draft/handoff.md
- [ ] Each checkpoint has consistent format (1. Yes / 2. No)
- [ ] Each checkpoint invokes collab-compact skill
