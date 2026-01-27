# Session: fair-light-stream

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Auto-select new terminal when opened
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
When opening a new terminal, it should automatically be selected.

**Approach:**
Modify `addTab` function to call `setActiveTabId(result.id)` after `refresh()` completes.

**Root Cause:**
The `addTab` function in `ui/src/hooks/useTerminalTabs.ts:73-83` ignores the new terminal's ID returned from `createTerminalSession`. After calling `refresh()`, it defaults to localStorage-persisted selection rather than selecting the new terminal.

**Success Criteria:**
- New terminal automatically selected after clicking "+"
- Tab bar highlights new terminal's tab
- Terminal content area shows the new terminal

**Decisions:**
- Also persist new ID to localStorage for consistency

**Files:**
- `ui/src/hooks/useTerminalTabs.ts` - `addTab` function needs modification

---

### Item 2: Fix terminal close causing project change
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
When closing a terminal, it changes the project and requires reselection.

**Approach:**
1. Add missing `selectedProject` dependency to Header useEffect (line 100)
2. Guard auto-select first project logic to check `currentSession` exists
3. Consider not auto-selecting session when project changes if current session is still valid

**Root Cause:**
State synchronization issue in `ui/src/components/layout/Header.tsx`:
- Missing dependency in useEffect causes stale closure comparisons
- Auto-select logic can trigger during async terminal delete operations
- This cascades: Header -> sessionStore -> TerminalTabsContainer -> useTerminalTabs refresh with different session

**Success Criteria:**
- Closing terminal tab does NOT change current project/session
- Terminal tabs remain intact after closing a tab
- No reselection required after terminal operations

**Decisions:**
- May need runtime debugging to confirm exact trigger if fixes don't resolve

**Files:**
- `ui/src/components/layout/Header.tsx` - Primary suspect (state sync issues)
- `ui/src/hooks/useTerminalTabs.ts` - Terminal tab management
- `ui/src/components/terminal/TerminalTabsContainer.tsx` - Derives project/session from store

---

### Item 3: Task quantity not auto updating
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
Task quantity display is not refreshing/updating automatically.

**Approach:**
Add WebSocket broadcast for session state updates:
1. Add `session_state_updated` message type to `src/websocket/handler.ts`
2. Broadcast after `updateSessionState()` in `src/mcp/setup.ts`
3. Handle in App.tsx to update `collabState` in sessionStore

**Root Cause:**
No real-time notification mechanism when session/collab state changes:
- Task data fetched once on session load, never refreshes
- `update_session_state` MCP tool writes to file but doesn't broadcast
- No WebSocket message type for state updates
- No polling fallback

**Success Criteria:**
- Task count updates automatically when tasks complete/added
- No manual refresh required
- Updates appear within 1-2 seconds of backend change

**Decisions:**
- Use WebSocket broadcast (Option A) rather than polling

**Files:**
- `ui/src/components/SessionStatusPanel.tsx` - Displays task progress
- `ui/src/stores/sessionStore.ts` - Holds collabState
- `ui/src/App.tsx` - WebSocket handler (needs new case)
- `src/websocket/handler.ts` - Message types (needs new type)
- `src/mcp/setup.ts` - MCP handler (needs broadcast)

---

### Item 4: Terminal selection without copying
**Type:** code
**Status:** documented
**Problem/Goal:**
Allow selecting text in terminal without copying. Right-click should copy selected text.

**Approach:**
Replace iframe-based terminal with direct xterm.js component:
1. Create `XTermTerminal.tsx` using `@xterm/xterm` (already in deps)
2. Configure with `rightClickSelectsWord: false`
3. Use `AttachAddon` to connect to ttyd WebSocket backend
4. Add contextmenu handler: `term.getSelection()` → `navigator.clipboard.writeText()`
5. Update `EmbeddedTerminal.tsx` to use new component

**Success Criteria:**
- Mouse drag selects text without auto-copy
- Right-click copies selected text to clipboard
- Terminal still connects to tmux sessions via ttyd backend

**Decisions:**
- Direct xterm.js (Option B) over iframe modifications - gives full control
- Keep ttyd backend as-is, only replace frontend rendering
- Use existing deps: `@xterm/xterm`, `@xterm/addon-attach`, `@xterm/addon-fit`

**Files:**
- Create: `ui/src/components/terminal/XTermTerminal.tsx`
- Modify: `ui/src/components/EmbeddedTerminal.tsx` - use new component
- Modify: `ui/src/components/terminal/TerminalTabsContainer.tsx` - update imports

---

### Item 5: Disable tmux terminal splitting
**Type:** code
**Status:** documented
**Problem/Goal:**
Prevent splitting of tmux terminal.

**Approach:**
Add unbind commands in `createTmuxSession()` after mouse option:
```bash
tmux unbind-key -t ${tmuxSessionName} %
tmux unbind-key -t ${tmuxSessionName} '"'
```

**Success Criteria:**
- Ctrl+B % (horizontal split) does nothing
- Ctrl+B " (vertical split) does nothing
- Mouse scrolling still works
- Other tmux functionality unaffected

**Decisions:**
- Session-scoped unbind (only affects collab sessions, not user's personal tmux)
- No error handling needed (unbind won't fail)

**Files:**
- `src/services/terminal-manager.ts` - `createTmuxSession()` method (lines 111-135)

---

### Item 6: Browser notification when user input needed
**Type:** code
**Status:** documented
**Problem/Goal:**
Show a notification/alert in the browser when Claude needs user input.

**Approach:**
1. Request Notification permission on app mount in App.tsx
2. In `ui_render` handler (App.tsx:326), trigger notification for blocking messages:
   ```typescript
   new Notification('Claude is asking...', {
     body: 'Click here to respond',
     icon: '/claude-icon.png',
     tag: `claude-input-${uiId}`, // Prevents duplicates
     requireInteraction: true,
   });
   ```
3. Optionally create `ui/src/services/notification-service.ts` for utility functions

**Success Criteria:**
- Notification appears for blocking messages even when tab not focused
- Notification dismisses when user responds
- Works when permission granted; graceful fallback when denied

**Decisions:**
- Only notify for blocking messages (non-blocking don't require immediate response)
- Request permission on app load (non-intrusive)
- Use `tag` to prevent duplicate notifications
- Use `requireInteraction: true` to keep visible until user acts

**Files:**
- `ui/src/App.tsx` - Add permission request on mount, notification in ui_render handler
- Create: `ui/src/services/notification-service.ts` (optional utility)

---

## Diagrams
(auto-synced)