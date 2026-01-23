# Pseudocode: Item 5
## WebSocket not updating React GUI

[APPROVED]

---

### Step 1: Update WSMessage Type Definition

```
READ src/websocket/handler.ts

FIND type definition:
  export type WSMessage =
    | { type: 'diagram_created'; id: string; name: string }
    | { type: 'document_created'; id: string; name: string }
    ...

REPLACE diagram_created type:
  OLD: { type: 'diagram_created'; id: string; name: string }
  NEW: { type: 'diagram_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }

REPLACE document_created type:
  OLD: { type: 'document_created'; id: string; name: string }
  NEW: { type: 'document_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
```

---

### Step 2: Update Diagram Creation Broadcast

```
READ src/routes/api.ts

FIND diagram creation broadcast (around line 230):
  wsHandler.broadcast({
    type: 'diagram_created',
    id,
    name: name + '.mmd',
    project: params.project,
    session: params.session,
  });

UPDATE to include content and lastModified:
  wsHandler.broadcast({
    type: 'diagram_created',
    id,
    name: name + '.mmd',
    content,                    // ADD: pass the diagram content variable
    lastModified: Date.now(),   // ADD: current timestamp
    project: params.project,
    session: params.session,
  });

VERIFY: content variable is in scope at broadcast location
  - Should be available from the request body or created diagram
```

---

### Step 3: Update Document Creation Broadcast

```
FIND document creation broadcast (around line 474):
  wsHandler.broadcast({
    type: 'document_created',
    id,
    name: name + '.md',
    project: params.project,
    session: params.session,
  });

UPDATE to include content and lastModified:
  wsHandler.broadcast({
    type: 'document_created',
    id,
    name: name + '.md',
    content,                    // ADD: pass the document content variable
    lastModified: Date.now(),   // ADD: current timestamp
    project: params.project,
    session: params.session,
  });

VERIFY: content variable is in scope at broadcast location
  - Should be available from the request body or created document
```

---

### Verification Flow

```
AFTER changes:

1. Start mermaid-collab server
2. Open React UI in browser
3. Call MCP tool: create_diagram
4. EXPECT: New diagram appears in sidebar immediately
5. Call MCP tool: create_document
6. EXPECT: New document appears in sidebar immediately
7. NO page refresh should be needed

IF items don't appear:
  - Check browser console for errors
  - Check WebSocket connection is active
  - Verify content variable has correct value at broadcast
```

---

### Error Handling

- content is undefined: Check variable scope, ensure it's captured before broadcast
- TypeScript errors: Update any type assertions in broadcast call
- Client still not updating: Verify client WebSocket handler matches expected message shape

### Edge Cases

- Large content: Should still broadcast correctly (WebSocket handles size)
- Empty content: Valid case (empty diagram/document), should still trigger UI update
- Special characters in content: JSON encoding handles this

### Dependencies

- wsHandler.broadcast function signature (no changes needed)
- Client-side handler already expects content field (no changes needed)
