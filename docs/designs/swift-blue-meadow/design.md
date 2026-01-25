# Session: swift-blue-meadow

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)
**Reference:** See `/docs/collab-codex-spec.md` for full Collab Codex specification

---

## Work Items

### Item 1: Fix subagent-driven-development skill path resolution
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
Currently tries `subagent-driven-development` before realizing it should use `mermaid-collab:subagent-driven-development:implementer-prompt`

**Root Cause:**
Multiple skill files reference `subagent-driven-development` without the full namespaced path. Files affected:
- `skills/executing-plans-execution/SKILL.md:92` - says "invoke `subagent-driven-development` skill"
- `skills/executing-plans/execution.md:76` - says "invoke `subagent-driven-development` skill"  
- `skills/executing-plans/SKILL.md` - multiple references to short name
- `skills/rough-draft/handoff.md:142` - short reference
- `skills/rough-draft-handoff/SKILL.md:122` - short reference
- `skills/writing-plans/SKILL.md:143` - incorrectly uses `superpowers:subagent-driven-development`
- `skills/finishing-a-development-branch/SKILL.md:256` - short reference

The correct usage is shown in `skills/executing-plans/execution.md:97-109` with full path:
`mermaid-collab:subagent-driven-development:implementer-prompt`

**Approach:**
Update all skill files to use the full namespaced path when referencing the subagent-driven-development agent.

**Success Criteria:**
- All references use `mermaid-collab:subagent-driven-development:implementer-prompt` (or appropriate sub-skill)
- No short-form `subagent-driven-development` references remain in skill instructions

**Decisions:**

---

### Item 2: Fix task execution diagram color updates
**Type:** bugfix
**Status:** documented
**Problem/Goal:**
Task execution diagram colors not updating consistently as tasks complete. Sometimes works, sometimes doesn't, sometimes batch updates everything at the end.

**Root Cause:**
Multiple issues in the diagram update pipeline:

1. **No dedicated color/style update mechanism** - only content patching via `patch_diagram`
2. **Patch metadata lost in broadcast** - `api.ts:309-316` discards patch info, only sends full content
3. **No update batching** - each WebSocket message triggers immediate store update and re-render
4. **Async rendering races** - `mermaid.render()` in DiagramEmbed is async and can overlap with new updates
5. **No message ordering** - WebSocket messages processed immediately as they arrive

Key files:
- `src/routes/api.ts:309-316` - broadcast discards patch info
- `ui/src/App.tsx:209-219` - immediate message processing
- `ui/src/components/ai-ui/mermaid/DiagramEmbed.tsx:108-138` - async render

**Approach:**
Options:
1. **Add update batching** - Queue diagram updates and apply atomically after debounce
2. **Preserve patch metadata** - Include patch info in WebSocket broadcast for incremental DOM updates
3. **Synchronize renders** - Cancel pending renders when new content arrives

Recommend option 1 (batching) as simplest fix.

**Success Criteria:**
- Task completion colors update within 500ms
- Multiple rapid completions render correctly
- No visual flickering or out-of-order rendering

**Decisions:**

---

### Item 3: Recreate README completely
**Type:** task
**Status:** documented
**Problem/Goal:**
Major changes have occurred to the project. Documentation is outdated and needs complete rewrite.

**Approach:**
1. Audit current codebase - list all skills, agents, MCP tools, API endpoints
2. Determine new structure and focus
3. Write README from scratch based on current state
4. Include: Quick start, core concepts, tools reference, architecture

**Success Criteria:**
- README accurately reflects current project state
- Clear getting started instructions
- All MCP tools documented
- No references to outdated features

**Decisions:**

---

### Item 4a: Collab Codex - MCP Server Core
**Type:** code
**Status:** documented
**Problem/Goal:**
Build core MCP server with endpoints for querying and flagging topics.

**Approach:**
Implement 3 MCP endpoints:
1. `query_topic(name)` - Returns 4 docs (conceptual, technical, files, related) + metadata
2. `flag_topic(name, comment)` - Mark topic for review, creates flag record
3. `list_topics()` - All topics with metadata (name, confidence, dates)

Response format per spec. Log accesses for analytics.

**Success Criteria:**
- `query_topic` returns 4 documents + confidence/dates/access count
- `flag_topic` creates flag record with "open" status
- `list_topics` returns all topics with basic metadata
- Missing topic requests logged automatically

**Decisions:**

---

### Item 4b: Collab Codex - SQLite Storage Layer
**Type:** code
**Status:** documented
**Problem/Goal:**
Implement SQLite storage for metadata, access tracking, and flag management.

**Approach:**
Create SQLite schema with tables:
- `topics` - Registry with confidence tier, dates
- `access_log` - Per-access logging
- `access_counts` - Aggregated counts (total, last 30 days)
- `missing_topics` - Requests for non-existent topics
- `flags` - Review flags with lifecycle (open→addressed→resolved/dismissed)
- `generation_context` - Draft generation metadata

Implement confidence derivation logic from spec.

**Success Criteria:**
- Schema created per spec
- CRUD operations for topics, flags, access logs
- Confidence tier auto-calculated
- Access counts aggregated correctly

**Decisions:**

---

### Item 4c: Collab Codex - GUI Layout + Dashboard
**Type:** code
**Status:** documented
**Problem/Goal:**
Build React layout components and dashboard view.

**Approach:**
Components:
- Layout.tsx, Sidebar.tsx, Header.tsx
- Dashboard.tsx with sections: pending drafts, open flags, stale topics, missing requests, quick stats
- StatCard.tsx, PendingDraftsList.tsx, OpenFlagsList.tsx, StaleTopicsList.tsx
- Common: RefreshButton.tsx, StatusBadge.tsx, ConfidenceBadge.tsx

**Success Criteria:**
- Sidebar navigation to all views
- Dashboard shows counts and lists for all attention items
- Click-through to relevant detail views
- Manual refresh button works

**Decisions:**

---

### Item 4d: Collab Codex - GUI Topic Browser + Detail
**Type:** code
**Status:** documented
**Problem/Goal:**
Build topic browsing and detail viewing components.

**Approach:**
Components:
- TopicBrowser.tsx - List with filtering (confidence, flags, drafts, stale) and sorting
- TopicRow.tsx - Single row with badges
- TopicDetail.tsx - Full view with document tabs
- DocumentTabs.tsx, DocumentViewer.tsx - Rendered markdown per document type

Features:
- Filter by confidence tier, has flags, has draft, stale
- Sort by name, confidence, last verified, access count
- Document tabs: Conceptual | Technical | Files | Related
- Verify button (quick verify)

**Success Criteria:**
- Topic list with all filter/sort options
- Click row → Topic Detail view
- All 4 document tabs render markdown correctly
- Verify button updates last_verified_at

**Decisions:**

---

### Item 4e: Collab Codex - GUI Topic Editor + Draft Review
**Type:** code
**Status:** documented
**Problem/Goal:**
Build topic editing and draft approval components.

**Approach:**
Components:
- TopicEditor.tsx - CodeMirror editors for each document type
- DraftReviewPanel.tsx - Banner, toggle current/draft/diff
- DraftDiffViewer.tsx - Side-by-side diff with highlighting
- MarkdownRenderer.tsx, CodeMirrorEditor.tsx

Features:
- Tab bar: Conceptual | Technical | Files | Related (each with CodeMirror)
- "Edited by" name field for audit trail
- Save vs Save & Verify buttons
- Draft: View Current | View Draft | View Diff toggle
- Approve Draft / Reject Draft actions

**Success Criteria:**
- Create new topics with all 4 documents
- Edit existing topics with CodeMirror
- View diff between current and draft
- Approve promotes draft to current
- Reject deletes draft

**Decisions:**

---

### Item 4f: Collab Codex - GUI Flags + Missing Topics
**Type:** code
**Status:** documented
**Problem/Goal:**
Build flag management and missing topic request views.

**Approach:**
Components:
- FlagsView.tsx - All flags with tabs (All/Open/Addressed/Resolved/Dismissed)
- FlagsList.tsx, FlagRow.tsx, FlagActions.tsx
- MissingTopicsView.tsx, MissingTopicRow.tsx
- ConfirmDialog.tsx, NameInput.tsx

Features:
- Flag actions: Resolve, Dismiss (with reason), Reopen
- Filter by status, date range, topic
- Missing topics: request count, dates, Create/Dismiss actions
- Create auto-fills topic name in editor

**Success Criteria:**
- View all flags filtered by status
- Resolve/dismiss/reopen flags with audit trail
- View missing topic requests sorted by count
- Create missing topic → editor with pre-filled name
- Dismiss removes from list

**Decisions:**

---

### Item 5: Terminal tmux clipboard feature
**Type:** code
**Status:** documented
**Problem/Goal:**
A way to run the tmux session in the tab terminal in a separate terminal. Copy a command to clipboard that user can paste in external terminal.

**Approach:**
1. Add copy button to TerminalTabBar (next to close button on each tab)
2. Command to copy: `tmux attach -t {tab.tmuxSession}`
3. Follow existing clipboard pattern from CodeBlock.tsx:
   - Use `navigator.clipboard.writeText()`
   - Show "Copied!" feedback for 2 seconds
   - Copy icon → checkmark icon transition

Key data:
- `tab.tmuxSession` - tmux session name (e.g., "mc-openboldmeadow-a1b2")
- Already available in TerminalTabBar component

Alternative: Add right-click context menu with "Copy attach command" option.

**Success Criteria:**
- Copy button visible on terminal tabs
- Clicking copies `tmux attach -t {session}` to clipboard
- Visual feedback confirms copy succeeded
- Command works when pasted in external terminal

**Decisions:**

---

## Rough-Draft Artifacts

### Interface Documents
- `interface-item-1.md` - Skill file updates (text changes)
- `interface-item-2.md` - useDiagramUpdateQueue hook
- `interface-item-3.md` - README structure
- `interface-item-4a.md` - MCP Server Core types and endpoints
- `interface-item-4b.md` - SQLite Storage Layer services
- `interface-item-4c.md` - GUI Layout + Dashboard components
- `interface-item-4d.md` - GUI Topic Browser + Detail components
- `interface-item-4e.md` - GUI Topic Editor + Draft Review components
- `interface-item-4f.md` - GUI Flags + Missing Topics components
- `interface-item-5.md` - Terminal copy button

### Pseudocode Documents
- `pseudocode-item-1.md` through `pseudocode-item-5.md` (including 4a-4f)

### Skeleton Documents
- `skeleton-item-1.md` - Task graph for 7 skill file modifications
- `skeleton-item-2.md` - useDiagramUpdateQueue + App.tsx integration
- `skeleton-item-3.md` - README audit and rewrite
- `skeleton-item-4a.md` - MCP Server Core task graph
- `skeleton-item-4b.md` - SQLite Storage Layer task graph
- `skeleton-item-4c.md` - GUI Layout + Dashboard task graph
- `skeleton-item-4d.md` - GUI Topic Browser + Detail task graph
- `skeleton-item-4e.md` - GUI Topic Editor + Draft Review task graph
- `skeleton-item-4f.md` - GUI Flags + Missing Topics task graph
- `skeleton-item-5.md` - Terminal copy button task graph

**Status:** All skeleton documents complete. Ready for implementation.

---

## Diagrams
(auto-synced)
