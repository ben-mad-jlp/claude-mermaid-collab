# Interface: Item 5 - Status Indicator

## File Structure
- `ui/src/components/StatusIndicator.tsx` - Status display (NEW)
- `ui/src/hooks/useAgentStatus.ts` - Status polling/subscription (NEW)
- `src/server.ts` - Add status endpoint

## Type Definitions

```typescript
// ui/src/types/status.ts
type AgentStatus = 'working' | 'waiting' | 'idle';

interface StatusState {
  status: AgentStatus;
  message?: string;  // Optional detail like "Running tests..."
}
```

## API Endpoint

```typescript
// src/server.ts
// GET /api/status
interface StatusResponse {
  status: AgentStatus;
  message?: string;
  lastActivity: string;  // ISO timestamp
}
```

## Component Interfaces

```typescript
// ui/src/components/StatusIndicator.tsx
interface StatusIndicatorProps {
  status: AgentStatus;
  message?: string;
  className?: string;
}
```

## Hook Interfaces

```typescript
// ui/src/hooks/useAgentStatus.ts
function useAgentStatus(pollInterval?: number): {
  status: AgentStatus;
  message?: string;
  isLoading: boolean;
}
```

## Visual States
| Status | Icon | Color | Text |
|--------|------|-------|------|
| working | Spinner | Blue | "Working..." or custom message |
| waiting | Input icon | Yellow | "Waiting for input" |
| idle | Check | Gray | "Ready" |

## Component Interactions
- `StatusIndicator` placed in header or near message area
- `useAgentStatus` polls `/api/status` endpoint
- MCP tools update status via internal state
- render_ui calls can include status updates
