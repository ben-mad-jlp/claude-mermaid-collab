# Blueprint: Fix Design Rendering Save-Echo Loop

## Source Artifacts
- `design-render-fix` — Design document analyzing the save-echo loop that causes design artifacts to disappear

## 1. Structure Summary

### Files

- [ ] `ui/src/lib/websocket.ts` — Add `clientId` property to `WebSocketClient` class
- [ ] `ui/src/lib/api.ts` — Send `X-Client-Id` header on design update requests
- [ ] `src/websocket/handler.ts` — Add `sender?: string` to `WSMessage` type union
- [ ] `src/routes/api.ts` — Read `X-Client-Id` header, relay as `sender` in broadcast
- [ ] `ui/src/App.tsx` — Filter out own `design_updated` messages by comparing `sender` to `clientId`
- [ ] `ui/src/hooks/useDesignSync.ts` — Add `console.warn` to silent catch blocks (secondary fix)

### Type Definitions

```typescript
// websocket/handler.ts — WSMessage union member update
| { type: 'design_updated'; id: string; content: string; sender?: string; project: string; session: string }

// WebSocketClient class — new public property
readonly clientId: string
```

### Component Interactions

```
HTTP: api.updateDesign() --[X-Client-Id header]--> routes/api.ts
                                                        |
                                                        v
WS:  wsHandler.broadcast({ ..., sender: clientId }) --> App.tsx
                                                        |
                                                        v
                                              if sender === myClientId → skip
                                              else → sessionStore.updateDesign()
                                                        |
                                                        v
                                              DesignEditor → handleRemoteUpdate()
```

The key insight: HTTP and WS don't need to be correlated on the server. The client generates a UUID, sends it on both channels, and the server just relays it in the broadcast payload.

---

## 2. Function Blueprints

### Task 1: `WebSocketClient.clientId` (websocket.ts)

**Location:** `ui/src/lib/websocket.ts` line 123, class property

**Change:** Add a public readonly `clientId` property initialized with `crypto.randomUUID()`.

```typescript
export class WebSocketClient {
  readonly clientId: string = crypto.randomUUID()
  private socket: WebSocket | null = null;
  // ... rest unchanged
```

**Pseudocode:**
1. Add `readonly clientId` as first property of `WebSocketClient` class
2. Initialize inline with `crypto.randomUUID()`

**Error handling:** None needed — `crypto.randomUUID()` is available in all modern browsers and has no failure mode.

**Edge cases:**
- ID is stable across WS reconnections (same `WebSocketClient` instance)
- ID changes on page reload (new instance) — correct behavior, new tab = new client

**Test strategy:** Unit test that `getWebSocketClient().clientId` is a valid UUID string and is stable across multiple calls.

---

### Task 2: `api.updateDesign()` header (api.ts)

**Location:** `ui/src/lib/api.ts` line 452-464

**Change:** Add `X-Client-Id` header to the fetch request, sourced from the shared WebSocketClient singleton.

```typescript
async updateDesign(project: string, session: string, id: string, content: string): Promise<void> {
  const url = `/api/design/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': getWebSocketClient().clientId,
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(response.statusText);
  }
},
```

**Pseudocode:**
1. Import `getWebSocketClient` from `./websocket`
2. Add `'X-Client-Id': getWebSocketClient().clientId` to headers object

**Error handling:** If `getWebSocketClient()` hasn't been called yet, it creates the singleton — safe to call at any time.

**Edge cases:**
- The singleton is always created before saves happen (App.tsx creates it on mount)
- Header is ignored by server if not recognized — backward compatible

**Test strategy:** Existing `api.test.ts` — add a test that `updateDesign` sends the `X-Client-Id` header.

---

### Task 3: `WSMessage` type + broadcast relay (handler.ts + api.ts)

**Location:** `src/websocket/handler.ts` line 14-38 (type) and `src/routes/api.ts` lines 955-1033 (handler)

**Change A — Type:** Add `sender?: string` to the `design_updated` WSMessage variant.

**Change B — Relay:** In the design update route handler, read `X-Client-Id` from the request and include it as `sender` in the broadcast.

```typescript
// handler.ts — update the type union member
| { type: 'design_updated'; id: string; content: string; sender?: string; project: string; session: string }

// api.ts — in the design update handler, after line 1026
const clientId = req.headers.get('x-client-id') || undefined;

wsHandler.broadcast({
  type: 'design_updated',
  id,
  content,
  sender: clientId,
  project: params.project,
  session: params.session,
});
```

**Pseudocode:**
1. In `handler.ts`: add `sender?: string` to the `design_updated` union member
2. In `api.ts` line ~1027: read `req.headers.get('x-client-id')`
3. Include `sender: clientId` in the broadcast message object

**Error handling:** If header is missing, `sender` is `undefined` — client-side filter won't match, message is processed normally (safe degradation).

**Edge cases:**
- MCP tool calls don't send `X-Client-Id` → `sender` is undefined → broadcast reaches all clients → correct (MCP changes should always be applied)
- `req.headers.get()` returns `null` for missing headers → `|| undefined` normalizes to `undefined`

**Test strategy:** Integration test: POST to `/api/design/:id` with and without `X-Client-Id` header, verify broadcast payload includes/omits `sender`.

---

### Task 4: Client-side echo filter (App.tsx)

**Location:** `ui/src/App.tsx` lines 538-548

**Change:** Before processing `design_updated`, check if `sender` matches local `clientId`. If so, skip.

```typescript
case 'design_updated': {
  const { id, content, project, session, sender } = message as any;
  // Skip our own save echoed back
  if (sender && sender === client.clientId) break;
  if (id &&
      currentSession &&
      project === currentSession.project &&
      session === currentSession.name) {
    updateDesign(id, { content, lastModified: Date.now() });
  }
  break;
}
```

**Pseudocode:**
1. Destructure `sender` from the message
2. If `sender` is truthy and equals `client.clientId`, break immediately
3. Otherwise proceed with existing logic

**Error handling:** `sender` may be `undefined` (from MCP or old server) — the `sender &&` guard ensures we only filter when we have a definite match.

**Edge cases:**
- `client` is `const client = getWebSocketClient()` declared at line 423, in scope for the message handler
- Messages from MCP tools have no sender → processed normally → correct
- Messages from other browser tabs have a different sender → processed normally → correct
- Own messages → sender matches → skipped → breaks the echo loop

**Test strategy:** Mock WebSocket message with `sender` matching `client.clientId` — verify `updateDesign` is NOT called. Mock with different sender — verify it IS called. Mock with no sender — verify it IS called.

---

### Task 5: Silent catch logging (useDesignSync.ts)

**Location:** `ui/src/hooks/useDesignSync.ts` lines 181, 275

**Change:** Replace bare `catch {}` with `catch (err) { console.warn(...) }`.

```typescript
// Line 181 (load effect)
} catch (err) {
  console.warn('Failed to deserialize design on load:', err)
  resetSceneGraph()
}

// Line 275 (handleRemoteUpdate)
} catch (err) {
  console.warn('Failed to deserialize remote design update:', err)
}
```

**Pseudocode:**
1. Add `err` parameter to both catch clauses
2. Add `console.warn` with descriptive message and the error

**Test strategy:** No dedicated test needed — this is observability, not logic.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: ws-client-id
    files: [ui/src/lib/websocket.ts]
    tests: []
    description: "Add clientId property to WebSocketClient class"
    parallel: true
    depends-on: []

  - id: api-client-id-header
    files: [ui/src/lib/api.ts]
    tests: [ui/src/lib/api.test.ts]
    description: "Send X-Client-Id header on updateDesign requests"
    parallel: false
    depends-on: [ws-client-id]

  - id: server-relay-sender
    files: [src/websocket/handler.ts, src/routes/api.ts]
    tests: []
    description: "Add sender field to WSMessage type and relay X-Client-Id in design_updated broadcast"
    parallel: true
    depends-on: []

  - id: client-echo-filter
    files: [ui/src/App.tsx]
    tests: []
    description: "Skip design_updated messages where sender matches own clientId"
    parallel: false
    depends-on: [ws-client-id, server-relay-sender]

  - id: silent-catch-logging
    files: [ui/src/hooks/useDesignSync.ts]
    tests: []
    description: "Add console.warn to silent catch blocks in deserialization"
    parallel: true
    depends-on: []
```

### Execution Waves

**Wave 1 (parallel):**
- `ws-client-id` — Add clientId to WebSocketClient
- `server-relay-sender` — WSMessage type + server relay
- `silent-catch-logging` — Catch block logging

**Wave 2 (depends on Wave 1):**
- `api-client-id-header` — API header (needs ws-client-id)
- `client-echo-filter` — App.tsx filter (needs ws-client-id + server-relay-sender)

### Summary
- Total tasks: 5
- Total waves: 2
- Max parallelism: 3
