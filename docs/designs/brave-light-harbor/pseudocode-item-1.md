# Pseudocode: Item 1 - Simplify UI Layout

## MessageArea Component

```
FUNCTION MessageArea({ content, className }):
  RETURN (
    <div className={cn("message-area", className)}>
      {content}
    </div>
  )
```

## EmbeddedTerminal Component

```
FUNCTION EmbeddedTerminal({ config, onConnectionChange, className }):
  terminalRef = useRef<HTMLDivElement>(null)
  { isConnected, error, reconnect } = useTerminal(config.wsUrl)
  
  EFFECT [isConnected]:
    IF onConnectionChange:
      onConnectionChange(isConnected)
  
  RETURN (
    <div className={cn("terminal-container", className)}>
      IF error:
        <div className="terminal-error">
          Connection failed: {error}
          <button onClick={reconnect}>Reconnect</button>
        </div>
      
      <div ref={terminalRef} className="terminal-viewport" />
    </div>
  )
```

## useTerminal Hook

```
FUNCTION useTerminal(wsUrl):
  terminalRef = useRef<HTMLDivElement>(null)
  xtermRef = useRef<Terminal>(null)
  wsRef = useRef<WebSocket>(null)
  [isConnected, setConnected] = useState(false)
  [error, setError] = useState<string | null>(null)
  
  FUNCTION connect():
    TRY:
      # Create xterm instance
      IF NOT xtermRef.current:
        xtermRef.current = new Terminal({
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, monospace',
          cursorBlink: true
        })
        xtermRef.current.open(terminalRef.current)
        fitAddon = new FitAddon()
        xtermRef.current.loadAddon(fitAddon)
        fitAddon.fit()
      
      # Connect WebSocket
      ws = new WebSocket(wsUrl)
      wsRef.current = ws
      
      ws.onopen = ():
        setConnected(true)
        setError(null)
      
      ws.onmessage = (event):
        xtermRef.current.write(event.data)
      
      ws.onclose = ():
        setConnected(false)
      
      ws.onerror = (e):
        setError("WebSocket connection failed")
        setConnected(false)
      
      # Send terminal input to WebSocket
      xtermRef.current.onData = (data):
        IF wsRef.current.readyState === WebSocket.OPEN:
          wsRef.current.send(data)
    
    CATCH err:
      setError(err.message)
  
  FUNCTION reconnect():
    IF wsRef.current:
      wsRef.current.close()
    connect()
  
  EFFECT [wsUrl]:
    connect()
    CLEANUP:
      IF wsRef.current:
        wsRef.current.close()
  
  RETURN { terminalRef, isConnected, error, reconnect }
```

## WorkspacePanel Layout Changes

```
FUNCTION WorkspacePanel():
  [messageContent, setMessageContent] = useState(null)
  
  # Handle render_ui messages
  EFFECT:
    websocket.on('render_ui', (ui) => {
      setMessageContent(<ComponentRenderer ui={ui} />)
    })
  
  RETURN (
    <div className="workspace-panel flex flex-col h-full">
      # Top: Message area (1/3 height)
      <div className="message-section flex-none h-1/3">
        <MessageArea content={messageContent} />
      </div>
      
      # Bottom: Terminal (2/3 height)
      <div className="terminal-section flex-1">
        <EmbeddedTerminal 
          config={{ wsUrl: 'ws://localhost:7681/ws' }}
        />
      </div>
    </div>
  )
```

## Error Handling

- WebSocket connection failure: Show reconnect button
- xterm.js load failure: Show fallback message
- Resize handling: Use FitAddon to auto-resize terminal
