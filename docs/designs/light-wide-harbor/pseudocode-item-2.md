# Pseudocode: Item 2 - Add UI to view document update history in desktop GUI

## useDocumentHistory(documentId)

```
1. Initialize state:
   - history: DocumentHistory | null = null
   - isLoading: boolean = false
   - error: string | null = null

2. Define fetchHistory async function:
   a. If documentId is null, return early
   b. Set isLoading = true, error = null
   c. Fetch GET /api/document/{documentId}/history?project=...&session=...
   d. If response.ok:
      - Parse JSON and set history
   e. If response.status === 404:
      - Set history = null (no history yet, not an error)
   f. Else:
      - Set error = "Failed to load history"
   g. Set isLoading = false

3. Define getVersionAt async function:
   a. Fetch GET /api/document/{documentId}/version?timestamp=...&project=...&session=...
   b. If response.ok:
      - Parse JSON and return content
   c. Else:
      - Return null

4. Subscribe to WebSocket messages:
   - On 'document_history_updated' where message.id === documentId:
     - Call fetchHistory() to refresh

5. useEffect on documentId change:
   - Call fetchHistory()

6. Return { history, isLoading, error, refetch: fetchHistory, getVersionAt }
```

**Error Handling:**
- Network error: Set error state, keep previous history
- 404 response: Treat as "no history" (null), not error
- Parse error: Set error state

**Edge Cases:**
- documentId is null: Return null history, no fetch
- documentId changes: Fetch new history
- WebSocket reconnect: History auto-refreshes on next update

**Dependencies:**
- useSession hook (for project/session context)
- useWebSocket hook (for message subscription)
- fetch API

---

## HistoryDropdown component

```
1. Props: { documentId, currentContent, onVersionSelect, className }

2. Use useDocumentHistory(documentId) hook

3. State:
   - isOpen: boolean = false
   - loadingTimestamp: string | null = null

4. Compute hasHistory = history !== null && history.changes.length > 0

5. Render button:
   - Clock icon
   - Disabled if !hasHistory or isLoading
   - onClick: toggle isOpen

6. If isOpen && hasHistory, render dropdown:
   For each change in history.changes (reverse order - newest first):
     a. Format timestamp as relative time
     b. Render clickable item
     c. onClick:
        - Set loadingTimestamp = change.timestamp
        - Call getVersionAt(change.timestamp)
        - If content returned:
          - Call onVersionSelect(timestamp, content)
        - Set loadingTimestamp = null
        - Set isOpen = false

7. Click outside handler to close dropdown
```

**Error Handling:**
- getVersionAt returns null: Show brief error toast, keep dropdown open
- Hook error state: Show error indicator on button

**Edge Cases:**
- Empty history: Button disabled
- Loading state: Show spinner on button
- Very long list: Consider virtual scrolling (future enhancement)
- Rapid clicks: Debounce or disable during load

---

## formatRelativeTime(timestamp) helper

```
1. Parse timestamp to Date
2. Calculate diff = now - timestamp in milliseconds
3. Convert to appropriate unit:
   - < 60 seconds: "just now"
   - < 60 minutes: "{n}m ago"
   - < 24 hours: "{n}h ago"
   - < 48 hours: "Yesterday"
   - < 7 days: "{n} days ago"
   - else: format as "MMM D" or "MMM D, YYYY" if different year
4. Return formatted string
```

**Edge Cases:**
- Invalid timestamp: Return "Unknown"
- Future timestamp: Return "just now" (clock skew)

---

## HistoryModal component

```
1. Props: { isOpen, onClose, historicalContent, currentContent, timestamp, documentName }

2. If !isOpen, return null

3. Handle Escape key:
   - useEffect to add keydown listener
   - On Escape: call onClose()

4. Render modal overlay:
   - Semi-transparent backdrop
   - onClick backdrop: call onClose()

5. Render modal content:
   a. Header:
      - Title: "History: {documentName}" or "Document History"
      - Subtitle: "Version from {formatRelativeTime(timestamp)}"
      - Close button (X)
   
   b. Body:
      - DiffView component:
        - before={historicalContent}
        - after={currentContent}
        - fileName={documentName}
        - mode="split" (default)
   
   c. Footer (optional):
      - "Close" button

6. Prevent body scroll when modal open
```

**Error Handling:**
- Empty content: DiffView handles "no changes" case
- Very large content: DiffView has max-height with scroll

**Edge Cases:**
- historicalContent === currentContent: DiffView shows "No changes"
- Modal opened while another modal open: Should not happen (single modal at a time)

---

## DocumentEditor integration

```
1. Add new state:
   - historyModalOpen: boolean = false
   - selectedHistoryTimestamp: string = ''
   - selectedHistoryContent: string = ''

2. Define handleHistoryVersionSelect(timestamp, content):
   - Set selectedHistoryTimestamp = timestamp
   - Set selectedHistoryContent = content
   - Set historyModalOpen = true

3. Define handleHistoryModalClose():
   - Set historyModalOpen = false

4. In secondary toolbar row, after existing buttons:
   - Add HistoryDropdown:
     - documentId={document.id}
     - currentContent={content}
     - onVersionSelect={handleHistoryVersionSelect}

5. Render HistoryModal (outside main layout):
   - isOpen={historyModalOpen}
   - onClose={handleHistoryModalClose}
   - historicalContent={selectedHistoryContent}
   - currentContent={content}
   - timestamp={selectedHistoryTimestamp}
   - documentName={document.name}
```

**Error Handling:**
- Document not loaded: HistoryDropdown disabled (documentId null check)

**Edge Cases:**
- User edits while modal open: Modal shows stale currentContent (acceptable)
- Document switch while modal open: Close modal on document change
