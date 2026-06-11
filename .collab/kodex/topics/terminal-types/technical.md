## Type Definitions

### TerminalSession
```typescript
interface TerminalSession {
  id: string;           // Unique identifier (UUID)
  name: string;         // Display name (e.g., "Terminal 1")
  tmuxSession: string;  // tmux session name (e.g., "mc-openboldmeadow-a1b2")
  created: string;      // ISO timestamp when created
  order: number;        // Tab order for UI (0-indexed)
}
```

### TerminalSessionsState
```typescript
interface TerminalSessionsState {
  sessions: TerminalSession[];
  lastModified: string;
}
```

### MCP Tool Response Types
```typescript
interface CreateSessionResult {
  id: string;
  tmuxSession: string;
  wsUrl: string;
}

interface ListSessionsResult {
  sessions: TerminalSession[];
}

interface KillSessionResult { success: boolean; }
interface RenameSessionResult { success: boolean; }
interface ReorderSessionsResult { success: boolean; }
```