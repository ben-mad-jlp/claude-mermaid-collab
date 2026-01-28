# Session: wide-quiet-stream

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Replace tmux with a modern terminal solution
**Type:** code
**Status:** documented

**Problem/Goal:**
Replace the current tmux-based terminal implementation with a modern alternative. Sessions only need to persist while the server is running - no persistence across server restarts required.

**Approach:**
- Use in-memory PTY manager with Bun's native `Bun.Terminal`
- Keep PTY processes alive in a Map (keyed by session ID)
- Add output ring buffer to support reconnects (replay on connect)
- Remove all tmux dependency

**Success Criteria:**
- No tmux dependency (remove all tmux exec calls)
- Terminals persist while server is running
- Browser can disconnect and reconnect, resuming session with scrollback
- Existing MCP terminal tools continue to work
- Existing REST API routes continue to work
- UI unchanged (XTermTerminal.tsx)

**Decisions:**
- Reconnect behavior: Resume session (see previous output, continue where left off)
- Scrollback buffer: 10,000 lines (matches xterm.js setting)
- Shell: $SHELL with fallback chain (zsh → bash → sh)

---

## Technical Design

### Section 1: PTYManager Core Class

The `PTYManager` class is the central component replacing tmux. It manages terminal sessions in-memory using a `Map<string, PTYSession>` keyed by session ID.

**PTYSession interface:**
```typescript
interface PTYSession {
  id: string;
  pty: ReturnType<typeof Bun.spawn>;  // Bun PTY process
  buffer: RingBuffer;                  // Output history for reconnects
  websockets: Set<ServerWebSocket>;    // Connected clients
  createdAt: Date;
  lastActivity: Date;
}
```

**PTYManager responsibilities:**
- `create(sessionId, shell?)` - Spawn new PTY with shell
- `write(sessionId, data)` - Send input to PTY
- `attach(sessionId, ws)` - Connect WebSocket, replay buffer
- `detach(sessionId, ws)` - Disconnect WebSocket (PTY continues)
- `kill(sessionId)` - Terminate PTY and cleanup
- `list()` - Return active session metadata

**Location:** `src/terminal/PTYManager.ts` (new file)

The manager broadcasts PTY output to all attached WebSockets and simultaneously writes to the ring buffer for reconnect support.

### Section 2: RingBuffer for Reconnect Support

The `RingBuffer` class stores terminal output for replay when clients reconnect. It maintains a fixed-size circular buffer of output chunks.

**RingBuffer interface:**
```typescript
class RingBuffer {
  constructor(maxLines: number = 10_000);
  
  write(data: string): void;     // Append output, evict old if full
  getContents(): string;         // Return all buffered content
  clear(): void;                 // Reset buffer
  get lineCount(): number;       // Current line count
}
```

**Implementation details:**
- Store raw terminal output (including ANSI escape codes)
- Track line boundaries by counting `\n` characters
- When exceeding `maxLines`, drop oldest lines first
- Use efficient array rotation (avoid shift/unshift)

**Location:** `src/terminal/RingBuffer.ts` (new file)

**Reconnect flow:**
1. Client WebSocket connects with session ID
2. PTYManager calls `attach(sessionId, ws)`
3. Immediately send `buffer.getContents()` to replay history
4. Then stream live output going forward

This gives users seamless reconnection - they see their previous output and can continue where they left off.

### Section 3: WebSocket Integration

The WebSocket handler connects browser terminals to PTY sessions. It replaces the current tmux-based WebSocket logic.

**WebSocket message protocol:**
```typescript
// Client → Server
{ type: "input", data: string }      // Keyboard input
{ type: "resize", cols: number, rows: number }

// Server → Client  
{ type: "output", data: string }     // Terminal output
{ type: "exit", code: number }       // PTY process exited
```

**Connection lifecycle:**
1. Client connects: `ws://host/terminal/:sessionId`
2. Server calls `ptyManager.attach(sessionId, ws)`
3. If session doesn't exist, create it with `ptyManager.create(sessionId)`
4. Buffer contents replayed immediately
5. Bidirectional streaming until disconnect or exit

**Handler location:** Modify existing `src/routes/websocket.ts`

**Key changes from tmux approach:**
- No external process spawning for tmux
- No parsing tmux output format
- Direct PTY ↔ WebSocket streaming
- Multiple WebSockets can attach to same session (e.g., split views)

### Section 4: REST API Routes

The existing REST API for terminal management stays compatible. Routes delegate to PTYManager instead of tmux commands.

**Existing routes (unchanged interface):**
```
POST   /api/terminal/sessions           → ptyManager.create()
GET    /api/terminal/sessions           → ptyManager.list()
DELETE /api/terminal/sessions/:id       → ptyManager.kill()
POST   /api/terminal/sessions/:id/rename → update session metadata
```

**Implementation changes:**
- Remove `execSync('tmux ...')` calls
- Replace with PTYManager method calls
- Response format stays the same for API compatibility

**MCP tool compatibility:**
The MCP tools (`terminal_create_session`, `terminal_list_sessions`, `terminal_kill_session`) call these REST endpoints. Since the API interface is unchanged, MCP tools continue working without modification.

**Location:** Modify existing `src/routes/api.ts`

### Section 5: File Changes Summary

**New files to create:**
```
src/terminal/PTYManager.ts    # Core PTY session manager
src/terminal/RingBuffer.ts    # Circular buffer for output history
src/terminal/index.ts         # Export barrel
```

**Files to modify:**
```
src/routes/websocket.ts       # Replace tmux WebSocket logic
src/routes/api.ts             # Replace tmux REST API calls
src/server.ts                 # Initialize PTYManager singleton
```

**Files to delete:**
```
src/terminal/tmux.ts          # (if exists) Remove tmux wrapper
```

**Code to remove:**
- All `execSync('tmux ...')` or `spawn('tmux', ...)` calls
- Any tmux session name formatting logic
- Tmux-specific error handling

**No changes required:**
- `ui/src/components/editors/XTermTerminal.tsx` - UI unchanged
- MCP tool definitions - API interface unchanged
- Session state management - orthogonal to terminal implementation

---

## Diagrams
(auto-synced)