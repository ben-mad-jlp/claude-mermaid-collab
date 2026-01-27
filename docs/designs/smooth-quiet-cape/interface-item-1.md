# Interface Definition - Item 1: Kodex Init Skill

## File Structure

- `skills/kodex-init/SKILL.md` - The skill definition file

## Skill Frontmatter Interface

```yaml
---
name: kodex-init
description: Bootstrap a Kodex knowledge base by analyzing codebase structure and creating topic stubs
user-invocable: true
allowed-tools:
  - Bash
  - Glob
  - Grep
  - Read
  - mcp__plugin_mermaid-collab_mermaid__kodex_create_topic
  - mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
---
```

## MCP Tool Interface

The skill uses existing MCP tools:

```typescript
// Tool: mcp__plugin_mermaid-collab_mermaid__kodex_create_topic
interface CreateTopicArgs {
  project: string;       // Absolute path to project root
  name: string;          // kebab-case topic name
  title: string;         // Human-readable title
  content: {
    conceptual: string;  // Stub: "# {Title}\n\nTopic pending documentation.\n\n## Source Files\n- path1\n- path2"
    technical: string;   // Empty string
    files: string;       // Empty string
    related: string;     // Empty string
  };
}

// Tool: mcp__plugin_mermaid-collab_mermaid__kodex_list_topics
interface ListTopicsArgs {
  project: string;       // Absolute path to project root
  filter?: 'all' | 'verified' | 'unverified' | 'has_draft';
}
```

## Skill Sections Interface

The SKILL.md will contain these sections:

1. **Overview** - Purpose and when to use
2. **Step 1: Explore Structure** - Instructions for walking directory tree
3. **Step 2: Build Topic List** - Topic identification heuristics
4. **Step 3: Present for Approval** - User confirmation flow
5. **Step 4: Create Topics** - MCP tool calls
6. **Standard Topics Reference** - Common topics to look for
7. **Exclusion Patterns** - What to skip (node_modules, etc.)

## Component Interactions

```
User invokes /kodex-init
    |
    v
Skill reads directory structure (Bash: ls, Glob)
    |
    v
Skill identifies topic candidates
    |
    v
Skill presents list to user (AskUserQuestion)
    |
    v
User approves/modifies
    |
    v
Skill calls kodex_create_topic for each (MCP)
    |
    v
Summary displayed
```

## Verification Checklist

- [x] File path defined: `skills/kodex-init/SKILL.md`
- [x] Frontmatter interface defined (name, description, user-invocable, allowed-tools)
- [x] MCP tool interfaces documented
- [x] Skill sections outlined
- [x] Component interactions documented
