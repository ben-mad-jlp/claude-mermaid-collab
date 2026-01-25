# Skeleton: Item 3 - Integrate Kodex into rough-draft

## Planned Files

- [ ] `skills/rough-draft-interface/SKILL.md` - Add Step 0 for types/patterns
- [ ] `skills/rough-draft-pseudocode/SKILL.md` - Add Step 0 for error/logic
- [ ] `skills/rough-draft-skeleton/SKILL.md` - Add Step 0 for file structure

**Note:** These files will be modified during the implementation phase by executing-plans.

## File Contents

### Planned Modification: skills/rough-draft-interface/SKILL.md

**Insert after line 12 (after frontmatter, before "# Phase 1: Interface"):**

```markdown
## Step 0: Query Kodex

Query project knowledge for type conventions and patterns.

### Topic Inference (Interface Focus)

From work item context, build candidates:
- `{item-keyword}-types`
- `{item-keyword}-patterns`
- `type-conventions`
- `coding-standards`

### Example

```
Tool: mcp__mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "type-conventions" }
```

Display found topics as context before defining interfaces.
```

---

### Planned Modification: skills/rough-draft-pseudocode/SKILL.md

**Insert after line 12 (after frontmatter, before "# Phase 2: Pseudocode"):**

```markdown
## Step 0: Query Kodex

Query project knowledge for error handling and logic patterns.

### Topic Inference (Pseudocode Focus)

From work item context, build candidates:
- `{item-keyword}-error-handling`
- `{item-keyword}-logic`
- `error-patterns`
- `validation-patterns`

### Example

```
Tool: mcp__mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "error-patterns" }
```

Display found topics as context before writing pseudocode.
```

---

### Planned Modification: skills/rough-draft-skeleton/SKILL.md

**Insert after line 12 (after frontmatter, before "# Phase 3: Skeleton"):**

```markdown
## Step 0: Query Kodex

Query project knowledge for file structure conventions.

### Topic Inference (Skeleton Focus)

From work item context, build candidates:
- `{item-keyword}-file-structure`
- `file-naming`
- `directory-conventions`
- `project-structure`

### Example

```
Tool: mcp__mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "file-naming" }
```

Display found topics as context before planning file structure.
```

**Status:** [ ] Will be modified during implementation

## Task Dependency Graph

```yaml
tasks:
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

**Wave 1:** using-kodex-skill (Item 1)
**Wave 2 (parallel):** 
- rough-draft-interface-kodex
- rough-draft-pseudocode-kodex
- rough-draft-skeleton-kodex

All three can run in parallel after Item 1 completes.

## Verification

- [ ] rough-draft-interface has Step 0 with types/patterns focus
- [ ] rough-draft-pseudocode has Step 0 with error/logic focus
- [ ] rough-draft-skeleton has Step 0 with file structure focus
- [ ] Each includes topic inference logic
- [ ] Each includes example tool call
- [ ] Each specifies display instruction
