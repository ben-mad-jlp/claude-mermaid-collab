# Interface: Item 4 - Terminal selection without copying (xterm.js)

## File Structure
- `ui/src/components/terminal/XTermTerminal.tsx` - **CREATE** new component
- `ui/src/components/EmbeddedTerminal.tsx` - Modify to use new component
- `ui/src/components/terminal/TerminalTabsContainer.tsx` - Update imports

## Type Definitions

```typescript
// ui/src/components/terminal/XTermTerminal.tsx

export interface XTermTerminalProps {
  wsUrl: string;           // WebSocket URL for ttyd connection
  onReady?: () => void;    // Callback when terminal is ready
  onDisconnect?: () => void; // Callback when connection lost
  className?: string;      // Optional CSS class
}
```

## Function Signatures

```typescript
// ui/src/components/terminal/XTermTerminal.tsx

export const XTermTerminal: React.FC<XTermTerminalProps>

// Internal functions (not exported)
function handleContextMenu(e: MouseEvent, term: Terminal): void
function handleResize(term: Terminal, fitAddon: FitAddon): void
```

## Dependencies (existing in package.json)
- `@xterm/xterm` - Terminal emulator
- `@xterm/addon-attach` - WebSocket attachment
- `@xterm/addon-fit` - Auto-resize terminal

## Component Interactions

```
TerminalTabsContainer
  └── EmbeddedTerminal
        └── XTermTerminal (NEW)
              ├── Terminal (xterm.js instance)
              ├── AttachAddon (WebSocket → ttyd)
              └── FitAddon (resize handling)

XTermTerminal:
  - Creates Terminal with { scrollback: 10000, rightClickSelectsWord: false }
  - Attaches WebSocket to ttyd backend (existing port 7681)
  - contextmenu event → term.getSelection() → navigator.clipboard.writeText()
```

## EmbeddedTerminal Changes

```typescript
// ui/src/components/EmbeddedTerminal.tsx
// BEFORE: renders iframe with ttyd URL
// AFTER: renders XTermTerminal with wsUrl prop

interface EmbeddedTerminalProps {
  wsUrl: string;  // Changed from full ttyd URL to WebSocket URL
}

export const EmbeddedTerminal: React.FC<EmbeddedTerminalProps>
```
