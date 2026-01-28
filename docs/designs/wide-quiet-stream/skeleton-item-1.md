# Skeleton: Item 1 - Replace tmux with PTY Manager

## Planned Files

- [ ] `src/terminal/RingBuffer.ts` - Circular buffer for output history
- [ ] `src/terminal/PTYManager.ts` - Core PTY session manager
- [ ] `src/terminal/index.ts` - Export barrel
- [ ] `src/routes/websocket.ts` - Modified: Replace tmux WebSocket logic
- [ ] `src/routes/api.ts` - Modified: Replace tmux REST API calls
- [ ] `src/server.ts` - Modified: Initialize PTYManager singleton

**Note:** These files are documented but NOT created yet. They will be created during the implementation phase by executing-plans.

---

## File Contents

### Planned File: src/terminal/RingBuffer.ts

```typescript
/**
 * Circular buffer storing terminal output for reconnect replay.
 * Maintains a fixed maximum number of lines, evicting oldest when full.
 */
export class RingBuffer {
  private lines: string[] = [];
  private maxLines: number;

  constructor(maxLines: number = 10_000) {
    // TODO: Store maxLines limit
    this.maxLines = maxLines;
  }

  /**
   * Append output data, splitting by newlines and evicting old if full.
   * Edge cases:
   * - Empty string: No-op, return immediately
   * - Data with no newlines: Treat as single partial line
   * - Very large single write: Split and process normally
   */
  write(data: string): void {
    // TODO: Implement write logic
    // - Split data by newline characters
    // - For each line, append to lines array
    // - If lines.length > maxLines, remove oldest line (shift from front)
    throw new Error('Not implemented');
  }

  /** Return all buffered content as a single string */
  getContents(): string {
    // TODO: Join all lines with newline separator and return
    throw new Error('Not implemented');
  }

  /** Reset buffer to empty state */
  clear(): void {
    // TODO: Reset lines array to empty
    throw new Error('Not implemented');
  }

  /** Current number of lines in buffer */
  get lineCount(): number {
    return this.lines.length;
  }
}
```

**Status:** [ ] Will be created during implementation

---

### Planned File: src/terminal/PTYManager.ts

```typescript
import type { ServerWebSocket } from 'bun';
import type { Subprocess } from 'bun';
import { RingBuffer } from './RingBuffer';

export interface PTYSession {
  id: string;
  pty: Subprocess;
  buffer: RingBuffer;
  websockets: Set<ServerWebSocket>;
  shell: string;
  cwd: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface PTYSessionInfo {
  id: string;
  shell: string;
  cwd: string;
  createdAt: Date;
  lastActivity: Date;
  connectedClients: number;
}

export interface CreateOptions {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

/**
 * Manages PTY sessions in-memory, replacing tmux.
 * Singleton instance initialized at server startup.
 */
export class PTYManager {
  private sessions: Map<string, PTYSession> = new Map();

  constructor() {
    // TODO: Initialize empty sessions Map (done inline above)
  }

  /**
   * Create a new PTY session with the given ID.
   * 
   * Errors:
   * - Throws if sessionId already exists
   * - Throws if no valid shell available
   * - Throws on spawn failure
   */
  async create(sessionId: string, options?: CreateOptions): Promise<PTYSessionInfo> {
    // TODO: Implement create logic
    // 1. Check if sessionId already exists - throw if so
    // 2. Determine shell (options.shell -> $SHELL -> zsh -> bash -> sh)
    // 3. Verify shell exists
    // 4. Spawn PTY subprocess with Bun.spawn
    // 5. Create PTYSession object
    // 6. Set up PTY output handler (write to buffer, broadcast to websockets)
    // 7. Set up PTY exit handler (broadcast exit, cleanup)
    // 8. Store session in Map
    // 9. Return session info
    throw new Error('Not implemented');
  }

  /**
   * Send input data to a PTY session.
   * Throws if session not found.
   */
  write(sessionId: string, data: string): void {
    // TODO: Get session, write to pty.stdin, update lastActivity
    throw new Error('Not implemented');
  }

  /**
   * Resize a PTY session.
   * Throws if session not found.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    // TODO: Get session, call pty.resize if supported, update lastActivity
    throw new Error('Not implemented');
  }

  /**
   * Attach a WebSocket to receive output and replay buffer.
   * Auto-creates session if it doesn't exist.
   */
  attach(sessionId: string, ws: ServerWebSocket): void {
    // TODO: Get or create session, add ws to set, replay buffer contents
    throw new Error('Not implemented');
  }

  /**
   * Detach a WebSocket (PTY continues running).
   */
  detach(sessionId: string, ws: ServerWebSocket): void {
    // TODO: Get session, remove ws from set (no-op if session not found)
    throw new Error('Not implemented');
  }

  /**
   * Kill a PTY session and cleanup.
   */
  kill(sessionId: string): void {
    // TODO: Broadcast exit, close websockets, kill PTY, clear buffer, remove from Map
    throw new Error('Not implemented');
  }

  /** List all active sessions */
  list(): PTYSessionInfo[] {
    // TODO: Map over sessions and return info objects
    throw new Error('Not implemented');
  }

  /** Check if a session exists */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Get session info by ID */
  get(sessionId: string): PTYSessionInfo | undefined {
    // TODO: Get session and return info, or undefined
    throw new Error('Not implemented');
  }

  /** Kill all sessions (for server shutdown) */
  killAll(): void {
    // TODO: Iterate and kill each session
    throw new Error('Not implemented');
  }
}

/** Singleton instance */
export const ptyManager = new PTYManager();
```

**Status:** [ ] Will be created during implementation

---

### Planned File: src/terminal/index.ts

```typescript
export { RingBuffer } from './RingBuffer';
export { PTYManager, ptyManager } from './PTYManager';
export type { PTYSession, PTYSessionInfo, CreateOptions } from './PTYManager';
```

**Status:** [ ] Will be created during implementation

---

### Planned Modifications: src/routes/websocket.ts

Add terminal WebSocket handling alongside existing UI WebSocket handling:

```typescript
// Add imports
import { ptyManager } from '../terminal';

// Add types for terminal messages
type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

type TerminalServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };

// Add terminal WebSocket route handler
// Route: /terminal/:sessionId
//
// onOpen(ws):
//   TODO: Extract sessionId from URL, call ptyManager.attach()
//
// onMessage(ws, message):
//   TODO: Parse JSON, handle 'input' and 'resize' types
//
// onClose(ws):
//   TODO: Extract sessionId, call ptyManager.detach()
//
// onError(ws, error):
//   TODO: Log error, call ptyManager.detach()
```

**Status:** [ ] Will be modified during implementation

---

### Planned Modifications: src/routes/api.ts

Add terminal REST API routes:

```typescript
// Add import
import { ptyManager } from '../terminal';

// POST /api/terminal/sessions
// TODO: Parse body, generate sessionId if not provided, call ptyManager.create()

// GET /api/terminal/sessions
// TODO: Call ptyManager.list(), return as JSON

// DELETE /api/terminal/sessions/:id
// TODO: Check if exists (404 if not), call ptyManager.kill()

// POST /api/terminal/sessions/:id/rename
// TODO: Check if exists (404 if not), return success (ID is immutable)
```

**Status:** [ ] Will be modified during implementation

---

### Planned Modifications: src/server.ts

```typescript
// Add import
import { ptyManager } from './terminal';

// In server initialization:
// TODO: Register shutdown handler for SIGINT/SIGTERM
// - Call ptyManager.killAll() on shutdown
```

**Status:** [ ] Will be modified during implementation

---

## Task Dependency Graph

```yaml
tasks:
  - id: ring-buffer
    files: [src/terminal/RingBuffer.ts]
    tests: [src/terminal/RingBuffer.test.ts, src/terminal/__tests__/RingBuffer.test.ts]
    description: Implement circular buffer for terminal output history
    parallel: true

  - id: pty-manager
    files: [src/terminal/PTYManager.ts]
    tests: [src/terminal/PTYManager.test.ts, src/terminal/__tests__/PTYManager.test.ts]
    description: Implement PTY session manager with Bun.spawn
    depends-on: [ring-buffer]

  - id: terminal-exports
    files: [src/terminal/index.ts]
    tests: []
    description: Export barrel for terminal module
    depends-on: [pty-manager]

  - id: websocket-integration
    files: [src/routes/websocket.ts]
    tests: [src/routes/websocket.test.ts, src/routes/__tests__/websocket.test.ts]
    description: Add terminal WebSocket route handler
    depends-on: [terminal-exports]

  - id: api-integration
    files: [src/routes/api.ts]
    tests: [src/routes/api.test.ts, src/routes/__tests__/api.test.ts]
    description: Add terminal REST API routes
    depends-on: [terminal-exports]

  - id: server-integration
    files: [src/server.ts]
    tests: []
    description: Initialize PTYManager and register shutdown handler
    depends-on: [websocket-integration, api-integration]
```

---

## Execution Order

**Wave 1 (Parallel-safe, no dependencies):**
- `ring-buffer` - RingBuffer class implementation

**Wave 2 (Depends on Wave 1):**
- `pty-manager` - PTYManager class (uses RingBuffer)

**Wave 3 (Depends on Wave 2):**
- `terminal-exports` - Export barrel

**Wave 4 (Parallel, depend on Wave 3):**
- `websocket-integration` - WebSocket route handler
- `api-integration` - REST API routes

**Wave 5 (Depends on Wave 4):**
- `server-integration` - Server startup and shutdown

---

## Verification Checklist

- [x] All files from Interface are documented (NOT created)
- [x] File paths match interface exactly
- [x] All types are defined (PTYSession, PTYSessionInfo, CreateOptions, etc.)
- [x] All function signatures present with parameters and return types
- [x] TODO comments match pseudocode logic
- [x] Dependency graph covers all files
- [x] No circular dependencies
- [x] Test file patterns generated for each task

**GATE: Skeleton phase complete. Ready for implementation.**
