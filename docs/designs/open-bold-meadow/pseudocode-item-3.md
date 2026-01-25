# Pseudocode: Item 3 - MCP Terminal Tools (includes Items 2 & 4)

## TerminalManager Class

### getStoragePath(project, session)

```
1. Return path.join(project, '.collab', session, 'terminal-sessions.json')
```

---

### readSessions(project, session)

```
1. storagePath = getStoragePath(project, session)

2. Try to read file:
   - If file doesn't exist:
     - Return { sessions: [], lastModified: now() }
   - If file exists:
     - Parse JSON
     - Return parsed state

3. On parse error:
   - Log warning
   - Return { sessions: [], lastModified: now() }
```

**Error Handling:**
- File not found: Return empty state (not an error)
- JSON parse error: Log and return empty state
- Permission error: Propagate (should not happen in normal use)

---

### writeSessions(project, session, state)

```
1. storagePath = getStoragePath(project, session)

2. Ensure parent directory exists:
   - mkdir -p dirname(storagePath)

3. Update lastModified timestamp in state

4. Write JSON to file with pretty formatting
```

**Error Handling:**
- Directory creation fails: Propagate error
- Write fails: Propagate error

---

### generateTmuxSessionName(collabSession)

```
1. Extract session name from collabSession:
   - Split by ':' or '/'
   - Take last segment
   - Default to 'default' if empty

2. Sanitize for tmux:
   - Replace non-alphanumeric except hyphens with ''
   - Truncate to reasonable length (20 chars)

3. Generate random suffix:
   - 4 chars: Math.random().toString(36).substr(2, 4)

4. Return 'mc-' + sanitized + '-' + random
   - Example: 'mc-openboldmeadow-a1b2'
```

---

### createTmuxSession(tmuxSessionName)

```
1. Run shell command:
   - tmux new-session -d -s {tmuxSessionName}
   
2. If command fails:
   - Check if session already exists (exit code 1 with "duplicate session")
   - If duplicate: That's OK, session exists
   - Otherwise: Throw error

3. Return void (success)
```

**Error Handling:**
- tmux not installed: Propagate error with helpful message
- Session already exists: Ignore (idempotent)
- Other tmux errors: Propagate

---

### killTmuxSession(tmuxSessionName)

```
1. Run shell command:
   - tmux kill-session -t {tmuxSessionName}
   
2. If command fails:
   - Check if "no session" error (session doesn't exist)
   - If not found: That's OK, already dead
   - Otherwise: Throw error

3. Return void (success)
```

**Error Handling:**
- Session not found: Ignore (idempotent)
- Other tmux errors: Propagate

---

### listActiveTmuxSessions(prefix)

```
1. Run shell command:
   - tmux list-sessions -F "#{session_name}" 2>/dev/null

2. If command fails (no server running):
   - Return empty array

3. Parse output:
   - Split by newlines
   - Filter to sessions starting with prefix
   - Return filtered list
```

**Error Handling:**
- No tmux server: Return empty array
- Parse errors: Log warning, return empty array

---

### reconcileSessions(project, session)

```
1. Read stored sessions from file
2. Get active tmux sessions with prefix 'mc-{session}-'

3. For each stored session:
   - If tmuxSession NOT in active list:
     - Mark for removal (orphan in storage)

4. For each active tmux session:
   - If NOT in stored sessions:
     - Kill it (orphan in tmux)

5. Remove orphaned entries from stored sessions
6. Write updated state to file

7. Log reconciliation summary:
   - "Reconciled: removed N orphan records, killed M orphan tmux sessions"
```

**Edge Cases:**
- No stored sessions + no tmux sessions: Nothing to do
- Stored session with dead tmux: Remove from storage
- Tmux session not in storage: Kill it (cleanup orphan)

---

## MCP Tool: terminal_create_session

```
1. Validate inputs:
   - project must be non-empty string
   - session must be non-empty string
   - name is optional, default to "Terminal N"

2. Read current sessions

3. Determine display name:
   - If name provided: use it
   - Else: "Terminal " + (sessions.length + 1)

4. Generate tmux session name:
   - tmuxSession = manager.generateTmuxSessionName(session)

5. Create tmux session:
   - manager.createTmuxSession(tmuxSession)

6. Create session record:
   - id = crypto.randomUUID()
   - name = display name
   - tmuxSession = generated name
   - created = now()
   - order = sessions.length

7. Add to sessions array

8. Write updated sessions

9. Return {
     id,
     tmuxSession,
     wsUrl: 'ws://localhost:7681/ws'  // ttyd default
   }
```

**Error Handling:**
- tmux creation fails: Propagate error, don't save record
- Storage write fails: Propagate error (tmux session exists but not tracked - reconcile will fix)

---

## MCP Tool: terminal_list_sessions

```
1. Validate inputs

2. Read sessions from storage

3. Optionally reconcile (if stale):
   - If lastModified > 5 minutes ago, run reconcile first

4. Sort sessions by order field

5. Return { sessions }
```

---

## MCP Tool: terminal_kill_session

```
1. Validate inputs (project, session, id required)

2. Read current sessions

3. Find session by id:
   - If not found: Return { success: false } or throw

4. Kill tmux session:
   - manager.killTmuxSession(session.tmuxSession)

5. Remove from sessions array

6. Recompute order for remaining sessions

7. Write updated sessions

8. Return { success: true }
```

---

## MCP Tool: terminal_rename_session

```
1. Validate inputs (project, session, id, name required)

2. Read current sessions

3. Find session by id:
   - If not found: Return { success: false }

4. Update name field:
   - Trim whitespace
   - If empty after trim: use "Terminal"

5. Write updated sessions

6. Return { success: true }
```

---

## MCP Tool: terminal_reorder_sessions

```
1. Validate inputs (project, session, orderedIds required)

2. Read current sessions

3. Validate orderedIds:
   - Must contain all session IDs (no missing, no extras)
   - If mismatch: Throw error

4. Reorder sessions array:
   - Create new array in order specified by orderedIds
   - Update order field for each (0, 1, 2, ...)

5. Write updated sessions

6. Return { success: true }
```

**Edge Cases:**
- orderedIds has duplicate: Error
- orderedIds missing a session: Error
- orderedIds has unknown ID: Error

---

## HTTP API Handlers

### GET /api/terminal/sessions

```
1. Extract project, session from query params
2. Call terminalListSessions(project, session)
3. Return JSON response
```

### POST /api/terminal/sessions

```
1. Extract project, session, name from body
2. Call terminalCreateSession(project, session, name)
3. Return JSON response
```

### DELETE /api/terminal/sessions/:id

```
1. Extract id from params
2. Extract project, session from query params
3. Call terminalKillSession(project, session, id)
4. Return JSON response
```

### PATCH /api/terminal/sessions/:id

```
1. Extract id from params
2. Extract project, session from query params
3. Extract name from body
4. Call terminalRenameSession(project, session, id, name)
5. Return JSON response
```

### PUT /api/terminal/sessions/reorder

```
1. Extract project, session from query params
2. Extract orderedIds from body
3. Call terminalReorderSessions(project, session, orderedIds)
4. Return JSON response
```

---

## Frontend: useTerminalTabs Hook

```
1. State:
   - tabs: TerminalSession[]
   - activeTabId: string | null
   - isLoading: boolean
   - error: Error | null

2. On mount / when project or session changes:
   - setIsLoading(true)
   - Fetch sessions from API
   - setTabs(response.sessions)
   - setActiveTabId(first session id or null)
   - setIsLoading(false)

3. addTab():
   - Call api.createTerminalSession(project, session)
   - Add new session to tabs
   - Set as active

4. removeTab(id):
   - Call api.deleteTerminalSession(project, session, id)
   - Remove from tabs
   - If was active: select adjacent tab

5. renameTab(id, name):
   - Call api.renameTerminalSession(project, session, id, name)
   - Update tab in local state

6. reorderTabs(fromIndex, toIndex):
   - Compute new order
   - Update local state immediately (optimistic)
   - Call api.reorderTerminalSessions(project, session, orderedIds)
   - On error: revert local state

7. refresh():
   - Re-fetch from API
```

**Error Handling:**
- API errors: Set error state, show to user
- Optimistic updates: Revert on failure
