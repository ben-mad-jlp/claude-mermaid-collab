# Interface Definition: Item 3
## Refactor skills that reference md files into separate skills

[APPROVED]

### File Structure

**New skill folders to create (13 total):**

```
skills/
├── collab-session-mgmt/
│   ├── skill.yaml
│   └── SKILL.md
├── collab-work-item-loop/
│   ├── skill.yaml
│   └── SKILL.md
├── brainstorming-exploring/
│   ├── skill.yaml
│   └── SKILL.md
├── brainstorming-clarifying/
│   ├── skill.yaml
│   └── SKILL.md
├── brainstorming-designing/
│   ├── skill.yaml
│   └── SKILL.md
├── brainstorming-validating/
│   ├── skill.yaml
│   └── SKILL.md
├── brainstorming-transition/
│   ├── skill.yaml
│   └── SKILL.md
├── rough-draft-interface/
│   ├── skill.yaml
│   └── SKILL.md
├── rough-draft-pseudocode/
│   ├── skill.yaml
│   └── SKILL.md
├── rough-draft-skeleton/
│   ├── skill.yaml
│   └── SKILL.md
├── rough-draft-handoff/
│   ├── skill.yaml
│   └── SKILL.md
├── executing-plans-execution/
│   ├── skill.yaml
│   └── SKILL.md
└── executing-plans-review/
    ├── skill.yaml
    └── SKILL.md
```

**Parent skills to modify:**
- `skills/collab/SKILL.md` - Update to invoke collab-session-mgmt, collab-work-item-loop
- `skills/brainstorming/SKILL.md` - Update to invoke brainstorming-* sub-skills
- `skills/rough-draft/SKILL.md` - Update to invoke rough-draft-* sub-skills
- `skills/executing-plans/SKILL.md` - Update to invoke executing-plans-* sub-skills

### Type Definitions

#### skill.yaml Structure (for each new skill)

```yaml
name: <prefix>-<name>
description: <description from source md file>
user-invocable: false
allowed-tools:
  - Read
  - Glob
  - Grep
  - mcp__plugin_mermaid-collab_mermaid__*
```

#### Source File Mapping

| New Skill | Source File |
|-----------|-------------|
| collab-session-mgmt | skills/collab/session-mgmt.md |
| collab-work-item-loop | skills/collab/work-item-loop.md |
| brainstorming-exploring | skills/brainstorming/exploring.md |
| brainstorming-clarifying | skills/brainstorming/clarifying.md |
| brainstorming-designing | skills/brainstorming/designing.md |
| brainstorming-validating | skills/brainstorming/validating.md |
| brainstorming-transition | skills/brainstorming/transition.md |
| rough-draft-interface | skills/rough-draft/interface.md |
| rough-draft-pseudocode | skills/rough-draft/pseudocode.md |
| rough-draft-skeleton | skills/rough-draft/skeleton.md |
| rough-draft-handoff | skills/rough-draft/handoff.md |
| executing-plans-execution | skills/executing-plans/execution.md |
| executing-plans-review | skills/executing-plans/review.md |

### Function Signatures (Parent Skill Invocations)

#### collab/SKILL.md

```markdown
# Before
**For detailed instructions, see [session-mgmt.md](session-mgmt.md).**

# After
**Invoke skill:** collab-session-mgmt
```

```markdown
# Before
**For detailed instructions, see [work-item-loop.md](work-item-loop.md).**

# After
**Invoke skill:** collab-work-item-loop
```

#### brainstorming/SKILL.md

```markdown
# Before
**For detailed instructions, see [exploring.md](exploring.md).**

# After
**Invoke skill:** brainstorming-exploring
```

(Same pattern for clarifying, designing, validating, transition)

#### rough-draft/SKILL.md

```markdown
# Before
**For detailed instructions, see [Interface Phase](interface.md).**

# After
**Invoke skill:** rough-draft-interface
```

(Same pattern for pseudocode, skeleton, handoff)

#### executing-plans/SKILL.md

```markdown
# Before
**For detailed instructions, see [execution.md](execution.md).**

# After
**Invoke skill:** executing-plans-execution
```

(Same pattern for review)

### Component Interactions

```
collab/SKILL.md (orchestrator)
    |
    +-- Invoke: collab-session-mgmt
    +-- Invoke: collab-work-item-loop
    |
    v
brainstorming/SKILL.md (orchestrator)
    |
    +-- Invoke: brainstorming-exploring
    +-- Invoke: brainstorming-clarifying
    +-- Invoke: brainstorming-designing
    +-- Invoke: brainstorming-validating
    +-- Invoke: brainstorming-transition
    |
    v
rough-draft/SKILL.md (orchestrator)
    |
    +-- Invoke: rough-draft-interface
    +-- Invoke: rough-draft-pseudocode
    +-- Invoke: rough-draft-skeleton
    +-- Invoke: rough-draft-handoff
    |
    v
executing-plans/SKILL.md (orchestrator)
    |
    +-- Invoke: executing-plans-execution
    +-- Invoke: executing-plans-review
```

### Verification Checklist

- [ ] 13 new skill folders created
- [ ] Each has skill.yaml with user-invocable: false
- [ ] Each has SKILL.md with content from source md file
- [ ] Parent skills updated with "Invoke skill:" pattern
- [ ] Old md files can be deleted after verification
- [ ] Sub-skills load correctly when invoked
