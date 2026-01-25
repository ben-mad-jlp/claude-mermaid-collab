# Combined Task Dependency Graph

## YAML Task Graph

```yaml
tasks:
  # Item 1: Create Kodex skill
  - id: using-kodex-skill
    files: [skills/using-kodex/SKILL.md]
    description: Create the using-kodex skill file
    parallel: true

  # Item 2: Integrate Kodex into brainstorming
  - id: brainstorming-exploring-kodex
    files: [skills/brainstorming-exploring/SKILL.md]
    description: Add Step 0 Kodex query to brainstorming-exploring
    depends-on: [using-kodex-skill]

  # Item 3: Integrate Kodex into rough-draft (3 parallel tasks)
  - id: rough-draft-interface-kodex
    files: [skills/rough-draft-interface/SKILL.md]
    description: Add Step 0 Kodex query for types/patterns
    depends-on: [using-kodex-skill]
    parallel: true

  - id: rough-draft-pseudocode-kodex
    files: [skills/rough-draft-pseudocode/SKILL.md]
    description: Add Step 0 Kodex query for error/logic
    depends-on: [using-kodex-skill]
    parallel: true

  - id: rough-draft-skeleton-kodex
    files: [skills/rough-draft-skeleton/SKILL.md]
    description: Add Step 0 Kodex query for file structure
    depends-on: [using-kodex-skill]
    parallel: true
```

## Execution Order

**Wave 1 (no dependencies):**
- `using-kodex-skill` - Create the base skill file

**Wave 2 (depends on Wave 1, can run in parallel):**
- `brainstorming-exploring-kodex`
- `rough-draft-interface-kodex`
- `rough-draft-pseudocode-kodex`
- `rough-draft-skeleton-kodex`

## Summary

- **Total tasks:** 5
- **Total files:** 5 (1 new, 4 modifications)
- **Waves:** 2
- **Max parallelism:** 4 (Wave 2)
