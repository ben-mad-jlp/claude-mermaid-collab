# Session: smooth-soft-reef

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Fix render_ui timeout
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
render_ui calls timeout instead of staying active until the user responds or cancels with the escape key in Claude Code.

**Root Cause:**
60-second hardcoded timeout in MCP HTTP transport layer (`src/mcp/http-transport.ts`, lines 93-99). When `render_ui` with `blocking: true` is called, the UIManager correctly waits indefinitely, but the HTTP transport layer times out after 60 seconds regardless.

**Affected Files:**
- `src/mcp/http-transport.ts` (root cause - hardcoded 60s timeout)
- `src/mcp/setup.ts` (render_ui tool handler)
- `src/routes/api.ts` (`/api/render-ui` endpoint)
- `src/services/ui-manager.ts` (UIManager.renderUI)

**Approach:**
Option A (Recommended): Pass timeout configuration per-request - allow tool handlers to specify no timeout for blocking calls.
Option B: Remove transport timeout globally, rely on session cleanup.
Option C: Use SSE for long-running operations.

**Success Criteria:**
- render_ui with `blocking: true` does NOT timeout after 60 seconds
- UI stays active until user responds or cancels
- Non-blocking calls still return immediately
- Regular MCP tool calls retain timeout protection

**Decisions:**

---

### Item 2: Add item drawer toggle to mobile UI
**Type:** code
**Status:** documented

**Problem/Goal:**
The mobile UI on the preview tab doesn't have a way to show the item drawer when no item is selected. The "Browse" button only appears in the top bar when an item is already selected. Users need a way to manually open the drawer from the empty state.

**Approach:**
Add a "Browse Items" button in the empty state placeholder (PreviewTab.tsx lines 141-166).

**Success Criteria:**
- Empty state shows a "Browse Items" button
- Clicking the button opens the ItemDrawer
- Button styling matches existing UI patterns

**Decisions:**
- Toggle location: In the empty state (not floating button, not always-visible top bar)

---

### Item 3: Add terminal button to terminal tab
**Type:** code
**Status:** documented

**Problem/Goal:**
The mobile TerminalTab shows "No active terminal" when no session exists, but provides no way to create one. Users need a button to create a new terminal session.

**Approach:**
Add a "New Terminal" button in the empty state of TerminalTab.tsx (lines 55-66). Add an `onCreateTerminal` callback prop to allow the parent component to handle terminal creation.

**Success Criteria:**
- Empty state shows a "New Terminal" button
- Clicking the button calls the `onCreateTerminal` callback
- Button styling matches existing UI patterns (accent button)
- Parent component (MobileLayout) wires up the callback to terminal creation logic

**Decisions:**
- Button location: In the empty state (same pattern as Item 2)
- New prop required: `onCreateTerminal?: () => void`

---

### Item 4: Fix terminal sizing to PTY
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
Terminal has dimension sync issues causing:
- Text wrapping at wrong column
- Terminal doesn't scroll to end
- Old text from top of history renders stuck at bottom

**Root Cause:**
PTY and xterm.js dimensions get out of sync. Key issues:
1. PTY auto-creates at 80x24 in `attach()` and starts outputting before client sends resize
2. Buffer replay happens immediately on connect, before resize message arrives
3. No handshake to confirm PTY received correct dimensions before outputting
4. Shell outputs escape codes assuming one size while xterm renders assuming another

**Affected Files:**
- `src/terminal/PTYManager.ts` - `attach()` auto-creates at hardcoded 80x24, replays buffer immediately
- `ui/src/components/terminal/XTermTerminal.tsx` - sends resize after WebSocket opens
- `src/routes/websocket.ts` - handles resize messages

**Approach:**
**Option A (Recommended): Defer buffer replay until after first resize**
1. In `attach()`, don't replay buffer immediately
2. Wait for first resize message from client
3. Resize PTY to client dimensions
4. Then replay buffer
5. This ensures content is displayed with correct dimensions from the start

**Option B: Client-side dimension negotiation**
Send dimensions in initial WebSocket connection URL as query params, PTY uses those dimensions before any output.

**Success Criteria:**
- Text wraps correctly at terminal edge
- Terminal scrolls to bottom on new output
- No "stuck" text rendering in wrong position
- Works on initial connect and after window resize
- Works on mobile orientation change

**Decisions:**
- Prefer server-side fix (Option A) to minimize protocol changes

---

### Item 5: Add real-time status updates via WebSocket
**Type:** code
**Status:** documented

**Problem/Goal:**
Status on UI doesn't refresh unless you refresh the page. Backend broadcasts `status_changed` and `session_state_updated` via WebSocket, but frontend doesn't process them.

**Root Cause:**
- Backend: `statusManager.updateStatus()` → `wsHandler.broadcastStatus()` → sends `status_changed` message ✓
- Frontend: `useAgentStatus` listens for `status_changed` CustomEvent on window
- **Gap:** WebSocket client receives message but never dispatches CustomEvent to window

**Affected Files:**
- `ui/src/lib/websocket.ts` - WebSocket client (needs to dispatch events)
- `ui/src/hooks/useAgentStatus.ts` - Already listens for CustomEvent (no change needed)
- `ui/src/App.tsx` - May need to setup global WebSocket message handler

**Approach:**
Add a global WebSocket message handler that dispatches CustomEvents for specific message types:
1. In App.tsx or a dedicated hook, listen to all WebSocket messages
2. When `status_changed` message received, dispatch `CustomEvent('status_changed', { detail: data })`
3. When `session_state_updated` received, dispatch similar event
4. Existing `useAgentStatus` hook will automatically receive updates

**Success Criteria:**
- Status updates in UI within 1 second of backend change (no polling delay)
- Session state (phase, currentItem) updates in real-time
- No page refresh needed to see status changes
- Existing polling serves as fallback if WebSocket disconnects

**Decisions:**
- Keep polling as fallback (graceful degradation)
- Use CustomEvent bridge pattern (minimal changes to existing code)

---

### Item 6: Auto-flag Kodex topics from skills
**Type:** code
**Status:** documented

**Problem/Goal:**
Skills query Kodex topics but don't flag issues when content is missing, incomplete, or incorrect. Currently requires manual action which is often forgotten.

**Affected Files:**
- `src/mcp/setup.ts` - `kodex_query_topic` tool handler
- `src/services/kodex-manager.ts` - May need `autoFlagMissing` option
- `skills/` - Skill instructions to remind about flagging

**Approach:**
1. **Auto-flag missing topics**: When `kodex_query_topic` returns "not found", automatically create a 'missing' flag (not just log to missing_topics table)
2. **Include flag hint in response**: When topic IS found, include in response: "If this topic is outdated, incorrect, or incomplete, use kodex_flag_topic to report it"
3. **Add context to flags**: Include which skill queried the topic and why (helps prioritize fixes)

**Implementation:**
```typescript
// In kodex_query_topic handler
if (!topic) {
  // Auto-flag missing (not just log)
  await kodex.createFlag(topicName, 'missing', `Requested by skill during ${context || 'query'}`);
  return { found: false, error: 'Topic not found', flagged: true };
}
return {
  found: true,
  topic,
  hint: 'If this topic is outdated/incorrect/incomplete, use kodex_flag_topic'
};
```

**Success Criteria:**
- Missing topics automatically get a 'missing' flag created
- Topic query responses include flagging reminder
- Flags include context about which skill/operation triggered them
- No duplicate flags for same topic/type combination

**Decisions:**
- Auto-flag only for 'missing' (Claude must judge 'incorrect'/'incomplete')
- Include hint in all successful topic queries
- Deduplicate flags by topic+type

---

### Item 7: Replace phase with user-friendly state display names
**Type:** code
**Status:** documented

**Problem/Goal:**
The `phase` field in session state is redundant - it duplicates information already in `state`. The UI shows internal state names like `clear-bs2` or `brainstorm-designing` which aren't user-friendly.

**Affected Files:**
- `src/mcp/workflow/state-machine.ts` - Add display name mapping
- `src/services/session-manager.ts` - Remove phase field or derive from state
- `src/mcp/tools/collab-state.ts` - Update session state handling
- `ui/src/` - Update components that display phase/state

**Approach:**
1. Create a `STATE_DISPLAY_NAMES` mapping in state-machine.ts:
   - `brainstorm-exploring` → "Exploring"
   - `brainstorm-clarifying` → "Clarifying"
   - `brainstorm-designing` → "Designing"
   - `brainstorm-validating` → "Validating"
   - `rough-draft-interface` → "Defining Interfaces"
   - `rough-draft-pseudocode` → "Writing Pseudocode"
   - `rough-draft-skeleton` → "Building Skeleton"
   - `clear-*` states → "Ready to continue" or inherit previous state's name
2. Remove `phase` field from session state (breaking change) OR deprecate it
3. Add `getDisplayName(state)` function
4. Update UI to use display name instead of raw state/phase

**Success Criteria:**
- UI shows user-friendly state names (e.g., "Designing" not "brainstorm-designing")
- Transitional states (clear-*) show meaningful status or previous state name
- No more redundant phase field
- State display names are consistent across UI

**Decisions:**
- Deprecate phase field (keep for backwards compatibility but derive from state)
- Display names should be short (1-2 words) for compact UI

---

### Item 8: Fix state machine to process each item through full pipeline
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
The state machine processes ALL items through brainstorming, then tries to do rough-draft for all. This causes it to skip rough-draft phases. Instead, each item should complete the full pipeline (brainstorm → interface → pseudocode → skeleton) before moving to the next item.

**Root Cause:**
- `workItems[].status` only has `"pending"` | `"documented"` (brainstorming only)
- State machine batches phases across items instead of per-item pipeline
- No tracking of rough-draft progress per item

**Affected Files:**
- `src/mcp/workflow/state-machine.ts` - Transition logic (change to per-item pipeline)
- `src/mcp/workflow/transitions.ts` - Condition checks
- `src/mcp/workflow/types.ts` - WorkItemStatus type definition

**Approach:**
1. Replace `status` with unified pipeline status:
   ```typescript
   type ItemStatus = 
     | 'pending'      // not started
     | 'brainstormed' // design complete, ready for rough-draft
     | 'interface'    // interface doc done
     | 'pseudocode'   // pseudocode doc done  
     | 'skeleton'     // skeleton doc done
     | 'complete';    // ready for implementation
   
   interface WorkItem {
     number: number;
     title: string;
     type: WorkItemType;
     status: ItemStatus;  // unified pipeline status
   }
   ```
2. Change state machine flow:
   - After brainstorm-validating: stay on same item, go to rough-draft-interface
   - After rough-draft-skeleton: mark item `'complete'`, move to next item
   - Only route to handoff when ALL items have `status: 'complete'`
3. Update skills to set appropriate status after each phase

**Success Criteria:**
- Each item goes through full pipeline before next item starts
- State machine only routes to handoff when ALL items are `'complete'`
- Clear progression: pending → brainstormed → interface → pseudocode → skeleton → complete

**Decisions:**
- Single `status` field tracks full pipeline (simpler than two fields)
- Per-item pipeline instead of per-phase batching
- Rename `'documented'` to `'brainstormed'` for clarity

---

## Diagrams
(auto-synced)