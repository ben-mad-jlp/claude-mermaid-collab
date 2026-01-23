# Interface: Item 6 - Optimize list_documents/list_diagrams

## [APPROVED]

## File Structure
- `src/services/document-manager.ts` - Change listDocuments()
- `src/services/diagram-manager.ts` - Change listDiagrams()

## Type Definitions

```typescript
// Current response type (BEFORE)
interface Document {
  id: string;
  name: string;
  content: string;  // Full content - REMOVE THIS
  lastModified: number;
}

// New response type (AFTER)
interface DocumentMeta {
  id: string;
  name: string;
  lastModified: number;
  // content removed - fetch via getDocument(id)
}

// Same change for diagrams
interface DiagramMeta {
  id: string;
  name: string;
  lastModified: number;
  // content removed - fetch via getDiagram(id)
}
```

## Function Signatures

```typescript
// src/services/document-manager.ts
class DocumentManager {
  // BEFORE
  async listDocuments(): Promise<Document[]>
  
  // AFTER
  async listDocuments(): Promise<DocumentMeta[]>
}

// src/services/diagram-manager.ts
class DiagramManager {
  // BEFORE
  async listDiagrams(): Promise<Diagram[]>
  
  // AFTER
  async listDiagrams(): Promise<DiagramMeta[]>
}
```

## Breaking Changes
- MCP `list_documents` response no longer includes `content`
- MCP `list_diagrams` response no longer includes `content`
- Callers must use `get_document(id)` / `get_diagram(id)` for content

## Verification
- [ ] listDocuments returns metadata only
- [ ] listDiagrams returns metadata only
- [ ] content field removed from response
- [ ] getDocument/getDiagram still return full content
