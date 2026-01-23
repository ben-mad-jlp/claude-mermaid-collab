# Skeleton: Item 3
## Refactor skills that reference md files into separate skills

[APPROVED]

## Planned Files

**13 new skill folders to create:**
- [ ] `skills/collab-session-mgmt/skill.yaml`
- [ ] `skills/collab-session-mgmt/SKILL.md`
- [ ] `skills/collab-work-item-loop/skill.yaml`
- [ ] `skills/collab-work-item-loop/SKILL.md`
- [ ] `skills/brainstorming-exploring/skill.yaml`
- [ ] `skills/brainstorming-exploring/SKILL.md`
- [ ] `skills/brainstorming-clarifying/skill.yaml`
- [ ] `skills/brainstorming-clarifying/SKILL.md`
- [ ] `skills/brainstorming-designing/skill.yaml`
- [ ] `skills/brainstorming-designing/SKILL.md`
- [ ] `skills/brainstorming-validating/skill.yaml`
- [ ] `skills/brainstorming-validating/SKILL.md`
- [ ] `skills/brainstorming-transition/skill.yaml`
- [ ] `skills/brainstorming-transition/SKILL.md`
- [ ] `skills/rough-draft-interface/skill.yaml`
- [ ] `skills/rough-draft-interface/SKILL.md`
- [ ] `skills/rough-draft-pseudocode/skill.yaml`
- [ ] `skills/rough-draft-pseudocode/SKILL.md`
- [ ] `skills/rough-draft-skeleton/skill.yaml`
- [ ] `skills/rough-draft-skeleton/SKILL.md`
- [ ] `skills/rough-draft-handoff/skill.yaml`
- [ ] `skills/rough-draft-handoff/SKILL.md`
- [ ] `skills/executing-plans-execution/skill.yaml`
- [ ] `skills/executing-plans-execution/SKILL.md`
- [ ] `skills/executing-plans-review/skill.yaml`
- [ ] `skills/executing-plans-review/SKILL.md`

**4 parent skills to modify:**
- [ ] `skills/collab/SKILL.md`
- [ ] `skills/brainstorming/SKILL.md`
- [ ] `skills/rough-draft/SKILL.md`
- [ ] `skills/executing-plans/SKILL.md`

**Note:** Files are documented but NOT created yet. They will be created during implementation.

## File Contents

### Template: skill.yaml (for all new skills)

```yaml
name: <skill-name>
description: <first-line-of-source-md>
user-invocable: false
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - AskUserQuestion
  - mcp__plugin_mermaid-collab_mermaid__*
```

### Template: SKILL.md (for all new skills)

Content copied from source `.md` file with header prepended.

### Parent Skill Modifications

**Pattern to find and replace:**

```
OLD: **For detailed instructions, see [<name>](<file>.md).**
NEW: **Invoke skill:** <prefix>-<name>
```

```
OLD: **For detailed instructions, see [<name> Phase](<file>.md).**
NEW: **Invoke skill:** <prefix>-<name>
```

## Task Dependency Graph

```yaml
tasks:
  # Collab sub-skills (parallel)
  - id: create-collab-session-mgmt
    files: [skills/collab-session-mgmt/skill.yaml, skills/collab-session-mgmt/SKILL.md]
    description: Create collab-session-mgmt skill from session-mgmt.md
    parallel: true

  - id: create-collab-work-item-loop
    files: [skills/collab-work-item-loop/skill.yaml, skills/collab-work-item-loop/SKILL.md]
    description: Create collab-work-item-loop skill from work-item-loop.md
    parallel: true

  # Brainstorming sub-skills (parallel)
  - id: create-brainstorming-exploring
    files: [skills/brainstorming-exploring/skill.yaml, skills/brainstorming-exploring/SKILL.md]
    description: Create brainstorming-exploring skill
    parallel: true

  - id: create-brainstorming-clarifying
    files: [skills/brainstorming-clarifying/skill.yaml, skills/brainstorming-clarifying/SKILL.md]
    description: Create brainstorming-clarifying skill
    parallel: true

  - id: create-brainstorming-designing
    files: [skills/brainstorming-designing/skill.yaml, skills/brainstorming-designing/SKILL.md]
    description: Create brainstorming-designing skill
    parallel: true

  - id: create-brainstorming-validating
    files: [skills/brainstorming-validating/skill.yaml, skills/brainstorming-validating/SKILL.md]
    description: Create brainstorming-validating skill
    parallel: true

  - id: create-brainstorming-transition
    files: [skills/brainstorming-transition/skill.yaml, skills/brainstorming-transition/SKILL.md]
    description: Create brainstorming-transition skill
    parallel: true

  # Rough-draft sub-skills (parallel)
  - id: create-rough-draft-interface
    files: [skills/rough-draft-interface/skill.yaml, skills/rough-draft-interface/SKILL.md]
    description: Create rough-draft-interface skill
    parallel: true

  - id: create-rough-draft-pseudocode
    files: [skills/rough-draft-pseudocode/skill.yaml, skills/rough-draft-pseudocode/SKILL.md]
    description: Create rough-draft-pseudocode skill
    parallel: true

  - id: create-rough-draft-skeleton
    files: [skills/rough-draft-skeleton/skill.yaml, skills/rough-draft-skeleton/SKILL.md]
    description: Create rough-draft-skeleton skill
    parallel: true

  - id: create-rough-draft-handoff
    files: [skills/rough-draft-handoff/skill.yaml, skills/rough-draft-handoff/SKILL.md]
    description: Create rough-draft-handoff skill
    parallel: true

  # Executing-plans sub-skills (parallel)
  - id: create-executing-plans-execution
    files: [skills/executing-plans-execution/skill.yaml, skills/executing-plans-execution/SKILL.md]
    description: Create executing-plans-execution skill
    parallel: true

  - id: create-executing-plans-review
    files: [skills/executing-plans-review/skill.yaml, skills/executing-plans-review/SKILL.md]
    description: Create executing-plans-review skill
    parallel: true

  # Parent skill updates (depend on sub-skills)
  - id: update-collab-parent
    files: [skills/collab/SKILL.md]
    description: Update collab to invoke sub-skills
    depends-on: [create-collab-session-mgmt, create-collab-work-item-loop]

  - id: update-brainstorming-parent
    files: [skills/brainstorming/SKILL.md]
    description: Update brainstorming to invoke sub-skills
    depends-on: [create-brainstorming-exploring, create-brainstorming-clarifying, create-brainstorming-designing, create-brainstorming-validating, create-brainstorming-transition]

  - id: update-rough-draft-parent
    files: [skills/rough-draft/SKILL.md]
    description: Update rough-draft to invoke sub-skills
    depends-on: [create-rough-draft-interface, create-rough-draft-pseudocode, create-rough-draft-skeleton, create-rough-draft-handoff]

  - id: update-executing-plans-parent
    files: [skills/executing-plans/SKILL.md]
    description: Update executing-plans to invoke sub-skills
    depends-on: [create-executing-plans-execution, create-executing-plans-review]
```

## Execution Order

**Wave 1 (all 13 new skills in parallel):**
- create-collab-session-mgmt
- create-collab-work-item-loop
- create-brainstorming-exploring
- create-brainstorming-clarifying
- create-brainstorming-designing
- create-brainstorming-validating
- create-brainstorming-transition
- create-rough-draft-interface
- create-rough-draft-pseudocode
- create-rough-draft-skeleton
- create-rough-draft-handoff
- create-executing-plans-execution
- create-executing-plans-review

**Wave 2 (parent updates, parallel among parents):**
- update-collab-parent
- update-brainstorming-parent
- update-rough-draft-parent
- update-executing-plans-parent

## Verification

- [ ] 13 new skill folders exist
- [ ] Each folder has skill.yaml with user-invocable: false
- [ ] Each folder has SKILL.md with content from source
- [ ] collab/SKILL.md references collab-session-mgmt and collab-work-item-loop
- [ ] brainstorming/SKILL.md references all 5 brainstorming-* skills
- [ ] rough-draft/SKILL.md references all 4 rough-draft-* skills
- [ ] executing-plans/SKILL.md references both executing-plans-* skills
- [ ] Sub-skills load correctly when invoked via Skill tool
