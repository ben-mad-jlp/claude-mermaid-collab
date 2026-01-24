# Skeleton: Item 12 - Auto-Accept Option for Rough-Draft

## File Changes

This item primarily involves skill updates and MCP state extension.

### src/mcp/server.ts (MODIFY)
```typescript
// TODO: Add autoAcceptRoughDraft to session state type
// Existing update_session_state handler should already support arbitrary fields
```

### skills/rough-draft/SKILL.md (MODIFY)
```markdown
## Auto-Accept Mode

At the start of rough-draft, prompt user:

CALL render_ui with Card:
  - Dropdown: "Auto-accept all rough-draft changes?"
    - Yes - Skip approval prompts
    - No - Review each phase

IF response is "yes":
  CALL update_session_state({ autoAcceptRoughDraft: true })

<!-- TODO: Add full implementation -->
```

### skills/rough-draft-interface/SKILL.md (MODIFY)
```markdown
## Approval Flow

Before prompting for approval:
1. Get session state
2. If autoAcceptRoughDraft is true:
   - Show artifact (non-blocking)
   - Skip approval prompt
   - Proceed to verification
3. If false:
   - Use existing [PROPOSED] approval flow

<!-- TODO: Add implementation -->
```

### skills/rough-draft-pseudocode/SKILL.md (MODIFY)
```markdown
<!-- Same pattern as interface -->
```

### skills/rough-draft-skeleton/SKILL.md (MODIFY)
```markdown
<!-- Same pattern as interface -->
```

## Task Dependency Graph

```yaml
tasks:
  - id: update-rough-draft-main
    files: [skills/rough-draft/SKILL.md]
    description: Add auto-accept prompt at rough-draft start
    parallel: true

  - id: update-interface-skill
    files: [skills/rough-draft-interface/SKILL.md]
    description: Add auto-accept check to interface phase
    depends-on: [update-rough-draft-main]

  - id: update-pseudocode-skill
    files: [skills/rough-draft-pseudocode/SKILL.md]
    description: Add auto-accept check to pseudocode phase
    depends-on: [update-rough-draft-main]

  - id: update-skeleton-skill
    files: [skills/rough-draft-skeleton/SKILL.md]
    description: Add auto-accept check to skeleton phase
    depends-on: [update-rough-draft-main]
```
