# Interface: Item 9 - Improve Compact Messaging

## File Structure
- Skills using compact (collab-compact, rough-draft, etc.) - MODIFY
- No new files needed

## Approach

Skills that detect compact needed use render_ui to display message:

```typescript
// When compact is needed
{
  type: 'Alert',
  props: {
    type: 'warning',
    title: 'Context Full',
    message: 'Run /compact in terminal, then /collab to resume.'
  }
}
```

## Message Flow

1. Skill detects context is near limit
2. Skill calls render_ui with Alert component
3. Message displays in GUI message area
4. User sees instruction without watching terminal

## Alert Component Usage

```typescript
// mcp__mermaid__render_ui call
{
  "project": "...",
  "session": "...",
  "ui": {
    "type": "Alert",
    "props": {
      "type": "warning",
      "title": "Context Full",
      "message": "Run /compact in terminal, then /collab to resume."
    }
  },
  "blocking": false
}
```

## Integration Points
- collab-compact skill already uses this pattern
- Other skills should use render_ui before compact instructions
- No new components needed - uses existing Alert
