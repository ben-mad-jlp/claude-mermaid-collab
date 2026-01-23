# Interface Definition: Items 1 & 2
## Add collab-compact at phase transitions + Verify invocations

[APPROVED]

### File Structure

Files to modify:
- `skills/rough-draft/SKILL.md` - Add compaction prompts at phase transitions
- `skills/brainstorming/transition.md` - Add compaction before rough-draft
- `skills/rough-draft/handoff.md` - Add compaction before executing-plans

### Interface Changes

These are markdown skill files, not TypeScript. The "interface" is the instruction structure.

#### rough-draft/SKILL.md Changes

**Location:** After each phase verification gate (3 locations)

**Pattern to insert at each phase boundary:**

```markdown
### Compaction Checkpoint

After [PHASE] phase completes:

Ask user: "Ready to compact before [NEXT_PHASE]?"

```
1. Yes - compact now
2. No - continue without compaction
```

- If **1 (Yes)**: Invoke skill: collab-compact, then continue to [NEXT_PHASE]
- If **2 (No)**: Continue to [NEXT_PHASE] without compaction
```

**3 insertion points:**
1. After Interface phase verification → before Pseudocode
2. After Pseudocode phase verification → before Skeleton  
3. After Skeleton phase verification → before Implementation Handoff

#### brainstorming/transition.md Changes

**Location:** Before invoking rough-draft skill

**Pattern to insert:**

```markdown
### Pre-Transition Compaction

Before transitioning to rough-draft:

Ask user: "Compact context before starting rough-draft?"

```
1. Yes
2. No
```

- If **1 (Yes)**: Invoke skill: collab-compact, then invoke rough-draft
- If **2 (No)**: Invoke rough-draft directly
```

#### rough-draft/handoff.md Changes

**Location:** Before invoking executing-plans skill

**Pattern to insert:**

```markdown
### Pre-Implementation Compaction

Before transitioning to implementation:

Ask user: "Compact context before starting implementation?"

```
1. Yes
2. No
```

- If **1 (Yes)**: Invoke skill: collab-compact, then invoke executing-plans
- If **2 (No)**: Invoke executing-plans directly
```

### Component Interactions

```
rough-draft/SKILL.md
    |
    +-- Phase 1 complete --> Compaction prompt --> collab-compact skill
    +-- Phase 2 complete --> Compaction prompt --> collab-compact skill
    +-- Phase 3 complete --> Compaction prompt --> collab-compact skill
    |
    v
rough-draft/handoff.md
    |
    +-- Pre-implementation --> Compaction prompt --> collab-compact skill
    |
    v
executing-plans
```

### Verification Checklist

- [ ] 3 compaction checkpoints added to rough-draft/SKILL.md
- [ ] 1 compaction checkpoint added to brainstorming/transition.md
- [ ] 1 compaction checkpoint added to rough-draft/handoff.md
- [ ] Each checkpoint uses consistent prompt format
- [ ] Each checkpoint invokes collab-compact skill (not inline save)
