# Skeleton: Item 4 - Terminal selection without copying (xterm.js)

## Planned Files
- [ ] `ui/src/components/terminal/XTermTerminal.tsx` - **CREATE NEW**
- [ ] `ui/src/components/EmbeddedTerminal.tsx` - Modify existing

**Note:** One new file to create, one existing file to modify.

## File Contents

### ui/src/components/terminal/XTermTerminal.tsx (CREATE)

```typescript
import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { AttachAddon } from '@xterm/addon-attach';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface XTermTerminalProps {
  wsUrl: string;
  onReady?: () => void;
  onDisconnect?: () => void;
  className?: string;
}

export const XTermTerminal: React.FC<XTermTerminalProps> = ({
  wsUrl,
  onReady,
  onDisconnect,
  className,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // TODO: Create Terminal instance with config
    // - scrollback: 10000
    // - rightClickSelectsWord: false
    // - cursorBlink: true
    
    // TODO: Open terminal in DOM
    
    // TODO: Load FitAddon and fit
    
    // TODO: Connect WebSocket and load AttachAddon
    
    // TODO: Add contextmenu handler for right-click copy
    
    // TODO: Add ResizeObserver for responsive sizing
    
    // TODO: Call onReady callback
    
    // TODO: Return cleanup function
    
    throw new Error('Not implemented');
  }, [wsUrl, onReady, onDisconnect]);

  return (
    <div 
      ref={terminalRef} 
      className={className}
      style={{ width: '100%', height: '100%' }}
    />
  );
};
```

### ui/src/components/EmbeddedTerminal.tsx (MODIFY)

```typescript
// TODO: Replace iframe with XTermTerminal component
// 
// BEFORE:
//   <iframe src={ttydUrl} ... />
//
// AFTER:
//   <XTermTerminal wsUrl={wsUrl} />
//
// Note: Derive wsUrl from existing configuration
// e.g., ws://localhost:7681/ws for the terminal session
```

## Task Dependency Graph

```yaml
tasks:
  - id: item-4-xterm-component
    files: [ui/src/components/terminal/XTermTerminal.tsx]
    tests: [ui/src/components/terminal/XTermTerminal.test.tsx, ui/src/components/terminal/__tests__/XTermTerminal.test.tsx]
    description: Create new XTermTerminal component with xterm.js
    parallel: true

  - id: item-4-embedded-terminal
    files: [ui/src/components/EmbeddedTerminal.tsx]
    tests: [ui/src/components/EmbeddedTerminal.test.tsx, ui/src/components/__tests__/EmbeddedTerminal.test.tsx]
    description: Update EmbeddedTerminal to use XTermTerminal instead of iframe
    depends-on: [item-4-xterm-component]
```

## Execution Order

**Wave 1 (parallel-safe):**
- item-4-xterm-component

**Wave 2 (depends on Wave 1):**
- item-4-embedded-terminal

## Verification
- [ ] XTermTerminal.tsx created with correct interface
- [ ] Terminal configured with rightClickSelectsWord: false
- [ ] contextmenu handler copies selection to clipboard
- [ ] EmbeddedTerminal uses XTermTerminal instead of iframe
