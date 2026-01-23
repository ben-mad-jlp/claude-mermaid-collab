# Interface: Item 4 - render_ui Default for User Interactions

## [APPROVED]

## File Structure
Skills to update with render_ui patterns:
- `skills/rough-draft/interface.md`
- `skills/rough-draft/pseudocode.md`
- `skills/rough-draft/skeleton.md`
- `skills/rough-draft/handoff.md`
- `skills/executing-plans/SKILL.md`
- `skills/ready-to-implement/SKILL.md`
- `skills/task-planning/SKILL.md`
- `skills/collab-cleanup/SKILL.md`
- `skills/finishing-a-development-branch/SKILL.md`

## Changes

### Standard Section to Add

Each skill gets this section after "Collab Session Required":

```markdown
## Browser-Based Questions

When a collab session is active, use `render_ui` for all user interactions.

**Component selection:**
| Question Type | Component |
|--------------|-----------|
| Yes/No | Card with action buttons |
| Choose 1 of 2-5 | RadioGroup |
| Choose 1 of 6+ | MultipleChoice |
| Free text | TextInput or TextArea |

**Example - Yes/No:**
```
Tool: mcp__mermaid__render_ui
Args: {
  "project": "<cwd>",
  "session": "<session>",
  "ui": {
    "type": "Card",
    "props": { "title": "<question context>" },
    "children": [{ "type": "Markdown", "props": { "content": "<question>" } }],
    "actions": [
      { "id": "yes", "label": "Yes", "primary": true },
      { "id": "no", "label": "No" }
    ]
  },
  "blocking": true
}
```

**Terminal prompts only when:** No collab session exists (pre-session selection).
```

## Verification
- [ ] All listed skills have Browser-Based Questions section
- [ ] Component selection table is consistent
- [ ] Example patterns are copy-pasteable
