# Design Document: Fix Flaky Design Artifact Rendering (Save-Echo Loop)

## Problem Statement

Design artifacts disappear intermittently after user interactions. The root cause is a **save-echo loop** where the client's own save triggers a WebSocket broadcast back to itself, which replaces the entire scene graph, wipes undo history, bumps `sceneVersion`, and triggers another save — creating an infinite cycle.

### Loop Trace

```
User edits scene
  → sceneVersion bumps
  → auto-save fires after 1s debounce (useDesignSync.ts:228-252)
  → api.updateDesign() POSTs serialized graph to server
  → server broadcasts design_updated to ALL clients (api.ts:1027-1033, wsHandler.broadcast())
  → App.tsx:538-547 receives design_updated, calls sessionStore.updateDesign(id, {content})
  → DesignEditor.tsx:44-55 watches designContent from sessionStore
  → designContent !== lastRemoteContentRef.current (always true — new string ref each round-trip)
  → handleRemoteUpdate(content) called (useDesignSync.ts:263-280)
  → setSceneGraph(graph) replaces entire scene graph + clears undo (designEditorRefs.ts:56-59)
  → sceneVersion bumps (useDesignSync.ts:270-273)
  → auto-save fires again → LOOP
```

### Why the Existing Guard Fails

`DesignEditor.tsx` line 50 compares `designContent !== lastRemoteContentRef.current` using reference identity (`!==`). Every round-trip through server → sessionStore → React produces a new string object, so this guard always passes.

### Why Diagrams Are Unaffected

Diagram content is a plain Mermaid string. When the same string value comes back, Zustand's shallow equality and React's hook comparison naturally deduplicate it. Design content is a large serialized JSON object where serialization order can vary across round-trips, and even identical content produces different string references.

---

## Approach Analysis

### Approach A: Client-Side Last-Saved Content Tracking

**Mechanism:** After each successful save, store the exact serialized content string in a ref. When `handleRemoteUpdate` is invoked, compare incoming content against the last-saved content. If they match, skip the update.

**Changes:** `useDesignSync.ts` only (~10 lines).

**Pros:**
- Purely client-side; no server changes
- Directly addresses the root cause — client recognizes its own echo
- Simple to implement and reason about

**Cons:**
- String equality on large JSON payloads (263K+ for a complex design) runs on every WebSocket receive — O(n) cost
- Serialization is not canonicalized: if the server ever re-serializes or normalizes the content (whitespace, key ordering, float precision), the string won't match and the echo passes through
- If two clients make the exact same edit simultaneously, one misses the other's update (edge case but architecturally wrong)
- Does not address the server broadcasting unnecessarily to the sender
- Fragile — any code path that saves content without updating the ref creates a new echo vector

**Failure mode:** If content doesn't match (serialization drift), the echo loop returns in full. Silent regression risk.

---

### Approach B: Client-Side Time-Based Debounce Gate

**Mechanism:** After initiating a save, suppress all incoming `handleRemoteUpdate` calls for a short window (e.g., 2-3 seconds). Messages received during this window are assumed to be echoes.

**Changes:** `useDesignSync.ts` only (~5 lines).

**Pros:**
- Trivial to implement
- No string comparison cost

**Cons:**
- **Correctness hazard:** Genuine remote edits arriving during the suppression window are silently dropped — breaks multi-client collaboration
- Timing is a heuristic — too short and echoes get through on slow networks, too long and real updates are lost
- Fundamentally un-testable: correctness depends on network timing

**Failure mode:** Real collaborative edits silently dropped. **Reject.**

---

### Approach C: Server-Side Sender Exclusion

**Mechanism:** Assign each WebSocket connection a unique client ID. When the UI sends `api.updateDesign()`, include the client ID. The server looks up the corresponding WebSocket connection and excludes it from the broadcast.

**Changes:** `websocket/handler.ts`, `routes/api.ts`, `ui/src/lib/websocket.ts`, `ui/src/lib/api.ts` (4+ files).

**Pros:**
- Architecturally correct — server should not echo updates back to the sender
- Eliminates unnecessary network traffic
- No client-side content comparison

**Cons:**
- Requires correlating HTTP requests with WebSocket connections — these are separate transport channels with no existing mapping
- The current `broadcast()` method iterates a `Set<ServerWebSocket>` with no identity concept
- Need to track a client ID both in the WebSocket `data` bag and as an HTTP header, then look up the matching WS connection during an HTTP handler — architecturally awkward in Bun's server model
- High implementation complexity for this specific bug

**Failure mode:** If the HTTP-to-WS mapping breaks (e.g., client reconnects WS with new ID, stale ID in HTTP), broadcasts skip the wrong client or no client.

---

### Approach D: Hybrid — Server Relays Sender ID, Client Filters (RECOMMENDED)

**Mechanism:** The client generates a stable `clientId` (UUID) on startup. This ID is:
1. Sent as a header on HTTP API calls (`X-Client-Id`)
2. Known to the WebSocket message handler

The server does NOT need to correlate HTTP and WS connections. It simply reads `X-Client-Id` from the HTTP request and includes it as a `sender` field in the broadcast message. The client checks `if (message.sender === myClientId) skip` before processing.

**Changes:** 4 files, each with small targeted changes (see Implementation below).

**Pros:**
- Correct at the protocol level — identifies the sender explicitly, not by heuristic
- No large string comparisons
- No timing heuristics
- Works regardless of content size or serialization format
- Server change is trivial — just relay a field, no connection lookup
- Safe failure mode: if `sender` is missing or doesn't match, the message is processed normally (worst case = current behavior, not data loss)
- Extends naturally to all artifact types (diagrams, documents, spreadsheets) — one pattern for everything
- Client ID is useful for future features (presence, cursors, conflict resolution)

**Cons:**
- Touches 4 files across server and client (but each change is small and well-contained)
- Requires coordinating a client ID across HTTP and WebSocket (but both are in the same browser tab, so this is just a shared constant)

**Failure mode:** If client ID is missing → message has no `sender` field → client doesn't match → processes the update → current behavior. **Safe degradation.**

---

## Recommendation

**Implement Approach D (Hybrid Sender ID).**

It solves the problem at the right layer — sender identification at the protocol level rather than content heuristics. The failure mode is safe (degrades to current behavior). It's a pattern that extends to all artifact types and provides infrastructure for future collaborative features.

Approach A is tempting for its single-file simplicity, but it's fundamentally a workaround that depends on string equality of 263K+ JSON payloads. Any serialization drift silently brings the bug back.

---

## Implementation Plan

### File 1: `ui/src/lib/websocket.ts` — Generate and expose client ID

Add a stable `clientId` to the `WebSocketClient` class:

```typescript
// At top of WebSocketClient class
readonly clientId: string = crypto.randomUUID()
```

This ID is generated once per tab/client lifecycle and stays stable across WebSocket reconnections.

### File 2: `ui/src/lib/api.ts` — Send client ID on HTTP requests

Add the `X-Client-Id` header to `updateDesign()` (and optionally all mutating API calls):

```typescript
async updateDesign(project: string, session: string, id: string, content: string): Promise<void> {
  const url = `/api/design/${encodeURIComponent(id)}?project=${...}&session=${...}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': getWebSocketClient().clientId,  // NEW
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error(response.statusText);
}
```

**Note:** Import `getWebSocketClient` from `./websocket`. The singleton is already created by the time saves happen.

### File 3: `src/routes/api.ts` — Relay sender in broadcast

In the design update handler (~line 1027-1033), read the header and include it:

```typescript
// Read client ID from request header
const clientId = req.headers.get('x-client-id') || undefined;

wsHandler.broadcast({
  type: 'design_updated',
  id,
  content,
  sender: clientId,  // NEW — relayed from HTTP request
  project: params.project,
  session: params.session,
});
```

Also update the `WSMessage` type in `src/websocket/handler.ts` to include the optional `sender` field.

### File 4: `ui/src/App.tsx` — Filter out own messages

In the `design_updated` case (~line 538-547), check the sender:

```typescript
case 'design_updated': {
  const { id, content, project, session, sender } = message as any;
  // Skip if this is our own save echoed back
  if (sender && sender === client.clientId) break;  // NEW
  if (id &&
      currentSession &&
      project === currentSession.project &&
      session === currentSession.name) {
    updateDesign(id, { content, lastModified: Date.now() });
  }
  break;
}
```

Where `client` is the `WebSocketClient` instance already available in the `useEffect` closure.

### File 5 (optional): `src/websocket/handler.ts` — Type update

Add `sender?: string` to relevant `WSMessage` union members:

```typescript
| { type: 'design_updated'; id: string; content: string; sender?: string; project: string; session: string }
```

---

## Secondary Issues

These are not blocking but should be addressed as follow-ups:

### Issue 1: Silent Error Swallowing
**Location:** `useDesignSync.ts` lines 181, 275 — both `catch {}` blocks swallow all errors silently.
**Fix:** Add `console.warn('Failed to deserialize design:', err)`.

### Issue 2: setSceneGraph Wipes Undo History on Every Remote Update
**Location:** `designEditorRefs.ts:58` — `refs.undo.clear()` runs unconditionally.
**Impact:** Even with the echo fix, genuine multi-client updates will wipe the local undo stack.
**Follow-up:** Consider preserving undo on remote updates, or implementing operational transform.

### Issue 3: No Content Deduplication in sessionStore.updateDesign
**Location:** `sessionStore.ts:349-354` — always creates a new object reference.
**Impact:** Triggers unnecessary React re-renders downstream even when content is unchanged.
**Follow-up:** Add shallow content equality check as a second line of defense.

### Issue 4: Race Between setSceneGraph and RAF Render
**Location:** `designEditorRefs.ts:56` + `useDesignCanvas.ts:48`
**Impact:** If `setSceneGraph` fires between `scheduleRender()` and the RAF callback, renderer reads a graph whose version hasn't been bumped yet. Currently safe because the synchronous block in `handleRemoteUpdate` sets graph and bumps version before yielding, but the invariant is fragile.

---

## Testing Plan

1. **Echo suppression:** Edit a design, wait 3+ seconds for auto-save. Verify design does not flicker or reset.
2. **Undo survives save:** Make an edit, wait for save, Ctrl+Z. Verify undo works.
3. **Multi-tab sync:** Open same design in two tabs. Edit in tab A → verify tab B receives update. Edit in tab B → verify tab A receives update.
4. **Rapid edits:** Make multiple fast edits. Verify final state is correct and saved.
5. **Missing header graceful degradation:** Temporarily remove the `X-Client-Id` header. Verify the system falls back to current behavior (echo loop) rather than crashing — confirms safe degradation.
6. **Reconnection:** Disconnect and reconnect WebSocket. Verify `clientId` is stable and echo filtering still works.

---

## Summary

| Approach | Complexity | Correctness | Failure Mode | Recommendation |
|----------|-----------|-------------|--------------|----------------|
| A: Content tracking | Low (1 file) | Medium — serialization drift risk | Echo loop returns silently | Backup only |
| B: Time gate | Very low | Low — drops real updates | Data loss in multi-client | **Reject** |
| C: Server exclusion | High (4+ files, WS mapping) | High | Wrong client excluded | Over-engineered |
| **D: Hybrid sender ID** | **Medium (4 files, small changes)** | **High** | **Degrades to current behavior** | **Recommended** |

**Primary fix: Approach D.** Generate a client ID, send it as an HTTP header, relay it in the broadcast, filter on the client. Correct, safe, extensible.
