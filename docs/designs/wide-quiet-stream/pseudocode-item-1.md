# Pseudocode: Item 1 - Replace tmux with PTY Manager

## RingBuffer

### constructor(maxLines = 10_000)

```
1. Initialize empty lines array
2. Store maxLines limit
```

### write(data: string)

```
1. Split data by newline characters
2. For each line:
   a. Append to lines array
   b. If lines.length > maxLines:
      - Remove oldest line (shift from front)
3. Update lastActivity timestamp
```

**Edge Cases:**
- Empty string: No-op, return immediately
- Data with no newlines: Treat as single partial line
- Very large single write: Split and process normally

### getContents(): string

```
1. Join all lines with newline separator
2. Return joined string
```

### clear()

```
1. Reset lines array to empty
```

---

## PTYManager

### constructor()

```
1. Initialize empty sessions Map
```

### create(sessionId, options?): Promise<PTYSessionInfo>

```
1. Check if sessionId already exists
   - If exists: throw Error("Session already exists")

2. Determine shell:
   a. Use options.shell if provided
   b. Else use $SHELL environment variable
   c. Else try fallback chain: zsh -> bash -> sh
   d. Verify shell exists (check file exists)
   - If no valid shell: throw Error("No shell available")

3. Spawn PTY subprocess:
   - Command: [shell]
   - cwd: options.cwd or process.cwd()
   - env: inherit process.env
   - stdin: pipe
   - stdout: pipe
   - stderr: pipe (merge with stdout)
   - pty: { cols: options.cols || 80, rows: options.rows || 24 }

4. Create PTYSession object:
   - id: sessionId
   - pty: spawned subprocess
   - buffer: new RingBuffer()
   - websockets: new Set()
   - shell, cwd, createdAt: now, lastActivity: now

5. Set up PTY output handler:
   - On data: write to buffer, broadcast to all websockets

6. Set up PTY exit handler:
   - On exit: broadcast exit message, cleanup session

7. Store session in Map

8. Return session info
```

**Error Handling:**
- Spawn failure: Log error, throw with message
- Invalid sessionId (empty/whitespace): throw Error("Invalid session ID")

**Edge Cases:**
- Session ID with special characters: Allow (user responsibility)
- Shell not executable: Caught by spawn, throw descriptive error

### write(sessionId, data)

```
1. Get session from Map
   - If not found: throw Error("Session not found")

2. Write data to session.pty.stdin

3. Update session.lastActivity
```

**Error Handling:**
- PTY stdin closed: Log warning, no-op (session likely exiting)

### resize(sessionId, cols, rows)

```
1. Get session from Map
   - If not found: throw Error("Session not found")

2. Call pty.resize(cols, rows) if supported by Bun
   - If not supported: Log warning, no-op

3. Update session.lastActivity
```

### attach(sessionId, ws)

```
1. Get session from Map
   - If not found: 
     a. Auto-create session with default options
     b. Get newly created session

2. Add ws to session.websockets Set

3. Replay buffer contents to this ws:
   - Send { type: "output", data: buffer.getContents() }

4. Update session.lastActivity
```

**Edge Cases:**
- WebSocket already attached: Set handles duplicates, no-op
- Very large buffer: Send in single message (xterm handles chunking)

### detach(sessionId, ws)

```
1. Get session from Map
   - If not found: return (no-op, session may have been killed)

2. Remove ws from session.websockets Set

3. PTY continues running (no cleanup on detach)
```

### kill(sessionId)

```
1. Get session from Map
   - If not found: return (already killed, no-op)

2. Broadcast exit message to all websockets:
   - Send { type: "exit", code: -1 }

3. Close all websockets in session.websockets

4. Kill PTY process:
   - session.pty.kill()

5. Clear buffer:
   - session.buffer.clear()

6. Remove session from Map
```

**Error Handling:**
- PTY already dead: No-op on kill attempt
- WebSocket already closed: Catch and ignore send errors

### list(): PTYSessionInfo[]

```
1. Map over sessions.values()
2. For each session, return:
   - id, shell, cwd, createdAt, lastActivity
   - connectedClients: session.websockets.size
```

### has(sessionId): boolean

```
1. Return sessions.has(sessionId)
```

### get(sessionId): PTYSessionInfo | undefined

```
1. Get session from Map
2. If not found: return undefined
3. Return session info object
```

### killAll()

```
1. For each sessionId in sessions.keys():
   a. Call this.kill(sessionId)
```

---

## WebSocket Handler (/terminal/:sessionId)

### onOpen(ws)

```
1. Extract sessionId from URL path

2. Call ptyManager.attach(sessionId, ws)
   - This auto-creates session if needed
   - This replays buffer to ws
```

**Error Handling:**
- attach() throws: Send error message, close ws

### onMessage(ws, message)

```
1. Parse message as JSON
   - If invalid JSON: Log warning, ignore

2. Switch on message.type:
   
   case "input":
     - Call ptyManager.write(sessionId, message.data)
   
   case "resize":
     - Call ptyManager.resize(sessionId, message.cols, message.rows)
   
   default:
     - Log warning: unknown message type
```

**Error Handling:**
- write() or resize() throws: Send error message to ws

### onClose(ws)

```
1. Extract sessionId from URL path

2. Call ptyManager.detach(sessionId, ws)
```

### onError(ws, error)

```
1. Log error

2. Call ptyManager.detach(sessionId, ws)
```

---

## REST API Routes

### POST /api/terminal/sessions

```
1. Parse request body for { id?, shell?, cwd? }

2. Generate sessionId if not provided:
   - Use crypto.randomUUID()

3. Call ptyManager.create(sessionId, { shell, cwd })

4. Return session info as JSON
```

**Error Handling:**
- create() throws: Return 400 with error message

### GET /api/terminal/sessions

```
1. Call ptyManager.list()

2. Return array as JSON
```

### DELETE /api/terminal/sessions/:id

```
1. Extract sessionId from URL params

2. Check if session exists:
   - If not: Return 404

3. Call ptyManager.kill(sessionId)

4. Return { success: true }
```

### POST /api/terminal/sessions/:id/rename

```
1. Extract sessionId from URL params
2. Parse request body for { name }

3. Check if session exists:
   - If not: Return 404

4. Note: Renaming just returns success (session ID is immutable)
   - Could track display names separately if needed

5. Return { success: true, id: sessionId }
```

---

## Server Initialization (src/server.ts)

### On server start

```
1. Import ptyManager singleton

2. Register shutdown handler:
   - On SIGINT/SIGTERM: call ptyManager.killAll()
```

---

## Verification Checklist

- [x] Every function from Interface has pseudocode
- [x] Error handling is explicit for each function
- [x] Edge cases are identified
- [x] External dependencies are noted (Bun.spawn, process.env)
