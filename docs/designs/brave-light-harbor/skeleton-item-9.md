# Skeleton: Item 9 - Improve Compact Messaging

## File Changes

This item primarily involves skill updates, not new code files.

### Skills to Update

#### skills/collab-compact/SKILL.md (MODIFY)
```markdown
## Step 4: Notify User via GUI

Before triggering compact:

CALL mcp__mermaid__render_ui({
  project, session,
  ui: {
    type: 'Alert',
    props: {
      type: 'warning',
      title: 'Context Full',
      message: 'Run /compact in terminal, then /collab to resume.'
    }
  },
  blocking: false
})
```

#### skills/rough-draft/SKILL.md (MODIFY)
```markdown
# Add compact notification pattern at phase transitions
# Use render_ui with Alert when context is high
```

## No New Code Files

This item uses existing Alert component. Only skill documentation updates.

## Task Dependency Graph

```yaml
tasks:
  - id: update-collab-compact
    files: [skills/collab-compact/SKILL.md]
    description: Add render_ui Alert notification to collab-compact skill
    parallel: true

  - id: update-rough-draft
    files: [skills/rough-draft/SKILL.md]
    description: Add compact notification pattern to rough-draft skill
    parallel: true

  - id: update-brainstorming
    files: [skills/brainstorming/SKILL.md]
    description: Add compact notification pattern to brainstorming skill
    parallel: true
```
