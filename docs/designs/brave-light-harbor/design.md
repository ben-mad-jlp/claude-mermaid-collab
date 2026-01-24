# Session: brave-light-harbor

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Simplify UI layout - single message + terminal split
**Type:** code
**Status:** documented
**Problem/Goal:** Have only one message at top of right pane, with terminal on bottom of the split. Running collab from terminal.

**Approach:**
1. Replace chat message list with single message display (new messages replace old)
2. Add embedded terminal using xterm.js connected to ttyd backend
3. Layout: vertical split with message area on top, terminal on bottom
4. Terminal connects to `ws://localhost:7681/ws`

**Success Criteria:**
- Single message displayed at a time (no scroll history)
- Embedded terminal can run Claude Code
- Terminal input/output works correctly

**Decisions:**
- Use ttyd for terminal backend (zero code, handles resize)
- xterm.js for browser terminal rendering
- Messages replace rather than accumulate

---

### Item 2: Unified server startup command
**Type:** task
**Status:** documented
**Problem/Goal:** Need a way to start the API, UI, and MCP all in one command.

**Approach:**
1. Use `concurrently` to run multiple processes
2. Single `dev` script starts: API server, UI (vite), ttyd terminal backend
3. MCP server is separate (started by Claude Code)

```json
{
  "scripts": {
    "dev": "concurrently \"bun run src/server.ts\" \"cd ui && bun run dev\" \"ttyd -p 7681 -W bash\""
  }
}
```

**Success Criteria:**
- `bun run dev` starts all services
- UI available at localhost:5173
- API available at localhost:3737
- Terminal WebSocket at localhost:7681

**Decisions:**
- Use concurrently for process management
- ttyd on port 7681
- MCP started separately by Claude Code (not part of dev script)

---

### Item 3: Document/diagram creation notifications
**Type:** code
**Status:** documented
**Problem/Goal:** Show clickable messages when a document or diagram is created or updated, letting user click to view it.

**Approach:**
1. When MCP create/update returns, include clickable link in the message
2. Link component opens the document/diagram in the left pane
3. Format: "Created: [design.md](click to view)" or "Updated: [task-deps.mmd](click to view)"

**Success Criteria:**
- Creation/update messages include clickable links
- Clicking opens the artifact in viewer pane
- Works for both documents and diagrams

**Decisions:**
- Inline in message area (not toast or sidebar highlight)
- Links trigger viewer navigation, not new tab

---

### Item 4: Skill transition messages
**Type:** code
**Status:** documented
**Problem/Goal:** Show messages that tell the user when moving to new skills.

**Approach:**
1. Each skill invocation sends a render_ui message announcing the transition
2. Format: "Moving to [skill-name] skill..." with brief description
3. Message appears in the single message area before skill begins

**Success Criteria:**
- User sees which skill is being invoked
- Transition is visible before skill starts working

**Decisions:**
- Use render_ui with non-blocking call for announcements
- Keep messages brief and informative

---

### Item 5: Status indicator (working/waiting)
**Type:** code
**Status:** documented
**Problem/Goal:** Have something that says "working" or "waiting for user input" on the GUI to let user know what's happening in Claude Code console.

**Approach:**
1. Add status bar/indicator in the UI (top or near message area)
2. States: "Working...", "Waiting for input", "Idle"
3. MCP sends status updates via WebSocket or polling endpoint
4. Could use render_ui with Spinner component for "Working" state

**Success Criteria:**
- User can see current Claude Code state at a glance
- Status updates in real-time

**Decisions:**
- Simple text indicator with optional spinner
- Integrate with existing WebSocket connection

---

### Item 6: Replace RadioGroup with Dropdown
**Type:** code
**Status:** documented
**Problem/Goal:** No radio buttons - use dropdown instead.

**Approach:**
1. Create new Dropdown/Select AI-UI component
2. Replace RadioGroup usage in render_ui with Dropdown
3. Same props interface: options, name, label

**Success Criteria:**
- Dropdown component available in AI-UI
- Skills use Dropdown instead of RadioGroup
- Cleaner UI with less vertical space

**Decisions:**
- Keep RadioGroup component available but prefer Dropdown
- Native HTML select or custom styled dropdown

---

### Item 7: Fix DiffView not showing on patch
**Type:** bugfix
**Status:** documented
**Problem/Goal:** Diff view still doesn't show in document render when a patch happens. Also need a clear diff button.

**Approach:**
1. Investigate why patch_document doesn't trigger diff view
2. Store previous content before patch, compare after
3. Add "Clear Diff" button to dismiss the diff view

**Root Cause:**
TBD - need to trace patch_document flow to see where diff display is missing

**Success Criteria:**
- Diff view shows automatically after patch_document
- Clear button dismisses the diff
- Works for both documents and diagrams

**Decisions:**
- Diff view should auto-show on any content change
- Clear button resets to normal view

---

### Item 8: Move clear button, remove top chat bar
**Type:** code
**Status:** documented
**Problem/Goal:** Add clear button next to send bar. Remove the top chat bar.

**Approach:**
1. Remove top chat bar component entirely
2. Add clear/reset button next to the send input area
3. Clear button resets the message area

**Success Criteria:**
- No top chat bar
- Clear button visible next to send area
- Clicking clear resets the view

**Decisions:**
- Cleaner header without chat bar
- Clear button integrated with input controls

---

### Item 9: Improve compact messaging
**Type:** code
**Status:** documented
**Problem/Goal:** Cannot compact with a tool. It tells user to run compact then collab to resume. Should communicate this better in the chat.

**Approach:**
1. When compact is needed, send clear message via render_ui
2. Message explains: "Context full. Run /compact in terminal, then /collab to resume."
3. Show this in the message area so user sees it in the GUI

**Success Criteria:**
- Compact instructions visible in GUI message area
- User doesn't need to watch terminal for this info

**Decisions:**
- Use render_ui to communicate compact need
- Keep instructions simple and actionable

---

### Item 10: Always allow mermaid MCP commands
**Type:** task
**Status:** documented
**Problem/Goal:** Is there a way to always allow all mermaid commands without permission prompts?

**Approach:**
1. Check Claude Code settings for MCP tool permissions
2. Add mermaid tools to allowed list in settings.json or .claude/settings.local.json
3. Pattern: `mcp__mermaid__*` or `mcp__plugin_mermaid-collab_mermaid__*`

**Success Criteria:**
- No permission prompts for mermaid MCP tools
- All create/update/patch/render operations auto-allowed

**Decisions:**
- Configure at project level (.claude/settings.local.json)
- Allow all mermaid-collab MCP tools

---

### Item 11: Always show task execution diagram
**Type:** code
**Status:** documented
**Problem/Goal:** Don't always show the task execution live diagram. Should always show and update throughout the executing-plans process.

**Approach:**
1. Update executing-plans skill to always create task-execution diagram
2. Diagram auto-opens in viewer when created
3. Update diagram status (waiting→executing→completed) as tasks progress
4. Use patch_diagram for status style updates

**Success Criteria:**
- Task execution diagram always created at start
- Diagram visible in viewer throughout execution
- Task states update in real-time

**Decisions:**
- Diagram is mandatory, not optional
- Auto-open in left pane viewer

---

### Item 12: Auto-accept option for rough-draft
**Type:** code
**Status:** documented
**Problem/Goal:** Have an option at the beginning of rough-draft that allows user to auto-accept all rough-draft changes.

**Approach:**
1. At rough-draft start, ask: "Auto-accept all changes?" Yes/No
2. If yes, skip [PROPOSED] → approval flow for each phase
3. Store preference in session state
4. Still show artifacts but don't block for approval

**Success Criteria:**
- Option presented at rough-draft start
- Auto-accept skips per-phase approval prompts
- Faster iteration when user trusts the process

**Decisions:**
- Per-session setting (not global)
- Can still review artifacts, just no blocking prompts

---

### Item 13: Fix Mermaid diagram contrast in dark mode
**Type:** bugfix
**Status:** documented
**Problem/Goal:** Mermaid diagrams don't look good in dark theme - text does not contrast well.

**Approach:**
1. Configure Mermaid theme based on system/app dark mode
2. Use 'dark' theme for Mermaid when in dark mode
3. Or customize theme variables for better contrast

**Root Cause:**
Mermaid using default/light theme colors on dark background

**Success Criteria:**
- Text readable in dark mode
- Diagram colors work well on dark background
- Theme switches with app theme

**Decisions:**
- Use Mermaid's built-in 'dark' theme
- Sync with app theme preference

---

## Diagrams
(auto-synced)
