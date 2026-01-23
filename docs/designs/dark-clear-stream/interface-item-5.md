# Interface Definition: Item 5
## WebSocket not updating React GUI

[APPROVED]

### File Structure

Files to modify:
- `src/routes/api.ts` - Add content field to diagram_created and document_created broadcasts
- `src/websocket/handler.ts` - Update WSMessage type definition

### Type Definitions

#### WSMessage Type Update (src/websocket/handler.ts)

```typescript
// Current type (lines 17-20):
export type WSMessage =
  | { type: 'diagram_created'; id: string; name: string }
  | { type: 'document_created'; id: string; name: string }
  // ... other types

// Updated type:
export type WSMessage =
  | { type: 'diagram_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'document_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  // ... other types
```

### Function Signatures

#### Diagram Creation Broadcast (src/routes/api.ts)

```typescript
// Current broadcast (lines 230-236):
wsHandler.broadcast({
  type: 'diagram_created',
  id,
  name: name + '.mmd',
  project: params.project,
  session: params.session,
});

// Updated broadcast:
wsHandler.broadcast({
  type: 'diagram_created',
  id,
  name: name + '.mmd',
  content,                    // ADD: diagram content
  lastModified: Date.now(),   // ADD: timestamp
  project: params.project,
  session: params.session,
});
```

#### Document Creation Broadcast (src/routes/api.ts)

```typescript
// Current broadcast (lines 474-480):
wsHandler.broadcast({
  type: 'document_created',
  id,
  name: name + '.md',
  project: params.project,
  session: params.session,
});

// Updated broadcast:
wsHandler.broadcast({
  type: 'document_created',
  id,
  name: name + '.md',
  content,                    // ADD: document content
  lastModified: Date.now(),   // ADD: timestamp
  project: params.project,
  session: params.session,
});
```

### Component Interactions

```
MCP Tool Call (create_diagram/create_document)
    |
    v
src/routes/api.ts
    |
    +-- Creates file on disk
    +-- Broadcasts WSMessage with ALL fields:
    |       { type, id, name, content, lastModified, project, session }
    |
    v
src/websocket/handler.ts
    |
    +-- Sends to all connected clients
    |
    v
ui/src/App.tsx (WebSocket handler)
    |
    +-- Receives message
    +-- Checks: if (id && name && content !== undefined)  // NOW PASSES
    +-- Calls addDiagram() or addDocument()
    |
    v
React state updates → UI shows new item
```

### No Client-Side Changes Needed

The client already handles `content` field correctly:

```typescript
// ui/src/App.tsx lines 238-248 (unchanged)
case 'diagram_created': {
  const { id, name, content, lastModified } = message as any;
  if (id && name && content !== undefined) {  // Will now pass
    addDiagram({
      id,
      name,
      content,
      lastModified: lastModified || Date.now(),
    } as any);
  }
  break;
}
```

The fix is server-side only - adding the missing fields to broadcasts.

### Verification Checklist

- [ ] WSMessage type updated with content and lastModified for _created messages
- [ ] Diagram creation broadcast includes content and lastModified
- [ ] Document creation broadcast includes content and lastModified
- [ ] Create diagram via MCP → appears in React UI immediately
- [ ] Create document via MCP → appears in React UI immediately
- [ ] No page refresh required
