# Interface: Item 2 - Integrate Kodex into brainstorming

## File Structure

- `skills/brainstorming-exploring/SKILL.md` - Existing file to modify

## Interface Definition

This is a skill file modification. The "interface" is the new section to add.

### New Section: Step 0 - Query Kodex

**Location:** Before "## Process" section (around line 25)

**Section structure:**

```markdown
## Step 0: Query Kodex

Before reading files, check project knowledge base for relevant context.

### Topic Inference

1. Extract keywords from work item title/description
2. Try topic names: `{keyword}`, `{keyword}-patterns`, `{keyword}-conventions`
3. If no results, try broader terms from item context

### Example

```
Tool: mcp__mermaid__kodex_query_topic
Args: {
  "project": "<absolute-path-to-cwd>",
  "name": "authentication"
}
```

Display found topics as context before file exploration.
```

### Component Interactions

- This section runs before "Check project state" (line 27)
- Calls: `mcp__mermaid__kodex_query_topic`
- Output: Displays topic content as context for subsequent exploration

## Verification Checklist

- [ ] New section appears before "## Process"
- [ ] Section title: "## Step 0: Query Kodex"
- [ ] Topic inference logic documented
- [ ] Example tool call included
- [ ] Keyword fallback logic present
