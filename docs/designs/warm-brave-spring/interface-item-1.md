# Interface: Item 1 - Create Kodex skill

## File Structure

- `skills/using-kodex/SKILL.md` - New skill file for Kodex usage guidance

## Interface Definition

This is a skill file (markdown), not code. The "interface" is the skill's structure and content sections.

### Skill Frontmatter

```yaml
---
name: using-kodex
description: Use when project knowledge could help - queries Kodex topics and flags outdated information
user-invocable: false
allowed-tools:
  - mcp__mermaid__kodex_query_topic
  - mcp__mermaid__kodex_list_topics
  - mcp__mermaid__kodex_flag_topic
---
```

### Content Sections

1. **When to Query Kodex** - Describes judgment-based triggers
2. **How to Query** - Topic inference logic and tool usage
3. **When to Flag** - Conditions for flagging outdated topics
4. **MCP Tool Reference** - Table of available Kodex tools

### Component Interactions

- Called by: Any skill that needs project knowledge
- Calls: `mcp__mermaid__kodex_query_topic`, `mcp__mermaid__kodex_flag_topic`
- No return value (guidance skill, not procedural)

## Verification Checklist

- [ ] Skill file path exists: `skills/using-kodex/SKILL.md`
- [ ] Frontmatter includes name, description, allowed-tools
- [ ] "When to Query" section present
- [ ] "How to Query" section with tool call example
- [ ] "When to Flag" section with verification requirement
- [ ] MCP tool reference table present
