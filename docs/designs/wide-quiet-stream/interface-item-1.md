# Interface Definition - Item 1: Replace tmux with PTY Manager

## File Structure

**New files:**
- `src/terminal/RingBuffer.ts` - Circular buffer for output history
- `src/terminal/PTYManager.ts` - Core PTY session manager
- `src/terminal/index.ts` - Export barrel

**Modified files:**
- `src/routes/websocket.ts` - Replace tmux WebSocket logic
- `src/routes/api.ts` - Replace tmux REST API calls
- `src/server.ts` - Initialize PTYManager singleton

## Type Definitions

```typescript
// src/terminal/RingBuffer.ts

/**
 * Circular buffer storing terminal output for reconnect replay.
 * Maintains a fixed maximum number of lines, evicting oldest when full.
 */
export class RingBuffer {
  private lines: string[];
  private maxLines: number;

  constructor(maxLines?: number);  // Default: 10_000

  /** Append output data, splitting by newlines and evicting old if full */
  write(data: string): void;

  /** Return all buffered content as a single string */
  getContents(): string;

  /** Reset buffer to empty state */
  clear(): void;

  /** Current number of lines in buffer */
  get lineCount(): number;
}
```

```typescript
// src/terminal/PTYManager.ts
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
  shell?: string;      // Default: $SHELL or fallback chain
  cwd?: string;        // Default: process.cwd()
  cols?: number;       // Default: 80
  rows?: number;       // Default: 24
}

/**
 * Manages PTY sessions in-memory, replacing tmux.
 * Singleton instance initialized at server startup.
 */
export class PTYManager {
  private sessions: Map<string, PTYSession>;

  constructor();

  /** Create a new PTY session with the given ID */
  create(sessionId: string, options?: CreateOptions): Promise<PTYSessionInfo>;

  /** Send input data to a PTY session */
  write(sessionId: string, data: string): void;

  /** Resize a PTY session */
  resize(sessionId: string, cols: number, rows: number): void;

  /** Attach a WebSocket to receive output and replay buffer */
  attach(sessionId: string, ws: ServerWebSocket): void;

  /** Detach a WebSocket (PTY continues running) */
  detach(sessionId: string, ws: ServerWebSocket): void;

  /** Kill a PTY session and cleanup */
  kill(sessionId: string): void;

  /** List all active sessions */
  list(): PTYSessionInfo[];

  /** Check if a session exists */
  has(sessionId: string): boolean;

  /** Get session info by ID */
  get(sessionId: string): PTYSessionInfo | undefined;

  /** Kill all sessions (for server shutdown) */
  killAll(): void;
}

/** Singleton instance */
export const ptyManager: PTYManager;
```

```typescript
// src/terminal/index.ts
export { RingBuffer } from './RingBuffer';
export { PTYManager, ptyManager } from './PTYManager';
export type { PTYSession, PTYSessionInfo, CreateOptions } from './PTYManager';
```

## WebSocket Protocol

```typescript
// src/routes/websocket.ts

/** Client to Server messages */
type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

/** Server to Client messages */
type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };

/**
 * WebSocket route: /terminal/:sessionId
 * 
 * Connection lifecycle:
 * 1. Extract sessionId from URL
 * 2. If session doesn't exist, create it
 * 3. Attach WebSocket to session (triggers buffer replay)
 * 4. Handle messages until close
 * 5. Detach WebSocket on close
 */
```

## REST API Signatures

```typescript
// src/routes/api.ts - Terminal routes

/** POST /api/terminal/sessions */
interface CreateSessionRequest {
  id?: string;        // Optional, auto-generate if not provided
  shell?: string;
  cwd?: string;
}
interface CreateSessionResponse {
  id: string;
  shell: string;
  cwd: string;
  createdAt: string;
}

/** GET /api/terminal/sessions */
type ListSessionsResponse = Array<{
  id: string;
  shell: string;
  cwd: string;
  createdAt: string;
  lastActivity: string;
  connectedClients: number;
}>;

/** DELETE /api/terminal/sessions/:id */
interface DeleteSessionResponse {
  success: boolean;
}

/** POST /api/terminal/sessions/:id/rename */
interface RenameSessionRequest {
  name: string;
}
interface RenameSessionResponse {
  success: boolean;
  id: string;
}
```

## Component Interactions

```
┌─────────────────┐      WebSocket       ┌──────────────────┐
│  XTermTerminal  │◄────────────────────►│ websocket.ts     │
│  (React UI)     │                      │ /terminal/:id    │
└─────────────────┘                      └────────┬─────────┘
                                                  │
                                                  │ attach/detach/write
                                                  ▼
┌─────────────────┐      REST API        ┌──────────────────┐
│  MCP Tools      │◄────────────────────►│ api.ts           │
│  (terminal_*)   │                      │ /api/terminal/*  │
└─────────────────┘                      └────────┬─────────┘
                                                  │
                                                  │ create/kill/list
                                                  ▼
                                         ┌──────────────────┐
                                         │ PTYManager       │
                                         │ (singleton)      │
                                         └────────┬─────────┘
                                                  │
                                                  │ manages
                                                  ▼
                                         ┌──────────────────┐
                                         │ PTYSession       │
                                         │ - Subprocess     │
                                         │ - RingBuffer     │
                                         │ - WebSocket Set  │
                                         └──────────────────┘
```

## Verification Checklist

- [x] All files from design are listed
- [x] All public interfaces have signatures
- [x] Parameter types are explicit (no `any`)
- [x] Return types are explicit
- [x] Component interactions are documented
