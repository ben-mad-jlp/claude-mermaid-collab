# Skeleton: Item 1 - Auto-start terminals

## Planned Files
- [ ] `ui/src/components/EmbeddedTerminal.tsx` - Modify existing file (simplify to auto-start)

**Note:** This file already exists - we're simplifying it, not creating it.

## File Contents

### Complete replacement for: ui/src/components/EmbeddedTerminal.tsx

```typescript
import React from 'react';
import type { TerminalConfig } from '../types/terminal';

export interface EmbeddedTerminalProps {
  config: TerminalConfig;
  /** Unique tmux session name for persistence across refreshes */
  sessionName?: string;
  className?: string;
}

/**
 * EmbeddedTerminal - Renders a ttyd terminal iframe
 * 
 * Terminals auto-start immediately on render (no "Start Terminal" button).
 * This prevents state reset issues when React remounts the component.
 */
export function EmbeddedTerminal({ config, sessionName, className = '' }: EmbeddedTerminalProps) {
  // Build iframe URL from WebSocket URL
  // ws://localhost:7681/ws -> http://localhost:7681
  let iframeUrl = config.wsUrl
    .replace('ws://', 'http://')
    .replace('wss://', 'https://')
    .replace('/ws', '');

  // Append session name for tmux session attachment
  // ttyd is started with: ttyd tmux new-session -A -s
  // The ?arg= parameter passes the session name to tmux
  if (sessionName) {
    iframeUrl += `?arg=${encodeURIComponent(sessionName)}`;
  }

  return (
    <div 
      className={`embedded-terminal ${className}`} 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%' 
      }}
    >
      <iframe
        src={iframeUrl}
        style={{
          flex: 1,
          border: 'none',
          background: '#1e1e1e',
        }}
        title="Terminal"
      />
    </div>
  );
}

EmbeddedTerminal.displayName = 'EmbeddedTerminal';
```

## Task Dependency Graph

```yaml
tasks:
  - id: auto-start-terminal
    files: [ui/src/components/EmbeddedTerminal.tsx]
    tests: [ui/src/components/EmbeddedTerminal.test.tsx, ui/src/components/__tests__/EmbeddedTerminal.test.tsx]
    description: Simplify EmbeddedTerminal to auto-start without button
    parallel: true
```

## Execution Order

**Wave 1 (parallel):**
- auto-start-terminal

Single task, no dependencies.

## Verification

- [x] File path matches existing file
- [x] Complete replacement documented
- [x] Types preserved from original
- [x] Removed: useState, useCallback, conditional rendering
- [x] No dependencies on other items
