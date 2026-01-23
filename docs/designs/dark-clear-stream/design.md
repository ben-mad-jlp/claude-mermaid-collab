# Session: dark-clear-stream

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Add collab-compact between each step in rough-draft
**Type:** code
**Status:** documented
**Problem/Goal:**
Rough-draft phases can accumulate significant context. Currently, snapshots are saved but actual compaction isn't triggered. Users need compaction between phases to maintain clean context.

**Approach:**
Modify `rough-draft/SKILL.md` to invoke `/collab-compact` at each phase transition with a user prompt:

1. After Interface phase completes → prompt "Ready to compact before Pseudocode?"
2. After Pseudocode phase completes → prompt "Ready to compact before Skeleton?"
3. After Skeleton phase completes → prompt "Ready to compact before Implementation?"

If user says Yes → invoke `collab-compact` skill, then continue
If user says No → continue without compaction

**Success Criteria:**
- User is prompted 3 times during rough-draft (at each phase boundary)
- Choosing "Yes" triggers actual compaction via `/collab-compact`
- Session resumes correctly after each compaction
- Choosing "No" skips compaction and continues normally

**Decisions:**
- Prompted (not automatic) - user controls when compaction happens
- Uses existing `collab-compact` skill rather than inline implementation
- 3 compaction points: Interface→Pseudocode, Pseudocode→Skeleton, Skeleton→Implementation

---

### Item 2: Verify collab-compact is happening at expected times
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
User hasn't seen collab-compact happen during rough-draft workflow despite documentation suggesting it should.

**Approach:**
Add explicit `collab-compact` skill invocations to skill files:
1. `brainstorming/transition.md` - Add invocation before invoking rough-draft
2. `rough-draft/SKILL.md` - Add invocation at each phase transition
3. `rough-draft/handoff.md` - Add invocation before executing-plans

**Root Cause:**
`work-item-loop.md` documents that collab-compact should be invoked, but actual skill files only document inline `saveSnapshot()`. The critical difference:
- `saveSnapshot()` - Saves context to JSON via MCP tools, NO compaction trigger
- `collab-compact` skill - Saves snapshot AND triggers `/compact` command

Skills were written with inline saves, but no explicit "Invoke skill: collab-compact" instructions exist in executable skill files.

**Success Criteria:**
- User sees "Triggering compaction now..." at documented points
- Context snapshot saved before each compaction
- Clean resume possible after compaction at any phase

**Decisions:**
- Use Approach A: Add explicit collab-compact invocations (keep separation of concerns)
- Skills save context inline, orchestration handles compaction triggers explicitly

---

### Item 3: Refactor skills that reference md files into separate skills
**Type:** code
**Status:** documented
**Problem/Goal:**
Skills reference markdown files with "For detailed instructions, see [file.md]" but Claude doesn't always read these files, causing incomplete execution.

**Approach:**
Convert 13 referenced markdown files into separate skills with flat prefix naming. Parent skills become orchestrators that invoke sub-skills via `Skill` tool.

New skills to create:
- collab-session-mgmt, collab-work-item-loop
- brainstorming-exploring, brainstorming-clarifying, brainstorming-designing, brainstorming-validating, brainstorming-transition
- rough-draft-interface, rough-draft-pseudocode, rough-draft-skeleton, rough-draft-handoff
- executing-plans-execution, executing-plans-review

Parent skill changes:
- Replace "For detailed instructions, see [file.md]" with "Invoke skill: <prefix>-<name>"
- Add sub-skills to `allowed-tools` if parent has restrictions

**Success Criteria:**
- 13 new skill folders created with SKILL.md files
- Parent skills updated to invoke sub-skills
- Sub-skills properly load when invoked
- All sub-skills have `user-invocable: false`

**Decisions:**
- Flat naming with prefix (e.g., `brainstorming-exploring`)
- Parents remain as orchestrators
- Sub-skills are not user-invocable (invoked by parent only)

---

### Item 4: Move render_ui drawer to adjustable panel left of item list
**Type:** code
**Status:** documented

**Exploration Findings:**
- SplitPane component exists with full resize, collapsible, persistent layout support
- ThreeWaySplitPane available for 3-panel layouts
- Current ChatDrawer is overlay at 400px, slides in/out
- Current layout: Header → (Sidebar + main) → ChatDrawer overlay

**Problem/Goal:**
Convert the ChatDrawer from a sliding overlay drawer to an always-visible, resizable panel on the right side of the layout.

**Approach:**
1. Use existing SplitPane component to create resizable layout
2. New layout structure: `Sidebar | SplitPane(Main Content | Chat Panel)`
3. Chat panel always visible, resizable via drag handle
4. Default width: 400px (matching current drawer)
5. Remove ChatToggle button and overlay behavior
6. Persist panel width using SplitPane's storageId feature

**Implementation Steps:**
1. Modify App.tsx layout to wrap main content and chat in SplitPane
2. Convert ChatDrawer to ChatPanel (remove fixed positioning, overlay, animations)
3. Remove ChatToggle component usage
4. Set minSecondarySize to ~20% to ensure chat always has space
5. Set defaultSecondarySize based on 400px relative to viewport

**Success Criteria:**
- Chat panel always visible on right side
- Panel width adjustable via drag handle
- Panel width persists across sessions
- No toggle button needed
- Responsive on smaller screens

**Decisions:**
- Always visible (not collapsible) - user confirmed
- Position: Right side (Sidebar | Main | Chat) - user confirmed  
- Default width: 400px minimum - user confirmed
- Use existing SplitPane component

---

### Item 5: WebSocket not updating React GUI
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
When diagrams/documents are created via MCP tools, the React UI doesn't update - items don't appear in the sidebar.

**Root Cause:**
Server broadcasts `diagram_created` and `document_created` messages WITHOUT the `content` field, but the React UI REQUIRES `content` to add items to state.

Evidence:
- Server (src/routes/api.ts:230-236) broadcasts: `{type, id, name, project, session}` - no content
- Client (ui/src/App.tsx:238-248) checks: `if (id && name && content !== undefined)` - fails silently
- Result: `addDiagram()` / `addDocument()` never called, UI doesn't update
- `_updated` messages include content and work; `_created` messages omit it and fail

**Approach:**
1. In src/routes/api.ts diagram creation: Include `content` and `lastModified` in broadcast
2. In src/routes/api.ts document creation: Include `content` and `lastModified` in broadcast  
3. Update type definition in src/websocket/handler.ts: Add fields to `diagram_created` and `document_created` types

**Success Criteria:**
- Diagrams created via MCP appear immediately in React UI sidebar
- Documents created via MCP appear immediately in React UI sidebar
- No page refresh required after creation

**Decisions:**
- Fix at server level by including content in broadcasts
- Minimal change - just add missing fields

---

## Diagrams
(auto-synced)