# Session: tall-bold-harbor

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Fix session initial phase - created with brainstorming instead of gather-goals
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
Session state is initialized with `phase: 'brainstorming'` but the workflow's first phase is `'gather-goals'`.

**Approach:**
Update initial phase value in all locations from `'brainstorming'` to `'gather-goals'`.

**Root Cause:**
Session state is set to `phase: 'brainstorming'` in multiple locations, but the state machine workflow is:
`collab-start -> gather-goals -> clear-pre-item -> work-item-router -> ...`

**Files to fix:**
1. `src/services/session-registry.ts` (lines 121-126)
2. `src/services/collab-manager.ts` (lines 268-273)
3. `skills/collab/SKILL.md` (line 40)
4. `src/mcp/tools/collab-state.ts` (line 105 - fallback)

**Additional:** The `CollabPhase` type in collab-manager.ts doesn't include `'gather-goals'` - needs updating.

**Success Criteria:**
- New sessions have `phase: 'gather-goals'` in collab-state.json
- Existing sessions continue to work
- All tests pass

**Decisions:**

---

### Item 2: Remove auto-creation of design.md - should only be created after gather-session-goals
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
`design.md` is auto-created when a session is registered, but it should only be created by `gather-session-goals` after work items are collected.

**Approach:**
Remove design.md auto-creation from `SessionRegistry.register()`.

**Root Cause:**
`src/services/session-registry.ts` lines 128-130 create design.md with a template during session registration. The template even contains "*To be filled by gather-session-goals*" acknowledging this is wrong.

**Files to fix:**
1. `src/services/session-registry.ts` - Remove lines 128-130 (design.md creation)
2. `src/services/session-registry.ts` - Remove lines 19-34 (INITIAL_DESIGN_TEMPLATE constant, now unused)

**Success Criteria:**
- New sessions do NOT have design.md after creation
- design.md exists only after gather-session-goals completes
- All tests pass (check for tests expecting design.md after registration)

**Decisions:**

---

### Item 3: Remove timeout parameter from render_ui MCP tool
**Type:** code
**Status:** documented

**Problem/Goal:**
Remove the `timeout` parameter from the `render_ui` MCP tool so that blocking UI calls wait forever until user responds.

**Approach:**
Remove timeout from all layers:
1. `src/mcp/tools/render-ui.ts` - Remove from schema (lines 335-338), remove `validateTimeout` fn, update `renderUI` signature
2. `src/mcp/setup.ts` - Remove from args extraction (line 1020) and body (line 1026)
3. `src/routes/api.ts` - Remove from request parsing (line 926) and uiManager call (line 963)
4. `src/services/ui-manager.ts` - Remove from PendingUI interface, remove setTimeout logic
5. Test files - Update tests referencing timeout

**Success Criteria:**
- `render_ui` no longer accepts a timeout parameter
- Blocking calls wait indefinitely for user response
- Tests updated to reflect new behavior

**Decisions:**
- Wait forever (no timeout) when blocking=true

---

## Diagrams
(auto-synced)
