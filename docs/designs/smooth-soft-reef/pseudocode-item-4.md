# Pseudocode: Item 4

## Fix terminal sizing to PTY

### src/terminal/PTYManager.ts

#### attach(sessionId, ws, options?)

```
FUNCTION attach(sessionId, ws, options = {}):
  session = this.sessions.get(sessionId)
  IF NOT session:
    THROW 'Session not found'
  
  // Store WebSocket reference
  session.ws = ws
  
  // Store defer flag
  session.deferReplay = options.deferReplay ?? false
  session.hasReceivedResize = false
  
  // Set up PTY output handler
  session.pty.onData((data) => {
    // Buffer all output
    session.buffer.push(data)
    
    // Only send to client if we've received initial resize
    // OR if deferReplay is false (legacy behavior)
    IF session.hasReceivedResize OR NOT session.deferReplay:
      ws.send(JSON.stringify({ type: 'output', data }))
  })
  
  // DON'T replay buffer here anymore
  // Wait for resize message first (if deferReplay)
  IF NOT session.deferReplay:
    this.replayBuffer(sessionId, ws)
```

#### replayBuffer(sessionId, ws)

```
FUNCTION replayBuffer(sessionId, ws):
  session = this.sessions.get(sessionId)
  IF NOT session OR session.buffer.length === 0:
    RETURN
  
  // Send all buffered output
  FOR data IN session.buffer:
    ws.send(JSON.stringify({ type: 'output', data }))
  
  // Note: Don't clear buffer - keep for reconnection scenarios
```

#### resize(sessionId, cols, rows)

```
FUNCTION resize(sessionId, cols, rows):
  session = this.sessions.get(sessionId)
  IF NOT session:
    RETURN
  
  // Resize PTY
  session.pty.resize(cols, rows)
  session.cols = cols
  session.rows = rows
  
  // Mark that we've received resize (for deferred replay)
  wasFirst = NOT session.hasReceivedResize
  session.hasReceivedResize = true
  
  // If this was the first resize and we were deferring, replay now
  IF wasFirst AND session.deferReplay AND session.ws:
    this.replayBuffer(sessionId, session.ws)
```

### src/routes/websocket.ts

#### Handle resize message

```
CASE 'resize':
  cols = message.cols
  rows = message.rows
  isInitial = message.isInitial ?? false
  
  // Call PTYManager resize
  ptyManager.resize(sessionId, cols, rows)
  
  // If initial resize, PTYManager will replay buffer automatically
```

### ui/src/components/terminal/XTermTerminal.tsx

#### WebSocket onopen handler

```
ws.onopen = () => {
  // IMPORTANT: Send resize FIRST before expecting any output
  cols = terminal.cols
  rows = terminal.rows
  
  ws.send(JSON.stringify({
    type: 'resize',
    cols,
    rows,
    isInitial: true  // Signal this is the first resize
  }))
  
  // Now safe to receive output
  setConnected(true)
}
```

#### FitAddon resize handler

```
fitAddon.fit()

// Send resize to server
IF ws.readyState === WebSocket.OPEN:
  ws.send(JSON.stringify({
    type: 'resize',
    cols: terminal.cols,
    rows: terminal.rows,
    isInitial: false
  }))
```

### Verification

- [x] All functions from interface covered
- [x] Buffer replay deferred until after first resize
- [x] Client sends resize immediately on connect
- [x] PTY dimensions correct before output displayed
- [x] Handles reconnection (buffer preserved)
