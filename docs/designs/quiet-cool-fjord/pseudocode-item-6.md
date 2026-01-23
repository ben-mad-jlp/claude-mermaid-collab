# Pseudocode: Item 6 - Optimize list_documents/list_diagrams

## [APPROVED]

## File: src/services/document-manager.ts

### listDocuments (Updated)

```
FUNCTION listDocuments():
  documents = []
  
  FOR [id, meta] IN this.index.entries():
    # Get file stats for lastModified
    stats = await stat(meta.path)
    
    # Return metadata ONLY - no content read
    ADD {
      id: id,
      name: meta.name,
      lastModified: stats.mtimeMs
      # content: REMOVED - use getDocument(id) for content
    } TO documents
  
  RETURN documents
```

### Before (for reference)

```
# OLD CODE - reads full content
FUNCTION listDocuments_OLD():
  documents = []
  
  FOR [id, meta] IN this.index.entries():
    # THIS IS THE PROBLEM - reads every file
    content = await readFile(meta.path, 'utf-8')
    
    ADD {
      id: id,
      name: meta.name,
      content: content,  # Full content in list response
      lastModified: stats.mtimeMs
    } TO documents
  
  RETURN documents
```

## File: src/services/diagram-manager.ts

### listDiagrams (Updated)

```
FUNCTION listDiagrams():
  diagrams = []
  
  FOR [id, meta] IN this.index.entries():
    stats = await stat(meta.path)
    
    # Return metadata ONLY
    ADD {
      id: id,
      name: meta.name,
      lastModified: stats.mtimeMs
      # content: REMOVED
    } TO diagrams
  
  RETURN diagrams
```

## MCP Handler Updates

### list_documents handler

```
FUNCTION handleListDocuments(params):
  { project, session } = params
  
  manager = getDocumentManager(project, session)
  documents = await manager.listDocuments()
  
  # Response shape changes
  RETURN {
    documents: documents.map(d => ({
      id: d.id,
      name: d.name,
      lastModified: d.lastModified
      # content field removed from response
    }))
  }
```

## Usage Pattern for Callers

```
# To get document content, callers must now:

# 1. List documents (metadata only)
docs = await mcp.listDocuments(project, session)

# 2. Fetch content for specific document
FOR doc IN docs:
  IF needsContent(doc):
    fullDoc = await mcp.getDocument(project, session, doc.id)
    # fullDoc.content now available
```

## Verification
- [ ] listDocuments returns metadata only (no content)
- [ ] listDiagrams returns metadata only (no content)
- [ ] Response includes: id, name, lastModified
- [ ] Response excludes: content
- [ ] getDocument/getDiagram still return full content
