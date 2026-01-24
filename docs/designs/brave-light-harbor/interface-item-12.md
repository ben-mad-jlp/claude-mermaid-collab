# Interface: Item 12 - Auto-Accept Option for Rough-Draft

## File Structure
- `skills/rough-draft/SKILL.md` - Add auto-accept prompt at start (MODIFY)
- Session state stores the preference

## State Extension

```typescript
// collab-state.json extension
interface CollabState {
  // existing fields...
  autoAcceptRoughDraft?: boolean;  // NEW: skip approval prompts
}
```

## MCP State Update

```
Tool: mcp__mermaid__update_session_state
Args: {
  "project": "...",
  "session": "...",
  "autoAcceptRoughDraft": true
}
```

## Skill Behavior Changes

### At rough-draft start:
```
Auto-accept all rough-draft changes?

1. Yes - Skip approval prompts, show artifacts only
2. No - Review and approve each phase
```

### If auto-accept enabled:
1. Skip [PROPOSED] marker workflow
2. Still create interface/pseudocode/skeleton documents
3. Still show artifacts in viewer
4. No blocking approval prompts
5. Still run verification gates (but auto-pass if no errors)

### If auto-accept disabled:
- Current behavior (prompt for approval at each phase)

## Integration Points
- rough-draft skill checks state.autoAcceptRoughDraft before each approval
- Phase sub-skills respect the setting
- Verification gates still run (safety check)
