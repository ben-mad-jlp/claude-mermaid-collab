# Interface Definition - Item 2: Fix Terminal Button on Mobile UI

## File Structure

- `ui/src/components/layout/MobileLayout.tsx` - **MODIFY** - Connect terminal state to TerminalTab props

## Type Definitions

No new types needed. Uses existing:

```typescript
// Already defined in ui/src/components/mobile/TerminalTab.tsx
export interface TerminalConfig {
  sessionId: string;
  wsUrl: string;
}

// API response type from ui/src/types/terminal.ts
export interface CreateSessionResult {
  id: string;
  tmuxSession: string;
  wsUrl: string;
}
```

## Interface Changes

### MobileLayout State (AFTER)

```typescript
// ui/src/components/layout/MobileLayout.tsx

// Current state (line 67)
const [terminalId, setTerminalId] = useState<string | null>(null);

// ADD: Store wsUrl alongside terminalId
const [terminalWsUrl, setTerminalWsUrl] = useState<string | null>(null);
```

### handleCreateTerminal (AFTER)

```typescript
// Current (lines 90-102) stores only id:
const result = await api.createTerminalSession(session.project, session.name);
setTerminalId(result.id);  // Only stores id

// AFTER: Store both id and wsUrl
const result = await api.createTerminalSession(session.project, session.name);
setTerminalId(result.id);
setTerminalWsUrl(result.wsUrl);  // ADD: Store wsUrl too
setActiveTab('terminal');
```

### TerminalTab Props (AFTER)

```typescript
// Current (lines 166-170):
<TerminalTab
  terminal={null}              // HARDCODED
  hasSession={false}           // HARDCODED
  onCreateTerminal={handleCreateTerminal}
/>

// AFTER: Connect actual state
<TerminalTab
  terminal={terminalId && terminalWsUrl ? { sessionId: terminalId, wsUrl: terminalWsUrl } : null}
  hasSession={terminalId !== null}
  onCreateTerminal={handleCreateTerminal}
/>
```

### Computed Terminal Config

```typescript
// Option: Use useMemo for the terminal config object
const terminalConfig: TerminalConfig | null = useMemo(() => {
  if (terminalId && terminalWsUrl) {
    return { sessionId: terminalId, wsUrl: terminalWsUrl };
  }
  return null;
}, [terminalId, terminalWsUrl]);

// Then in JSX:
<TerminalTab
  terminal={terminalConfig}
  hasSession={terminalConfig !== null}
  onCreateTerminal={handleCreateTerminal}
/>
```

## Component Interactions

```
MobileLayout
  ├── State
  │    ├── terminalId: string | null
  │    └── terminalWsUrl: string | null (NEW)
  │
  ├── handleCreateTerminal()
  │    └── api.createTerminalSession() → { id, tmuxSession, wsUrl }
  │         ├── setTerminalId(result.id)
  │         └── setTerminalWsUrl(result.wsUrl) (NEW)
  │
  └── TerminalTab
       ├── terminal: { sessionId, wsUrl } | null (CONNECTED)
       ├── hasSession: boolean (CONNECTED)
       └── onCreateTerminal: () => void
            └── XTermTerminal (when hasSession && terminal)
                 ├── sessionId
                 └── wsUrl
```

## Data Flow (AFTER)

1. User clicks "New Terminal" button
2. `handleCreateTerminal()` called
3. `api.createTerminalSession()` returns `{ id, tmuxSession, wsUrl }`
4. State updated: `terminalId = id`, `terminalWsUrl = wsUrl`
5. `terminalConfig` computed: `{ sessionId: id, wsUrl: wsUrl }`
6. `TerminalTab` receives: `terminal={terminalConfig}`, `hasSession={true}`
7. `TerminalTab` renders `XTermTerminal` with sessionId and wsUrl
8. Terminal is visible and interactive
