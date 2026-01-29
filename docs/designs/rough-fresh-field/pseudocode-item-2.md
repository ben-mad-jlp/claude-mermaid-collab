# Pseudocode: Item 2 - Fix Terminal Button on Mobile UI

## MobileLayout Component Modifications

### State Addition

```
1. Existing state:
   - terminalId: string | null (line 67)

2. Add new state:
   - terminalWsUrl: string | null
   - Initialize to null
```

### handleCreateTerminal Modification

```
1. Get current session from sessions array
   - If sessions.length === 0: 
     - console.error('No active session available')
     - return early

2. Try block:
   a. Call api.createTerminalSession(session.project, session.name)
      - Returns: { id: string, tmuxSession: string, wsUrl: string }
   
   b. Store BOTH values from result:
      - setTerminalId(result.id)
      - setTerminalWsUrl(result.wsUrl)  // NEW
   
   c. Auto-switch to terminal tab:
      - setActiveTab('terminal')

3. Catch block:
   - console.error('Failed to create terminal:', error)
   - (Future: could show error toast/notification)
```

### Computed Terminal Config (new useMemo)

```
1. Check if both terminalId AND terminalWsUrl exist:
   - If both exist: return { sessionId: terminalId, wsUrl: terminalWsUrl }
   - If either missing: return null

Dependencies: [terminalId, terminalWsUrl]
```

### TerminalTab Props Update

```
Current (hardcoded):
  terminal={null}
  hasSession={false}

After (connected):
  terminal={terminalConfig}
  hasSession={terminalConfig !== null}
```

### Alternative: Inline Ternary (simpler)

```
If not using useMemo, inline in JSX:
  terminal={terminalId && terminalWsUrl 
    ? { sessionId: terminalId, wsUrl: terminalWsUrl } 
    : null}
  hasSession={terminalId !== null && terminalWsUrl !== null}
```

## Error Handling

- **No active session**: Log error, return early (button does nothing)
- **API failure**: Catch, log error, state unchanged (button can be retried)
- **Partial state**: Only update UI when BOTH id and wsUrl are available

## Edge Cases

- **Multiple clicks**: Each click creates new terminal, overwrites previous
  - Acceptable for now, future: could prevent if terminal already exists
- **Session switch**: Terminal state persists (may need reset on session change)
  - Future enhancement: clear terminal state when session changes
- **Network error during creation**: Caught, logged, UI shows "New Terminal" button again
- **Tab switch during creation**: Async completes, auto-switches to terminal tab

## External Dependencies

- `api.createTerminalSession(project, session)` - Already implemented
- Returns `CreateSessionResult` type from `ui/src/types/terminal.ts`
- XTermTerminal component - Already works when given valid sessionId/wsUrl

## Data Flow Summary

```
User clicks "New Terminal"
    ↓
handleCreateTerminal()
    ↓
api.createTerminalSession() → { id, tmuxSession, wsUrl }
    ↓
setTerminalId(id) + setTerminalWsUrl(wsUrl)
    ↓
terminalConfig = { sessionId: id, wsUrl: wsUrl }
    ↓
TerminalTab receives terminal={terminalConfig}, hasSession={true}
    ↓
XTermTerminal renders with WebSocket connection
    ↓
Terminal visible and interactive
```
