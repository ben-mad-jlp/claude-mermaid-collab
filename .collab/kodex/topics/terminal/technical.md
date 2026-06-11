## Implementation Details

### Terminal Session Structure
```typescript
interface TerminalSession {
  id: string;           // UUID
  name: string;         // Display name
  tmuxSession: string;  // e.g., "mc-openboldmeadow-a1b2"
  created: string;      // ISO timestamp
  order: number;        // Tab order
}
```

### PTY Session Management
```typescript
interface PTYSession {
  id: string;
  process: Subprocess;
  terminal: Terminal;
  buffer: RingBuffer;        // Output history
  websockets: Set<ServerWebSocket>;
  shell: string;
  cwd: string;
}
```

### tmux Session Naming
Format: `mc-<sanitized-session>-<random>`
Example: `mc-openboldmeadow-a1b2`

### MCP Tools
- `terminal_create_session`: Create new terminal
- `terminal_list_sessions`: List all terminals
- `terminal_kill_session`: Kill terminal
- `terminal_rename_session`: Rename terminal
- `terminal_reorder_sessions`: Reorder tabs