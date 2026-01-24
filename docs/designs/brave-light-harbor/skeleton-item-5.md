# Skeleton: Item 5 - Status Indicator

## File Stubs

### ui/src/types/status.ts (NEW)
```typescript
export type AgentStatus = 'working' | 'waiting' | 'idle';

export interface StatusState {
  status: AgentStatus;
  message?: string;
}

export interface StatusResponse {
  status: AgentStatus;
  message?: string;
  lastActivity: string;
}
```

### src/server.ts (MODIFY)
```typescript
// TODO: Add status tracking and endpoint
// - Global status state variable
// - updateStatus() function
// - GET /api/status endpoint
// - WebSocket broadcast for status changes
```

### ui/src/hooks/useAgentStatus.ts (NEW)
```typescript
import { useState, useEffect } from 'react';
import { AgentStatus } from '../types/status';

export function useAgentStatus(pollInterval = 2000) {
  // TODO: Implement status polling/subscription
  // - Fetch from /api/status
  // - Listen for WebSocket updates
  // - Fallback to polling
  throw new Error('Not implemented');
}
```

### ui/src/components/StatusIndicator.tsx (NEW)
```typescript
import React from 'react';
import { AgentStatus } from '../types/status';

interface StatusIndicatorProps {
  status: AgentStatus;
  message?: string;
  className?: string;
}

export function StatusIndicator({ status, message, className }: StatusIndicatorProps) {
  // TODO: Implement status indicator
  // - Show spinner for 'working'
  // - Show appropriate icon for other states
  // - Display status text
  throw new Error('Not implemented');
}
```

## Task Dependency Graph

```yaml
tasks:
  - id: status-types
    files: [ui/src/types/status.ts]
    description: Create status type definitions
    parallel: true

  - id: status-endpoint
    files: [src/server.ts]
    description: Add status tracking and /api/status endpoint
    parallel: true

  - id: status-hook
    files: [ui/src/hooks/useAgentStatus.ts]
    description: Implement useAgentStatus hook
    depends-on: [status-types, status-endpoint]

  - id: status-indicator
    files: [ui/src/components/StatusIndicator.tsx]
    description: Implement StatusIndicator component
    depends-on: [status-types]

  - id: status-integration
    files: [ui/src/components/Header.tsx]
    description: Add StatusIndicator to header
    depends-on: [status-hook, status-indicator]
```
