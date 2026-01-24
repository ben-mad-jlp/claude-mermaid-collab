# Interface: Item 1 - Simplify UI Layout

## File Structure
- `ui/src/components/MessageArea.tsx` - Single message display (NEW)
- `ui/src/components/EmbeddedTerminal.tsx` - xterm.js terminal (NEW)
- `ui/src/components/WorkspacePanel.tsx` - Modified to use new layout
- `ui/src/hooks/useTerminal.ts` - Terminal connection hook (NEW)

## Type Definitions

```typescript
// ui/src/types/terminal.ts
interface TerminalConfig {
  wsUrl: string;           // WebSocket URL for ttyd (ws://localhost:7681/ws)
  fontSize?: number;
  fontFamily?: string;
}

interface TerminalState {
  connected: boolean;
  error: string | null;
}
```

## Component Interfaces

```typescript
// ui/src/components/MessageArea.tsx
interface MessageAreaProps {
  content: React.ReactNode;  // Current message content (replaces on each update)
  className?: string;
}

// ui/src/components/EmbeddedTerminal.tsx  
interface EmbeddedTerminalProps {
  config: TerminalConfig;
  onConnectionChange?: (connected: boolean) => void;
  className?: string;
}
```

## Hook Interfaces

```typescript
// ui/src/hooks/useTerminal.ts
function useTerminal(wsUrl: string): {
  terminalRef: React.RefObject<HTMLDivElement>;
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}
```

## Component Interactions
- `WorkspacePanel` renders `MessageArea` (top) and `EmbeddedTerminal` (bottom) in vertical split
- `MessageArea` receives content from parent (render_ui responses)
- `EmbeddedTerminal` connects to ttyd via WebSocket, manages xterm.js instance
- `useTerminal` hook handles WebSocket lifecycle and xterm.js setup
