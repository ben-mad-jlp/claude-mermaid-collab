# Interface Definition: Item 4

## Fix terminal sizing to PTY

### File Structure

- `src/terminal/PTYManager.ts` - **MODIFY** - Defer buffer replay until after first resize
- `ui/src/components/terminal/XTermTerminal.tsx` - **MODIFY** - Ensure resize sent before expecting output
- `src/routes/websocket.ts` - **MODIFY** - Handle resize-before-replay handshake

### Type Definitions

```typescript
// src/terminal/PTYManager.ts

interface PTYSession {
  pty: IPty;
  buffer: string[];
  cols: number;
  rows: number;
  hasReceivedResize: boolean;  // NEW: track if client has sent dimensions
}

interface AttachOptions {
  cols?: number;
  rows?: number;
  deferReplay?: boolean;  // NEW: if true, don't replay buffer until resize received
}
```

```typescript
// src/routes/websocket.ts

interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
  isInitial?: boolean;  // NEW: flag for first resize after connect
}
```

### Function Signatures

```typescript
// src/terminal/PTYManager.ts
class PTYManager {
  /**
   * Attach a WebSocket to a PTY session.
   * @param sessionId - Terminal session ID
   * @param ws - WebSocket connection
   * @param options - Attach options including deferReplay
   */
  attach(sessionId: string, ws: WebSocket, options?: AttachOptions): void;
  
  /**
   * Replay buffered output to WebSocket.
   * Called after first resize when deferReplay was true.
   */
  replayBuffer(sessionId: string, ws: WebSocket): void;
  
  /**
   * Resize PTY and mark session as having received resize.
   */
  resize(sessionId: string, cols: number, rows: number): void;
}
```

```typescript
// ui/src/components/terminal/XTermTerminal.tsx
// Send resize immediately on WebSocket open, before any other messages
const sendInitialResize = (ws: WebSocket, cols: number, rows: number): void;
```

### Component Interactions

1. Client connects WebSocket to terminal session
2. `PTYManager.attach()` called with `deferReplay: true`
3. PTY session waits (no buffer replay yet)
4. Client sends `resize` message with `isInitial: true`
5. `PTYManager.resize()` updates PTY dimensions, sets `hasReceivedResize = true`
6. `PTYManager.replayBuffer()` called - buffer sent with correct dimensions
7. All subsequent output renders correctly

### Sequence Diagram

```
Client                    WebSocket Handler           PTYManager
  |                             |                         |
  |------ connect ------------->|                         |
  |                             |-- attach(deferReplay) ->|
  |                             |                         | (no replay)
  |-- resize(initial=true) --->|                         |
  |                             |-- resize() ------------>|
  |                             |-- replayBuffer() ------>|
  |<----- buffered output ------|<------------------------|
  |                             |                         |
```

### Verification Checklist

- [x] All files from design are listed (3 files)
- [x] All public interfaces have signatures
- [x] Parameter types are explicit
- [x] Return types are explicit
- [x] Component interactions documented with sequence
