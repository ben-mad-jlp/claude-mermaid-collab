# Skeleton: Item 5 - Update collab to recommend AI-UI

## APPROVED

## Task Dependency Graph

```yaml
tasks:
  - id: update-brainstorming
    files: [skills/brainstorming/SKILL.md]
    description: Add browser-based questions section
    depends-on: [using-ai-ui-skill]
    parallel: true

  - id: update-clarifying
    files: [skills/brainstorming/clarifying.md]
    description: Add render_ui patterns for clarifying questions
    depends-on: [using-ai-ui-skill]
    parallel: true

  - id: update-designing
    files: [skills/brainstorming/designing.md]
    description: Add render_ui patterns for design validation
    depends-on: [using-ai-ui-skill]
    parallel: true

  - id: update-gather-goals
    files: [skills/gather-session-goals/SKILL.md]
    description: Add render_ui patterns for goal collection
    depends-on: [using-ai-ui-skill]
    parallel: true
```

## Files to Modify

| File | Section to Add/Update |
|------|----------------------|
| `skills/brainstorming/SKILL.md` | Browser-Based Questions |
| `skills/brainstorming/clarifying.md` | Browser-Based Questions |
| `skills/brainstorming/designing.md` | Browser-Based Questions |
| `skills/gather-session-goals/SKILL.md` | Browser-Based Questions |

## Content Template

Each file gets this section:

```markdown
## Browser-Based Questions

When a collab session is active, prefer render_ui for user interactions.

### Yes/No Questions
// TODO: Add Card + actions pattern

### Multiple Choice (2-5 options)
// TODO: Add RadioGroup pattern

### Multiple Choice (6+ options)
// TODO: Add MultipleChoice pattern
```

## Verification

After implementation:
- All 4 files contain "Browser-Based Questions" section
- All reference RadioGroup for 2-5 options
- All reference render_ui MCP tool
