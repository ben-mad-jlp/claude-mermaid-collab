# Skeleton: Item 4

## Fix terminal sizing to PTY

### Task Graph

```yaml
tasks:
  - id: item4-pty-types
    file: src/terminal/PTYManager.ts
    action: modify
    description: Add hasReceivedResize and deferReplay fields to PTYSession
    depends: []
    
  - id: item4-pty-attach
    file: src/terminal/PTYManager.ts
    action: modify
    description: Update attach() to support deferReplay option
    depends: [item4-pty-types]
    
  - id: item4-pty-replay
    file: src/terminal/PTYManager.ts
    action: modify
    description: Add replayBuffer() method
    depends: [item4-pty-types]
    
  - id: item4-pty-resize
    file: src/terminal/PTYManager.ts
    action: modify
    description: Update resize() to trigger replay on first resize
    depends: [item4-pty-replay]
    
  - id: item4-ws-handler
    file: src/routes/websocket.ts
    action: modify
    description: Pass deferReplay:true to attach(), handle isInitial flag
    depends: [item4-pty-attach]
    
  - id: item4-client-resize
    file: ui/src/components/terminal/XTermTerminal.tsx
    action: modify
    description: Send resize with isInitial:true on WebSocket open
    depends: []
```

### Stub Code

#### src/terminal/PTYManager.ts

```typescript
// Update PTYSession interface
interface PTYSession {
  pty: IPty;
  buffer: string[];
  cols: number;
  rows: number;
  ws?: WebSocket;
  hasReceivedResize: boolean;  // ADD
  deferReplay: boolean;        // ADD
}

// Update attach method
attach(sessionId: string, ws: WebSocket, options?: AttachOptions): void {
  const session = this.sessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  
  session.ws = ws;
  session.deferReplay = options?.deferReplay ?? false;
  session.hasReceivedResize = false;
  
  // TODO: Update onData handler to check hasReceivedResize
  // TODO: Only call replayBuffer if NOT deferReplay
}

// ADD new method
replayBuffer(sessionId: string, ws: WebSocket): void {
  // TODO: Send all buffered output to ws
}

// Update resize method
resize(sessionId: string, cols: number, rows: number): void {
  // TODO: Track wasFirst = !hasReceivedResize
  // TODO: Set hasReceivedResize = true
  // TODO: If wasFirst && deferReplay, call replayBuffer
}
```

#### src/routes/websocket.ts

```typescript
// In terminal connection handler
ptyManager.attach(sessionId, ws, { deferReplay: true });  // ADD deferReplay

// In resize message handler
// Handle isInitial flag (PTYManager handles replay internally)
```

#### ui/src/components/terminal/XTermTerminal.tsx

```typescript
// In WebSocket onopen handler
ws.onopen = () => {
  // ADD: Send initial resize immediately
  ws.send(JSON.stringify({
    type: 'resize',
    cols: terminal.cols,
    rows: terminal.rows,
    isInitial: true
  }));
  
  // ... rest of onopen logic
};
```

### Verification Checklist

- [x] All files from interface listed with tasks
- [x] Task dependencies form valid DAG
- [x] 6 tasks - appropriate for complexity
- [x] Clear dependency chain: types → attach → replay → resize
