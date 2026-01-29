# Pseudocode: Item 1 - Log document updates from update and patch operations

## UpdateLogManager.constructor(basePath)

```
1. Store basePath as instance property
2. Compute logFilePath = join(basePath, 'update-log.json')
```

**Error Handling:** None - just initialization

---

## UpdateLogManager.logUpdate(documentId, oldContent, newContent, diff?)

```
1. Load existing log from disk
   - If file doesn't exist, create empty log { documents: {} }

2. Check if document already has a log entry
   - If NO entry exists:
     a. Create new entry with original = oldContent
     b. Initialize empty changes array

3. Compute diff if not provided
   - If diff parameter is undefined:
     a. Use simple approach: diff = { oldString: oldContent, newString: newContent }
   - Note: For full-content updates, this captures the entire before/after

4. Create change entry
   - timestamp = new Date().toISOString()
   - diff = { oldString, newString }

5. Append change entry to document's changes array

6. Save log to disk atomically
```

**Error Handling:**
- File read errors: Return empty log (treat as new)
- File write errors: Throw with message "Failed to save update log: {error}"
- JSON parse errors: Log warning, return empty log (corrupted file recovery)

**Edge Cases:**
- Same content (oldContent === newContent): Skip logging, no change
- Empty strings: Allow - valid content
- First update to document: Capture original content
- Very large diffs: No size limit (file system handles)

**Dependencies:**
- File system: Bun.file(), writeFile

---

## UpdateLogManager.getHistory(documentId)

```
1. Load log from disk
   - If file doesn't exist, return null

2. Look up documentId in log.documents
   - If not found, return null

3. Return the DocumentLogEntry { original, changes }
```

**Error Handling:**
- File read errors: Return null
- JSON parse errors: Return null

**Edge Cases:**
- Document never updated: Return null
- Document with zero changes: Return { original, changes: [] }

---

## UpdateLogManager.replayToTimestamp(documentId, timestamp)

```
1. Get history for document
   - If null, throw Error("No history found for document {id}")

2. Parse target timestamp as Date
   - If invalid, throw Error("Invalid timestamp format")

3. Start with original content

4. Iterate through changes in chronological order:
   For each change:
     a. Parse change.timestamp as Date
     b. If change.timestamp <= target timestamp:
        - Apply the change: replace oldString with newString
     c. If change.timestamp > target timestamp:
        - Stop iterating (changes are chronological)

5. Return reconstructed content
```

**Error Handling:**
- No history: Throw descriptive error
- Invalid timestamp: Throw with format hint
- Change application failure: Should not happen if diffs are valid

**Edge Cases:**
- Timestamp before any changes: Return original content
- Timestamp after all changes: Return fully replayed content
- Exact timestamp match: Include that change
- Multiple changes at same timestamp: Apply all (unlikely but handle)

**Dependencies:**
- None (pure computation on loaded data)

---

## UpdateLogManager.loadLog() [private]

```
1. Check if log file exists
   - If NO: return { documents: {} }

2. Read file contents as text

3. Parse JSON
   - If parse fails: log warning, return { documents: {} }

4. Return parsed UpdateLog
```

**Error Handling:**
- File not found: Return empty log (not an error)
- Read error: Return empty log with warning
- JSON parse error: Return empty log with warning

---

## UpdateLogManager.saveLog(log) [private]

```
1. Serialize log to JSON with 2-space indent

2. Write to temp file (logFilePath + '.tmp')

3. Rename temp file to logFilePath (atomic)
```

**Error Handling:**
- Write error: Throw "Failed to save update log"
- Rename error: Attempt cleanup of temp file, then throw

---

## API: GET /api/document/:id/history

```
1. Extract project, session from query params
   - If missing: return 400 { error: "project and session required" }

2. Extract document id from path

3. Create UpdateLogManager for session

4. Call getHistory(id)
   - If null: return 404 { error: "No history for document" }

5. Return 200 { original, changes }
```

**Error Handling:**
- Missing params: 400 Bad Request
- No history: 404 Not Found
- Internal error: 500 with error message

---

## API: GET /api/document/:id/version

```
1. Extract project, session, timestamp from query params
   - If project/session missing: return 400
   - If timestamp missing: return 400 { error: "timestamp required" }

2. Extract document id from path

3. Create UpdateLogManager for session

4. Call replayToTimestamp(id, timestamp)
   - Catch errors and return appropriate status

5. Return 200 { content, timestamp }
```

**Error Handling:**
- Missing params: 400 Bad Request
- Invalid timestamp: 400 Bad Request
- No history: 404 Not Found
- Internal error: 500 with error message

---

## API: POST /api/document/:id (modification)

```
// After existing save logic succeeds:

1. Get old content before save (need to fetch first)

2. After documentManager.saveDocument() succeeds:

3. Create UpdateLogManager for session

4. If request body has patch info:
   - Call logUpdate(id, oldContent, newContent, patch)
   - Else call logUpdate(id, oldContent, newContent)

5. Get updated history to get change count

6. Broadcast WebSocket message:
   {
     type: 'document_history_updated',
     id,
     project,
     session,
     changeCount
   }

// Continue with existing document_updated broadcast
```

**Error Handling:**
- Log update failure: Log warning but don't fail the request
  (history is supplementary, document save is primary)

**Edge Cases:**
- Content unchanged: logUpdate will skip
- Concurrent updates: Each logs independently
