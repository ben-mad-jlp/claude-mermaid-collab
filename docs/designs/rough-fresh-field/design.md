# Session: rough-fresh-field

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Fix browse items on mobile UI - no items in the list
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
Mobile UI browse section shows "No items in session" even when diagrams/documents exist.

**Root Cause:**
The `PreviewTab` component in `MobileLayout.tsx` (lines 137-140) has items hardcoded to an empty array:
```tsx
<PreviewTab
  selectedItem={null}
  items={[]}           // HARDCODED EMPTY ARRAY
  onItemSelect={() => {}}
/>
```

Desktop works because `Sidebar.tsx` uses `useSessionStore` hook directly to access diagrams/documents. Mobile doesn't follow this pattern.

**Proposed Fix:**
Update `PreviewTab.tsx` to use `useSessionStore` hook directly (matching Sidebar pattern):
1. Import and use `useSessionStore` in `PreviewTab`
2. Access `diagrams` and `documents` from the store
3. Compute combined items list internally

This avoids prop drilling and is consistent with how Sidebar works.

**Success Criteria:**
1. Open mobile UI (viewport < 640px)
2. Select a session with diagrams/documents
3. Browse items shows the items list
4. Items can be selected and previewed
5. Search/filter works

**Decisions:**

---

### Item 2: Fix new terminal button in mobile UI - doesn't work
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
New terminal button in mobile UI creates a terminal session via API but UI never shows the terminal.

**Root Cause:**
In `MobileLayout.tsx` (lines 166-170), `TerminalTab` props are hardcoded:
```tsx
<TerminalTab
  terminal={null}              // HARDCODED TO NULL
  hasSession={false}           // HARDCODED TO FALSE
  onCreateTerminal={handleCreateTerminal}
/>
```

The `handleCreateTerminal` function works correctly - it calls `api.createTerminalSession()` and stores the result in `terminalId` state. But `terminalId` is never used to update the `terminal` or `hasSession` props.

Same pattern as Item 1: handlers are connected but state isn't used to update UI.

**Proposed Fix:**
1. Store both `id` and `wsUrl` from API result
2. Pass to TerminalTab:
   - `terminal={{ sessionId: terminalId, wsUrl: terminalWsUrl }}`
   - `hasSession={terminalId !== null}`

Or refactor to use `useTerminalTabs` hook (which desktop uses correctly).

**Success Criteria:**
1. Click "New Terminal" in mobile UI
2. Terminal view shows active XTermTerminal (not "No active terminal")
3. User can interact with the terminal
4. Terminal persists when switching tabs

**Decisions:**

---

## Diagrams
(auto-synced)