# Skeleton: Item 5 - Disable tmux terminal splitting

## Planned Files
- [ ] `src/services/terminal-manager.ts` - Modify existing (createTmuxSession method)

**Note:** This is a modification to an existing file.

## File Changes

### src/services/terminal-manager.ts (MODIFY)

```typescript
// In createTmuxSession method (lines 111-135)
// Add unbind commands after mouse option

async createTmuxSession(tmuxSessionName: string, cwd?: string): Promise<void> {
  try {
    // Create session (existing)
    if (cwd) {
      await execAsync(`tmux new-session -d -s ${tmuxSessionName} -c ${cwd}`);
    } else {
      await execAsync(`tmux new-session -d -s ${tmuxSessionName}`);
    }

    // Enable mouse scrolling (existing)
    await execAsync(`tmux set-option -t ${tmuxSessionName} mouse on`);

    // TODO: Disable pane splitting
    // await execAsync(`tmux unbind-key -t ${tmuxSessionName} %`);
    // await execAsync(`tmux unbind-key -t ${tmuxSessionName} '"'`);

  } catch (error) {
    // ... existing error handling ...
  }
}
```

## Task Dependency Graph

```yaml
tasks:
  - id: item-5-tmux-unbind
    files: [src/services/terminal-manager.ts]
    tests: [src/services/terminal-manager.test.ts, src/services/__tests__/terminal-manager.test.ts]
    description: Add tmux unbind-key commands to disable pane splitting
    parallel: true
```

## Execution Order

**Wave 1 (parallel-safe):**
- item-5-tmux-unbind

## Verification
- [ ] unbind-key for % (horizontal split) added
- [ ] unbind-key for " (vertical split) added
- [ ] Commands run after mouse option
- [ ] Existing error handling preserved
