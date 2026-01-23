# Skeleton: Item 5
## WebSocket not updating React GUI

[APPROVED]

## Planned Files

Files to modify:
- [ ] `src/websocket/handler.ts` - Update WSMessage type
- [ ] `src/routes/api.ts` - Add content field to broadcasts

**Note:** These are MODIFICATIONS to existing files. Changes will be applied during implementation.

## File Contents

### Modification: src/websocket/handler.ts

**Find the WSMessage type definition and update:**

```typescript
// FIND (around lines 17-20):
export type WSMessage =
  | { type: 'diagram_created'; id: string; name: string }
  | { type: 'document_created'; id: string; name: string }
  // ... other types

// REPLACE WITH:
export type WSMessage =
  | { type: 'diagram_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'document_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  // ... other types (unchanged)
```

**Status:** [ ] Will be modified during implementation

### Modification: src/routes/api.ts

**Find diagram creation broadcast (around line 230) and update:**

```typescript
// FIND:
wsHandler.broadcast({
  type: 'diagram_created',
  id,
  name: name + '.mmd',
  project: params.project,
  session: params.session,
});

// REPLACE WITH:
wsHandler.broadcast({
  type: 'diagram_created',
  id,
  name: name + '.mmd',
  content,
  lastModified: Date.now(),
  project: params.project,
  session: params.session,
});
```

**Find document creation broadcast (around line 474) and update:**

```typescript
// FIND:
wsHandler.broadcast({
  type: 'document_created',
  id,
  name: name + '.md',
  project: params.project,
  session: params.session,
});

// REPLACE WITH:
wsHandler.broadcast({
  type: 'document_created',
  id,
  name: name + '.md',
  content,
  lastModified: Date.now(),
  project: params.project,
  session: params.session,
});
```

**Status:** [ ] Will be modified during implementation

## Task Dependency Graph

```yaml
tasks:
  - id: update-ws-types
    files: [src/websocket/handler.ts]
    description: Add content and lastModified to WSMessage type for _created messages
    parallel: true

  - id: update-diagram-broadcast
    files: [src/routes/api.ts]
    description: Include content in diagram_created broadcast
    depends-on: [update-ws-types]

  - id: update-document-broadcast
    files: [src/routes/api.ts]
    description: Include content in document_created broadcast
    depends-on: [update-ws-types]
```

## Execution Order

**Wave 1:**
- update-ws-types

**Wave 2 (sequential on same file):**
- update-diagram-broadcast
- update-document-broadcast

## Verification

- [ ] WSMessage type includes content: string for diagram_created
- [ ] WSMessage type includes lastModified: number for diagram_created
- [ ] WSMessage type includes content: string for document_created
- [ ] WSMessage type includes lastModified: number for document_created
- [ ] Diagram creation broadcast includes content field
- [ ] Diagram creation broadcast includes lastModified field
- [ ] Document creation broadcast includes content field
- [ ] Document creation broadcast includes lastModified field
- [ ] Create diagram via MCP → appears in React UI sidebar immediately
- [ ] Create document via MCP → appears in React UI sidebar immediately
- [ ] No TypeScript errors after changes
