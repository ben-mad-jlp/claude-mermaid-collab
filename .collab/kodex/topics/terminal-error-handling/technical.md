## Implementation Patterns

### tmux Error Handling
```typescript
async createTmuxSession(name: string): Promise<void> {
  try {
    await execAsync(`tmux new-session -d -s ${name}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('duplicate session')) {
      // OK - session exists, enable mouse and continue
      await execAsync(`tmux set-option -t ${name} mouse on`);
      return;
    }
    throw new Error(`Failed to create tmux session: ${msg}`);
  }
}
```

### Shell Fallback Chain
```typescript
private getShell(requested?: string): string {
  if (requested && existsSync(requested)) return requested;
  if (process.env.SHELL && existsSync(process.env.SHELL)) return process.env.SHELL;
  for (const fallback of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (existsSync(fallback)) return fallback;
  }
  throw new Error('No shell available');
}
```

### WebSocket Send Safety
```typescript
for (const ws of session.websockets) {
  try {
    ws.send(JSON.stringify({ type: 'output', data: text }));
  } catch (error) {
    // WebSocket may have been closed, ignore
  }
}
```