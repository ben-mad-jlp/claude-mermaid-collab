# Wave 1 & 2 Implementation — Design Echo Fix

## Wave 1 (3 tasks, parallel)

### ws-client-id
- **File:** `ui/src/lib/websocket.ts`
- **Change:** Added `readonly clientId: string = crypto.randomUUID()` as first property of `WebSocketClient` class

### server-relay-sender
- **File:** `src/websocket/handler.ts`
- **Change:** Added 4 design-related WSMessage type variants (`design_updated` with `sender?: string`, `design_created`, `design_deleted`, `design_history_updated`)
- **File:** `src/routes/api.ts`
- **Change:** Reads `x-client-id` header from request, includes as `sender` field in `design_updated` broadcast

### silent-catch-logging
- **File:** `ui/src/hooks/useDesignSync.ts`
- **Change:** Replaced 2 silent `catch {}` blocks with `catch (err) { console.warn(...) }` for load and remote update deserialization

## Wave 2 (2 tasks, sequential dependencies)

### api-client-id-header
- **File:** `ui/src/lib/api.ts`
- **Change:** Added `import { getWebSocketClient } from './websocket'` and `X-Client-Id` header to `updateDesign()` fetch call

### client-echo-filter
- **File:** `ui/src/App.tsx`
- **Change:** Added `sender` destructuring and `if (sender && sender === client.clientId) break` guard to `design_updated` case

## Verification
- Frontend TypeScript: zero errors
- Backend TypeScript: pre-existing test errors only, no new errors
- Tests: 115 failures all pre-existing in unrelated files
- All 5 tasks marked completed
