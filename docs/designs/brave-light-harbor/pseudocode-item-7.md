# Pseudocode: Item 7 - Fix DiffView on Patch

## useDocumentHistory Hook

```
FUNCTION useDocumentHistory(documentId):
  [history, setHistory] = useState<DocumentHistory>({
    previous: null,
    current: '',
    hasDiff: false
  })
  
  FUNCTION recordChange(oldContent, newContent):
    setHistory({
      previous: oldContent,
      current: newContent,
      hasDiff: oldContent !== newContent
    })
  
  FUNCTION clearDiff():
    setHistory(prev => ({
      ...prev,
      previous: null,
      hasDiff: false
    }))
  
  RETURN { history, recordChange, clearDiff }
```

## Backend: Patch Notification

```
# src/mcp/server.ts - patch_document handler

ASYNC FUNCTION handlePatchDocument(args):
  { project, session, id, old_string, new_string } = args
  
  # Read current content
  oldContent = await readDocument(project, session, id)
  
  # Apply patch
  IF NOT oldContent.includes(old_string):
    THROW Error("old_string not found")
  
  newContent = oldContent.replace(old_string, new_string)
  
  # Write new content
  await writeDocument(project, session, id, newContent)
  
  # Broadcast diff notification via WebSocket
  broadcastToSession(project, session, {
    type: 'patch',
    documentId: id,
    oldContent: oldContent,
    newContent: newContent,
    patchApplied: { old_string, new_string }
  })
  
  RETURN { success: true, id }
```

## Frontend: WebSocket Handler

```
FUNCTION useDocumentWebSocket(project, session):
  { recordChange } = useDocumentHistory(currentDocId)
  
  EFFECT:
    ws.on('message', (msg) => {
      IF msg.type === 'patch':
        recordChange(msg.oldContent, msg.newContent)
    })
```

## DiffControls Component

```
FUNCTION DiffControls({ hasDiff, onClearDiff }):
  IF NOT hasDiff:
    RETURN null
  
  RETURN (
    <div className="diff-controls">
      <span className="diff-badge">Showing changes</span>
      <button onClick={onClearDiff} className="clear-diff-btn">
        Clear Diff
      </button>
    </div>
  )
```

## DocumentViewer Integration

```
FUNCTION DocumentViewer({ documentId }):
  { history, clearDiff } = useDocumentHistory(documentId)
  [content, setContent] = useState('')
  
  # Fetch current content
  EFFECT [documentId]:
    fetchDocument(documentId).then(setContent)
  
  RETURN (
    <div className="document-viewer">
      <DiffControls hasDiff={history.hasDiff} onClearDiff={clearDiff} />
      
      IF history.hasDiff:
        <DiffView 
          oldCode={history.previous}
          newCode={history.current}
          language="markdown"
        />
      ELSE:
        <MarkdownRenderer content={content} />
    </div>
  )
```

## Edge Cases

- Patch on document not currently viewed: Store in history, show diff when navigated
- Multiple patches in quick succession: Show cumulative diff from first old to latest new
- Clear diff then new patch: New patch triggers fresh diff display
