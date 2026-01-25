# Skeleton: Item 2 - Integrate Kodex into brainstorming

## Planned Files

- [ ] `skills/brainstorming-exploring/SKILL.md` - Modify existing file to add Step 0

**Note:** This file will be modified during the implementation phase by executing-plans.

## File Contents

### Planned Modification: skills/brainstorming-exploring/SKILL.md

**Insert after line 23 (after "---" section separator, before "## Process"):**

```markdown
## Step 0: Query Kodex

Before reading files, check project knowledge base for relevant context.

### Topic Inference

1. Get current work item from collab-state.json
2. Extract keywords from item title/description
3. Build topic candidates:
   - `{keyword}`
   - `{keyword}-patterns`
   - `{keyword}-conventions`

### Query Process

```
FOR each candidate topic name:
  Tool: mcp__mermaid__kodex_query_topic
  Args: { "project": "<cwd>", "name": "<candidate>" }
  
  IF found: Add to context
```

### Example

For work item "Add user authentication":

```
Tool: mcp__mermaid__kodex_query_topic
Args: {
  "project": "<absolute-path-to-cwd>",
  "name": "authentication"
}
```

### Fallback

If no topics found from title keywords:
1. Try keywords from item description
2. Try removing suffixes (-patterns, -conventions)
3. Continue to file exploration without Kodex context

Display found topics before proceeding to "Check project state".
```

**Status:** [ ] Will be modified during implementation

## Task Dependency Graph

```yaml
tasks:
  - id: brainstorming-exploring-kodex
    files: [skills/brainstorming-exploring/SKILL.md]
    description: Add Step 0 Kodex query to brainstorming-exploring
    depends-on: [using-kodex-skill]
```

## Execution Order

**Wave 1:** using-kodex-skill (Item 1)
**Wave 2:** brainstorming-exploring-kodex

Depends on Item 1 being complete first (references using-kodex patterns).

## Verification

- [ ] Step 0 section added before "## Process"
- [ ] Topic inference logic documented
- [ ] Example tool call included
- [ ] Keyword fallback logic present
- [ ] Display instruction for found topics
