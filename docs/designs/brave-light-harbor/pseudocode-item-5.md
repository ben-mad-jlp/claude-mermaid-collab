# Pseudocode: Item 5 - Status Indicator

## Backend: Status Endpoint

```
# src/server.ts

# Global status state
LET currentStatus = { status: 'idle', message: null, lastActivity: Date.now() }

FUNCTION updateStatus(status, message = null):
  currentStatus = {
    status: status,
    message: message,
    lastActivity: new Date().toISOString()
  }
  # Broadcast to connected WebSocket clients
  broadcastStatus(currentStatus)

# GET /api/status
app.get('/api/status', (req, res) => {
  res.json(currentStatus)
})

# Called when MCP tool starts
FUNCTION onToolStart(toolName):
  updateStatus('working', `Running ${toolName}...`)

# Called when waiting for user input (render_ui blocking)
FUNCTION onWaitingForInput():
  updateStatus('waiting', 'Waiting for input')

# Called when tool completes
FUNCTION onToolComplete():
  updateStatus('idle', null)
```

## Frontend: useAgentStatus Hook

```
FUNCTION useAgentStatus(pollInterval = 2000):
  [status, setStatus] = useState<AgentStatus>('idle')
  [message, setMessage] = useState<string | null>(null)
  [isLoading, setIsLoading] = useState(true)
  
  EFFECT [pollInterval]:
    # Initial fetch
    fetchStatus()
    
    # Set up WebSocket listener for real-time updates
    ws.on('status', (data) => {
      setStatus(data.status)
      setMessage(data.message)
      setIsLoading(false)
    })
    
    # Fallback polling if WebSocket not connected
    interval = setInterval(fetchStatus, pollInterval)
    
    CLEANUP:
      clearInterval(interval)
  
  ASYNC FUNCTION fetchStatus():
    TRY:
      response = await fetch('/api/status')
      data = await response.json()
      setStatus(data.status)
      setMessage(data.message)
      setIsLoading(false)
    CATCH:
      # Keep last known status on error
  
  RETURN { status, message, isLoading }
```

## Frontend: StatusIndicator Component

```
FUNCTION StatusIndicator({ status, message, className }):
  config = getStatusConfig(status)
  
  RETURN (
    <div className={cn("status-indicator", config.colorClass, className)}>
      IF status === 'working':
        <Spinner size="sm" />
      ELSE:
        <config.Icon />
      
      <span className="status-text">
        {message || config.defaultText}
      </span>
    </div>
  )

FUNCTION getStatusConfig(status):
  SWITCH status:
    CASE 'working':
      RETURN { Icon: null, colorClass: 'text-blue-500', defaultText: 'Working...' }
    CASE 'waiting':
      RETURN { Icon: InputIcon, colorClass: 'text-yellow-500', defaultText: 'Waiting for input' }
    CASE 'idle':
      RETURN { Icon: CheckIcon, colorClass: 'text-gray-400', defaultText: 'Ready' }
```

## Integration in Layout

```
FUNCTION Header():
  { status, message } = useAgentStatus()
  
  RETURN (
    <header className="app-header">
      <Logo />
      <StatusIndicator status={status} message={message} />
    </header>
  )
```
