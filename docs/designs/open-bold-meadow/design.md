# Session: open-bold-meadow

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Tab drag resets terminals
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
When dragging terminal tabs to reorder them, the terminals reset/restart instead of maintaining their connection.

**Approach:**
Remove the "Start Terminal" button and auto-start terminals immediately on render. This eliminates the `isStarted` local state that was being reset when React remounts components during tab reorder.

**Root Cause:**
React remounts `EmbeddedTerminal` components when the `tabs` array is reordered, even though `key={tab.id}` is stable. The local `isStarted` state (initialized to `false`) resets on remount, causing the "Start Terminal" button to reappear.

**Success Criteria:**
- Dragging tabs to reorder them does not interrupt the terminal session
- Terminal output is preserved after reordering
- No "Start Terminal" button - terminals start immediately

**Decisions:**
- Auto-start approach chosen over lifting state (simpler, better UX)
- Accept that all tabs will have active connections (acceptable tradeoff)

---

### Item 2: Page refresh resets tabs
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
Despite localStorage persistence, terminal tabs are being reset on page refresh instead of reconnecting to existing tmux sessions.

**Approach:**
This will be fixed as part of Item 3 (MCP tmux migration). The MCP server will be the source of truth for terminal sessions, eliminating the race condition between session loading and tab initialization.

**Root Cause:**
Race condition on page load:
1. `currentSession` is `null` initially (async load)
2. `collabSessionId` is `undefined` → wrong `storageKey`
3. Hook reads from default localStorage key (wrong tabs)
4. Cleanup effect runs with wrong tabs → may kill valid tmux sessions
5. Then `currentSession` loads → correct `storageKey`
6. Re-initializes with correct tabs, but sessions already killed

**Success Criteria:**
- Refreshing the page restores terminal tabs with their names and order
- Each tab reconnects to its corresponding tmux session
- Terminal history/state is preserved

**Decisions:**
- Fix via MCP migration (Item 3) rather than patching the race condition
- MCP becomes source of truth for terminal sessions
- Depends on: Item 3

---

### Item 3: Move tmux coordination to MCP
**Type:** code
**Status:** documented
**Problem/Goal:**
Terminal/tmux session management is currently handled in the UI. Move this to the MCP server to provide centralized session lifecycle management (create, list, attach, kill).

**Approach:**
Add MCP tools for terminal session management:
- `terminal_create_session({ project, session, name? })` → `{ id, tmuxSession, wsUrl }`
- `terminal_list_sessions({ project, session })` → `{ sessions: [...] }`
- `terminal_kill_session({ project, session, id })` → `{ success }`
- `terminal_rename_session({ project, session, id, name })` → `{ success }`

Storage: `.collab/<session>/terminal-sessions.json`

On server startup: reconcile stored sessions with actual tmux sessions (clean orphans).

UI changes:
- Remove localStorage persistence from useTerminalTabs
- Fetch terminal list from MCP on mount
- Call MCP tools for create/delete/rename
- ttyd iframe connects to tmux sessions by name

**Success Criteria:**
- MCP server can create new tmux sessions
- MCP server can list existing tmux sessions
- MCP server can kill tmux sessions
- UI consumes MCP tools instead of direct tmux interaction
- Orphaned tmux sessions cleaned up on server startup

**Decisions:**
- Store terminal metadata in `.collab/<session>/terminal-sessions.json`
- Reconcile tmux sessions on MCP server startup
- UI becomes stateless (MCP is source of truth)

---

### Item 4: Collab-scoped terminal sessions
**Type:** code
**Status:** documented
**Problem/Goal:**
Each collab session should have its own set of tmux sessions that persist and restore when switching between collab sessions.

**Approach:**
This is inherently handled by Item 3's design:
- Terminal sessions stored in `.collab/<session>/terminal-sessions.json`
- MCP tools require `project` and `session` parameters
- Each collab session has isolated terminal state
- Switching sessions = calling `terminal_list_sessions` for the new session

UI flow on session switch:
1. User selects different collab session
2. UI calls `terminal_list_sessions({ project, session })`
3. UI renders tabs for returned sessions
4. ttyd iframes connect to the corresponding tmux sessions

**Success Criteria:**
- Switching to a collab session shows its associated terminal tabs
- Terminal sessions are scoped/prefixed by collab session
- Switching away and back restores the same terminals
- Orphaned sessions are cleaned up appropriately

**Decisions:**
- Collab scoping is built into Item 3's MCP design
- No additional work needed beyond Item 3
- Depends on: Item 3

---

### Item 5: Remove render_ui timeout
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
The render_ui MCP tool times out after 30 seconds by default (max 5 minutes), which interrupts the workflow when the user takes longer to respond.

**Approach:**
In `src/mcp/tools/render-ui.ts`:
1. Change `DEFAULT_TIMEOUT` to a much larger value (e.g., 10 minutes or indefinite)
2. Remove or significantly increase `MAX_TIMEOUT`
3. Consider making timeout optional (no timeout if not specified)

**Root Cause:**
- Line 20: `DEFAULT_TIMEOUT = 30000` (30 seconds)
- Line 22: `MAX_TIMEOUT = 300000` (5 minutes max)
- Line 183-187: setTimeout rejects the promise after timeout

**Success Criteria:**
- render_ui waits indefinitely (or much longer) for user response
- No timeout errors when user takes time to think
- Default behavior should be "wait forever"

**Decisions:**
- No default timeout - wait forever unless caller specifies
- No max timeout - callers can set any value they want
- If timeout param is omitted or 0, wait indefinitely
- Keep optional timeout parameter for callers who want it

---

## Diagrams
(auto-synced)