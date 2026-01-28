# Pseudocode: Item 3

## Add terminal button to terminal tab

### ui/src/components/mobile/TerminalTab.tsx

#### TerminalTab component

```
FUNCTION TerminalTab({ terminalId, onCreateTerminal }):
  IF terminalId is null:
    RETURN (
      <EmptyState>
        <Icon type="terminal" />
        <Text>No active terminal</Text>
        <Button 
          variant="accent"
          onClick={onCreateTerminal}
          disabled={!onCreateTerminal}
        >
          New Terminal
        </Button>
      </EmptyState>
    )
  
  // Existing terminal rendering logic
  RETURN (
    <XTermTerminal terminalId={terminalId} />
  )
```

### ui/src/components/mobile/MobileLayout.tsx

#### handleCreateTerminal function

```
FUNCTION handleCreateTerminal():
  TRY:
    // Create terminal via WebSocket or API
    // Option A: WebSocket message
    ws.send({ type: 'terminal:create', project, session })
    
    // Option B: REST API
    response = await fetch('/api/terminal/create', {
      method: 'POST',
      body: JSON.stringify({ project, session })
    })
    data = await response.json()
    
    // Update state with new terminal ID
    setTerminalId(data.terminalId)
    
    // Auto-switch to terminal tab
    setActiveTab('terminal')
    
  CATCH error:
    console.error('Failed to create terminal:', error)
    // Show error toast/notification
```

#### MobileLayout component (relevant parts)

```
FUNCTION MobileLayout():
  // Existing state
  [terminalId, setTerminalId] = useState(null)
  [activeTab, setActiveTab] = useState('preview')
  
  // Pass callback to TerminalTab
  RETURN (
    <Tabs>
      <Tab id="terminal">
        <TerminalTab 
          terminalId={terminalId}
          onCreateTerminal={handleCreateTerminal}
        />
      </Tab>
    </Tabs>
  )
```

### Verification

- [x] All functions from interface document covered
- [x] Button only shown in empty state
- [x] Callback properly wired from parent to child
- [x] Error handling included
