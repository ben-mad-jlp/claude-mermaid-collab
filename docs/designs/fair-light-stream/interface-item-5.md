# Interface: Item 5 - Disable tmux terminal splitting

## File Structure
- `src/services/terminal-manager.ts` - Modify `createTmuxSession` method

## Type Definitions
No new types needed.

## Function Signatures

```typescript
// src/services/terminal-manager.ts

// EXISTING - no signature change, only implementation
async createTmuxSession(tmuxSessionName: string, cwd?: string): Promise<void>
```

## Implementation Notes
Add two unbind commands after the mouse option line (around line 121):

```typescript
// After: await execAsync(`tmux set-option -t ${tmuxSessionName} mouse on`);
// Add:
await execAsync(`tmux unbind-key -t ${tmuxSessionName} %`);
await execAsync(`tmux unbind-key -t ${tmuxSessionName} '"'`);
```

## Component Interactions
- `createTmuxSession()` is called by MCP tool `terminal_create_session`
- Unbind commands are session-scoped (only affect this tmux session)
- No changes to callers or return types
