# Session: quiet-cool-fjord

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Use MCP for session discovery in collab skill
**Type:** code
**Status:** documented
**Problem/Goal:** Collab skill should use MCP tools to check for existing sessions instead of requiring manual prompts.

**Approach:**
Update `session-mgmt.md` Step 2 to replace the bash command with MCP tool:
- Replace `ls -d .collab/*/ ...` with `mcp__mermaid__list_sessions`
- Filter results to current project: `sessions.filter(s => s.project == cwd)`
- Optionally show `lastAccess` timestamp for recency

**Success Criteria:**
- Session discovery uses MCP tool, not bash
- Sessions filtered to current project
- User sees same selection UI

**Decisions:**
- Use MCP `list_sessions` which returns all sessions across projects
- Filter by project path to show only relevant sessions

---

### Item 2: Make MCP usage default in collab setup
**Type:** code
**Status:** documented
**Problem/Goal:** Collab setup isn't using MCP by default - it only uses MCP when explicitly told to.

**Approach:**
1. Add "MCP-First" guidance to each collab skill header
2. Replace bash patterns with MCP equivalents:
   - `SKILL.md`: `curl` → `check_server_health`
   - `session-mgmt.md`: `ls` → `list_sessions`
   - `work-item-loop.md`: `cat` → `get_document`
3. Add MCP reference table to main SKILL.md

**Success Criteria:**
- All collab skills describe MCP-first patterns
- No bash commands for operations MCP can handle
- Claude naturally uses MCP when following skills

**Decisions:**
- Bash only for git commands and external tools
- MCP for all session/document/diagram operations

---

### Item 3: Task subagent not being used in execute-plans
**Type:** bugfix
**Status:** documented
**Problem/Goal:** The execute-plans skill is not using the task subagent as intended.

**Approach:**
Update `execution.md` to add explicit parallel dispatch example showing multiple Task tool calls in a single response.

**Root Cause:**
The skill says "single message, multiple tool calls" but doesn't show what that looks like. Claude processes tasks sequentially instead of batching parallel-safe tasks.

**Success Criteria:**
- Skill shows explicit multi-tool-call example
- Claude dispatches parallel-safe tasks in one message
- Tasks run concurrently instead of sequentially

**Decisions:**
- Add concrete example to execution.md showing 3 parallel Task tool calls

---

### Item 4: Make render_ui default for user interactions
**Type:** code
**Status:** documented
**Problem/Goal:** render_ui should be the default for user interactions across all collab skills (except before session selection).

**Approach:**
1. Add standard "User Interactions" guidance to skill template
2. Audit all collab skills and add render_ui patterns where user input is needed
3. Promote component selection guide from brainstorming.md to shared doc

**Skills to update:**
- rough-draft (interface, pseudocode, skeleton, handoff)
- executing-plans (checkpoints)
- ready-to-implement
- task-planning
- collab-cleanup
- finishing-a-development-branch

**Success Criteria:**
- Every skill with user input uses render_ui when session active
- Consistent UX across all collab workflows

**Decisions:**
- Terminal prompts only when no collab session exists
- render_ui is the default for all user input within collab

---

### Item 5: Add refresh items button to UI
**Type:** code
**Status:** documented
**Problem/Goal:** Add a refresh button to allow users to refresh the items list.

**Approach:**
1. Add refresh icon/button to the sidebar pane header (diagrams/documents list)
2. On click, re-fetch `list_diagrams` and `list_documents` from MCP
3. Update the UI with fresh data

**Success Criteria:**
- Refresh button visible in sidebar
- Click triggers re-fetch of diagrams and documents
- List updates without page reload

**Decisions:**
- Button in sidebar header (not per-item)
- Single button refreshes both diagrams and documents

---

### Item 6: Optimize list_documents/list_diagrams to return names only
**Type:** code
**Status:** documented
**Problem/Goal:** MCP list_documents and list_diagrams return full document content instead of just names. Should return names only so content can be pulled as needed.

**Approach:**
1. Change `listDocuments()` in document-manager.ts to return metadata only
2. Remove `content` field from list response (keep id, name, lastModified)
3. Same change for `listDiagrams()` in diagram-manager.ts
4. Use `getDocument(id)` / `getDiagram(id)` to fetch content when needed

**Success Criteria:**
- `list_documents` returns only: id, name, lastModified
- `list_diagrams` returns only: id, name, lastModified
- Full content fetched via separate get calls

**Decisions:**
- Breaking change to MCP API response shape
- Skills/UI may need updates to fetch content separately

---

### Item 7: Encourage more liberal diagram creation in skills
**Type:** code
**Status:** documented
**Problem/Goal:** Not making as many diagrams as before. Diagrams are cheap, easy ways to show information and should be used more liberally.

**Approach:**
1. Add "Diagram Opportunities" section to key skills:
   - brainstorming: "Create architecture diagram when >3 components"
   - rough-draft/interface: "Create class/sequence diagram for complex interactions"
   - systematic-debugging: "Create state diagram to trace bug"
2. Add explicit triggers in skill flow (IF discussing architecture → CREATE diagram)
3. Add guidance: "Diagrams are cheap. When in doubt, make one."

**Success Criteria:**
- Skills explicitly prompt for diagram creation at key moments
- More diagrams created during typical collab sessions
- Diagrams used to communicate complex ideas

**Decisions:**
- Lower threshold for diagram creation
- Explicit prompts beat implicit expectations

---

### Item 8: Fix npm deprecation warnings in setup.sh
**Type:** task
**Status:** documented
**Problem/Goal:** setup.sh shows deprecation warnings for inflight@1.0.6, glob@8.1.0, and nomnom@1.5.2.

**Approach:**
Use npm overrides in plugins/wireframe/package.json to pin or replace deprecated transitive deps:
- inflight@1.0.6 ← glob@8.1.0 ← @rollup/plugin-commonjs
- nomnom@1.5.2 ← jison@0.4.18

Add overrides section to suppress warnings while keeping functionality.

**Success Criteria:**
- No deprecation warnings during npm install
- Build and tests still pass

**Decisions:**
- Use npm overrides (pragmatic fix)
- Defer jison replacement to future work

---

### Item 9: Fix TextArea.tsx onChange error in render_ui
**Type:** bugfix
**Status:** documented
**Problem/Goal:** TextArea.tsx:40 throws "Uncaught TypeError: e is not a function" when typing in the render_ui textbox.

**Approach:**
1. Make `onChange` optional in TextArea props interface
2. Add optional chaining: `onChange?.(newValue)` at line 40
3. Let TextArea manage internal state for form collection via name attribute

**Root Cause:**
AIUIRenderer passes props directly but doesn't provide `onChange` callback. TextArea calls `onChange(newValue)` on undefined.

**Success Criteria:**
- No error when typing in TextArea
- Form data still collected via name attribute on submit

**Decisions:**
- Make onChange optional rather than requiring renderer to provide it
- Input components work both controlled and uncontrolled

---

### Item 10: Add padding below markdown content before RadioGroup
**Type:** code
**Status:** documented
**Problem/Goal:** Need padding/spacing between markdown content and RadioGroup in render_ui cards.

**Approach:**
Add bottom margin (`mb-4`) to Markdown component in `Markdown.tsx`.

**Success Criteria:**
- Markdown component has bottom margin by default
- Natural spacing before RadioGroup without needing Divider

**Decisions:**
- Margin on Markdown (not RadioGroup) because Markdown is always followed by something
- Use Divider for semantic separation (messages), not spacing

---

### Item 11: Fix split bar jumping when dragging
**Type:** bugfix
**Status:** documented
**Problem/Goal:** The split bar between document render and chat jumps around when dragged.

**Approach:**
1. Add `user-select: none` and `pointer-events: none` to panel content during drag
2. Check for CSS transitions on panel containers that may interfere
3. Debounce/throttle the `onLayout` callback to reduce re-renders
4. Consider upgrading react-resizable-panels (currently 0.0.56, current is 2.x)

**Root Cause:**
Jumping during drag likely caused by content reflow or CSS transitions interfering with panel sizing during the drag operation.

**Success Criteria:**
- Smooth drag without jumping
- Panel content doesn't interfere with drag

**Decisions:**
- Start with CSS fixes before library upgrade
- Test with Mermaid content to ensure no re-rendering during drag

---

## Diagrams
(auto-synced)