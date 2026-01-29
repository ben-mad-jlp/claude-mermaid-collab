# Session: light-wide-harbor

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Log document updates from update and patch operations
**Type:** code
**Status:** documented

**Problem/Goal:**
Log document changes with timestamp and diff details when documents are updated or patched. This provides an audit trail of modifications.

**Approach:**

**Section 1: Log File Structure**

Create `update-log.json` in the session folder with this structure:

```json
{
  "documents": {
    "<document-id>": {
      "original": "<full content on first update>",
      "changes": [
        {
          "timestamp": "2026-01-28T20:15:00.000Z",
          "diff": {
            "oldString": "<text that was replaced>",
            "newString": "<replacement text>"
          }
        }
      ]
    }
  }
}
```

- `original`: Captured on first update (before any changes)
- `changes`: Array of diffs in chronological order
- Each diff has timestamp and the old/new strings from the patch

To replay to any state: start with `original`, apply diffs sequentially up to desired timestamp.

**Section 2: UpdateLogManager Service**

Create `src/services/update-log-manager.ts`:

```typescript
class UpdateLogManager {
  // Initialize with session path
  constructor(basePath: string)
  
  // Log a document update
  async logUpdate(
    documentId: string,
    oldContent: string,
    newContent: string,
    diff?: { oldString: string; newString: string }
  ): Promise<void>
  
  // Get history for a document
  async getHistory(documentId: string): Promise<ChangeEntry[]>
  
  // Replay to specific timestamp
  async replayToTimestamp(documentId: string, timestamp: string): Promise<string>
}
```

**Integration point:** Called from `POST /api/document/:id` in `api.ts` after successful save.

**Section 3: API Endpoints**

Add two new endpoints to `api.ts`:

1. **GET /api/document/:id/history** - Returns change history
   - Query params: `project`, `session`
   - Response: `{ changes: [{ timestamp, diff }], original: string }`

2. **GET /api/document/:id/version** - Returns content at timestamp
   - Query params: `project`, `session`, `timestamp`
   - Response: `{ content: string, timestamp: string }`

WebSocket broadcast: Add `document_history_updated` message type to notify UI when new changes are logged.

**Success Criteria:**
- Every document update/patch creates a log entry with timestamp and diff
- Log file persists in session folder
- Can replay document to any historical state via `replayToTimestamp()`
- API endpoints return history and versioned content

**Decisions:**
- Log fields: timestamp, diff details
- Storage: File-based (persisted per session)
- Location: Session folder (.collab/sessions/{session}/update-log.json)
- State recreation: Original + diffs (store initial content, then diffs to replay forward)

---

### Item 2: Add UI to view document update history in desktop GUI
**Type:** code
**Status:** documented

**Problem/Goal:**
Display document update history in a dropdown menu on the editor toolbar (top bar of the render/preview panel).

**Approach:**

**Section 1: History Dropdown Component**

Create `ui/src/components/editors/HistoryDropdown.tsx`:

- Button with clock/history icon in EditorToolbar
- On click: dropdown shows list of timestamps (relative format: "5m ago")
- Fetches history from `GET /api/document/:id/history`
- Subscribes to `document_history_updated` WebSocket for live updates

**Placement:** Add to `EditorToolbar.tsx` between existing buttons (after undo/redo, before export).

**Section 2: Diff View on Click**

When user clicks a history entry:

1. Fetch historical content via `GET /api/document/:id/version?timestamp=...`
2. Open existing `DiffView` component (already in `ui/src/components/ai-ui/DiffView.tsx`)
3. Show side-by-side: historical version (left) vs current content (right)
4. Display in a modal overlay or replace the preview pane temporarily

**User flow:**
- Click timestamp → diff view opens
- Close button or Escape → return to normal editor

**Success Criteria:**
- History button appears in editor toolbar when document has history
- Dropdown shows timestamps in relative format
- Clicking entry shows diff view comparing historical vs current
- Diff view can be closed to return to editor

**Decisions:**
- Location: Dropdown menu in the editor toolbar
- Entry display: Timestamp only (relative, e.g., "5m ago")
- Click action: Show diff view comparing that version with current

---

## Diagrams
(auto-synced)