# Interface: Item 3 - Integrate Kodex into rough-draft

## File Structure

- `skills/rough-draft-interface/SKILL.md` - Add Kodex query for types/patterns
- `skills/rough-draft-pseudocode/SKILL.md` - Add Kodex query for error handling/logic
- `skills/rough-draft-skeleton/SKILL.md` - Add Kodex query for file structure

## Interface Definition

Each file gets a new "Step 0: Query Kodex" section with phase-specific focus.

### rough-draft-interface Section

**Location:** Before "## What to Produce" (around line 14)

```markdown
## Step 0: Query Kodex

Query project knowledge for type conventions and patterns.

### Topic Inference (Interface Focus)

1. From work item context, infer: `{item}-types`, `type-conventions`, `{item}-patterns`
2. Query each inferred topic
3. Display found topics as context for interface definition

### Example

```
Tool: mcp__mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "type-conventions" }
```
```

### rough-draft-pseudocode Section

**Location:** Before "## What to Produce" (around line 14)

```markdown
## Step 0: Query Kodex

Query project knowledge for error handling and logic patterns.

### Topic Inference (Pseudocode Focus)

1. From work item context, infer: `{item}-error-handling`, `error-patterns`, `{item}-logic`
2. Query each inferred topic
3. Display found topics as context for pseudocode writing

### Example

```
Tool: mcp__mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "error-patterns" }
```
```

### rough-draft-skeleton Section

**Location:** Before "## What to Produce" (around line 14)

```markdown
## Step 0: Query Kodex

Query project knowledge for file structure conventions.

### Topic Inference (Skeleton Focus)

1. From work item context, infer: `{item}-file-structure`, `file-naming`, `directory-conventions`
2. Query each inferred topic
3. Display found topics as context for skeleton planning

### Example

```
Tool: mcp__mermaid__kodex_query_topic
Args: { "project": "<cwd>", "name": "file-naming" }
```
```

### Component Interactions

- Each section runs before "What to Produce" in its respective skill
- All call: `mcp__mermaid__kodex_query_topic`
- Output: Phase-specific context for artifact generation

## Verification Checklist

- [ ] rough-draft-interface has Step 0 with types/patterns focus
- [ ] rough-draft-pseudocode has Step 0 with error/logic focus
- [ ] rough-draft-skeleton has Step 0 with file structure focus
- [ ] Each includes topic inference logic
- [ ] Each includes example tool call
