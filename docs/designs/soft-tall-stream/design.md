# Session: soft-tall-stream

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Move status display from bottom to top bar - inline with connected badge, progress bar on right
**Type:** code
**Status:** documented

**Problem/Goal:**
Move SessionStatusPanel from Sidebar bottom to Header, positioned right after Connection Badge. All elements should be inline (horizontal) with progress bar on the right.

**Approach:**
1. Modify SessionStatusPanel to accept `variant?: 'default' | 'inline'` prop
2. When `variant="inline"`: render as horizontal flex row with fixed-width progress bar (~80px)
3. Import and render in Header.tsx after Connection Badge with `variant="inline"`
4. Remove SessionStatusPanel import and usage from Sidebar.tsx

**Inline Layout:** `[Phase Badge] [Timestamp] [Item N] [▓▓▓░░ 3/5]`

**Success Criteria:**
- Status displays inline in header after connection badge
- Progress bar is horizontal with fixed width (~80px) and count label
- No status panel in sidebar
- Works in both light and dark mode

**Decisions:**
- Position: Right after Connection Badge
- Progress style: Thin horizontal bar with count
- Sidebar: Remove status completely

---

---

## Diagrams
(auto-synced)