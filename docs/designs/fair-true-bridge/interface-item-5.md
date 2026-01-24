# Interface Definition: Item 5 - Update collab to recommend AI-UI

## APPROVED

## File Structure

Files to modify:
- `skills/brainstorming/SKILL.md`
- `skills/brainstorming/clarifying.md`
- `skills/brainstorming/designing.md`
- `skills/gather-session-goals/SKILL.md`

---

## Changes Required

### Add to each skill's "Browser-Based Questions" section:

```markdown
## Browser-Based Questions

When a collab session is active, prefer `render_ui` for user interactions:

### For Yes/No Questions
Use Card with action buttons:
\`\`\`json
{
  "type": "Card",
  "props": { "title": "Confirm" },
  "children": [{ "type": "Markdown", "props": { "content": "Your question here" }}],
  "actions": [
    { "id": "yes", "label": "Yes", "primary": true },
    { "id": "no", "label": "No" }
  ]
}
\`\`\`

### For Multiple Choice (2-5 visible options)
Use RadioGroup:
\`\`\`json
{
  "type": "Card",
  "props": { "title": "Select option" },
  "children": [{
    "type": "RadioGroup",
    "props": {
      "name": "choice",
      "options": [
        { "value": "1", "label": "Option 1" },
        { "value": "2", "label": "Option 2" }
      ]
    }
  }],
  "actions": [{ "id": "submit", "label": "Continue", "primary": true }]
}
\`\`\`

### For Dropdown (6+ options)
Use MultipleChoice component.
```

---

## Component Interactions

- Skills check for active collab session before using render_ui
- Falls back to terminal prompts when no session active
