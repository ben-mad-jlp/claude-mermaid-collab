# Skeleton: Item 1 - Simplify UI Layout

## File Stubs

### ui/src/types/terminal.ts (NEW)
```typescript
export interface TerminalConfig {
  wsUrl: string;
  fontSize?: number;
  fontFamily?: string;
}

export interface TerminalState {
  connected: boolean;
  error: string | null;
}
```

### ui/src/hooks/useTerminal.ts (NEW)
```typescript
import { useRef, useState, useEffect } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

export function useTerminal(wsUrl: string) {
  // TODO: Implement terminal connection logic
  // - Create xterm instance
  // - Connect WebSocket to ttyd
  // - Handle input/output
  // - Handle resize with FitAddon
  throw new Error('Not implemented');
}
```

### ui/src/components/MessageArea.tsx (NEW)
```typescript
import React from 'react';
import { cn } from '../lib/utils';

interface MessageAreaProps {
  content: React.ReactNode;
  className?: string;
}

export function MessageArea({ content, className }: MessageAreaProps) {
  // TODO: Render single message content
  throw new Error('Not implemented');
}
```

### ui/src/components/EmbeddedTerminal.tsx (NEW)
```typescript
import React from 'react';
import { TerminalConfig } from '../types/terminal';

interface EmbeddedTerminalProps {
  config: TerminalConfig;
  onConnectionChange?: (connected: boolean) => void;
  className?: string;
}

export function EmbeddedTerminal({ config, onConnectionChange, className }: EmbeddedTerminalProps) {
  // TODO: Implement terminal component
  // - Use useTerminal hook
  // - Render terminal container
  // - Show connection status/errors
  throw new Error('Not implemented');
}
```

### ui/src/components/WorkspacePanel.tsx (MODIFY)
```typescript
// TODO: Update layout to use MessageArea + EmbeddedTerminal split
// - Remove chat message list
// - Add vertical split layout
// - Top: MessageArea (1/3)
// - Bottom: EmbeddedTerminal (2/3)
```

## Dependencies

```bash
# New npm packages needed
cd ui && bun add xterm xterm-addon-fit
```

## Task Dependency Graph

```yaml
tasks:
  - id: term-types
    files: [ui/src/types/terminal.ts]
    description: Create terminal type definitions
    parallel: true

  - id: term-hook
    files: [ui/src/hooks/useTerminal.ts]
    description: Implement useTerminal hook with xterm.js and WebSocket
    depends-on: [term-types]

  - id: message-area
    files: [ui/src/components/MessageArea.tsx]
    description: Create MessageArea component for single message display
    parallel: true

  - id: embedded-terminal
    files: [ui/src/components/EmbeddedTerminal.tsx]
    description: Create EmbeddedTerminal component
    depends-on: [term-hook]

  - id: workspace-layout
    files: [ui/src/components/WorkspacePanel.tsx]
    description: Update WorkspacePanel with new split layout
    depends-on: [message-area, embedded-terminal]
```
