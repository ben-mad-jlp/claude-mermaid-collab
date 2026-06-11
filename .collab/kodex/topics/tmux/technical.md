## Implementation Details

### Session Creation
```typescript
async createTmuxSession(tmuxSessionName: string, cwd?: string): Promise<void> {
  await execAsync(`tmux new-session -d -s ${tmuxSessionName} -c ${cwd}`);
  await execAsync(`tmux set-option -t ${tmuxSessionName} mouse on`);
  await execAsync(`tmux unbind-key -t ${tmuxSessionName} %`);
  await execAsync(`tmux unbind-key -t ${tmuxSessionName} '"'`);
}
```

### Session Naming
```typescript
generateTmuxSessionName(collabSession: string): string {
  const sanitized = sessionName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20);
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `mc-${sanitized || 'default'}-${randomSuffix}`;
}
```

### Reconciliation
On startup, orphan tmux sessions (not in stored state) are killed, and orphan records (tmux session dead) are removed.