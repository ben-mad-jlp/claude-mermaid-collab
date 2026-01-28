# Session: wide-quiet-stream

## Session Context
**Out of Scope:**
- No code editor on mobile (editing is desktop-only)
- Tablet-specific layouts (tablets get the desktop layout)
- Offline support or PWA features
- Push notifications
- Gestures beyond basic drawer dismiss
**Shared Decisions:**
- Mobile breakpoint: 640px (Tailwind `sm`) - phones only
- No code editor on mobile
- Tab-based navigation (not collapsible sidebar)
- AI UI / question cards render inline in Chat tab on mobile

---

## Work Items

### Item 1: Make the GUI work well on a phone
**Type:** code
**Status:** superseded (split into items 2, 3, 4)

---

### Item 2: Mobile layout shell
**Type:** code
**Status:** documented

**Problem/Goal:**
Create the mobile layout shell: App-level layout switching at `sm` breakpoint, bottom tab bar component, and simplified mobile header.

**Approach:**

**Detection:** Add a `useIsMobile()` hook using `window.matchMedia('(max-width: 639px)')` with a resize listener. In `App.tsx`, conditionally render `<MobileLayout>` or the existing desktop layout based on this hook.

**MobileLayout component** (`ui/src/components/layout/MobileLayout.tsx`):
- Receives the same props as the desktop layout (sessions, handlers, connection state)
- Renders: `MobileHeader` + active tab content + `BottomTabBar`
- Manages `activeTab` state: `'preview' | 'chat' | 'terminal'`
- Full viewport height with flex column layout

**MobileHeader** (`ui/src/components/layout/MobileHeader.tsx`):
- Single row, compact height
- Left: Logo (small)
- Center/right: Project dropdown, Session dropdown (compact), Refresh icon button, Theme toggle icon, Connected badge (dot)
- All dropdowns use existing logic from Header.tsx but with smaller triggers

**BottomTabBar** (`ui/src/components/layout/BottomTabBar.tsx`):
- Fixed to bottom, full width
- 3 icon+label tabs: Preview, Chat, Terminal
- Active tab highlighted
- Safe area padding for phones with home indicators (`pb-safe`)

**Success Criteria:**
- Below 640px, app renders mobile layout with bottom tabs and compact header
- Above 640px, existing desktop layout unchanged
- Switching between tabs preserves state (no remount)

**Decisions:**
- `useIsMobile()` hook with matchMedia (not CSS-only) so we can conditionally render different component trees
- Tab state lives in MobileLayout (not global store) since it's mobile-only

---

### Item 3: Preview tab with item drawer
**Type:** code
**Status:** documented

**Problem/Goal:**
Full-screen preview tab for mobile with a drawer/sheet to switch between diagrams and documents.

**Approach:**

**PreviewTab** (`ui/src/components/mobile/PreviewTab.tsx`):
- Full-screen container rendering `MermaidPreview` or `MarkdownPreview` based on selected item type
- Compact top bar showing: item name, item type icon, and a "browse" button to open the drawer
- If no item selected, shows a prompt to select one (opens drawer automatically)
- Reuses existing preview components with zoom/pan support

**ItemDrawer** (`ui/src/components/mobile/ItemDrawer.tsx`):
- Slide-up bottom sheet (covers ~60% of screen)
- Backdrop overlay that dismisses on tap
- Search input at the top to filter items
- Scrollable list of item cards (reuse `ItemCard` or simplified version)
- Items sorted by last modified (same as sidebar)
- Tapping an item selects it and closes the drawer
- Drag handle at top for gesture dismissal

**Success Criteria:**
- Can view any diagram or document full-screen with zoom/pan
- Can open drawer, search/browse items, and select one
- Drawer dismisses on item selection, backdrop tap, or drag-down

**Decisions:**
- Bottom sheet pattern (not full-screen modal) to keep context of current preview
- Reuse existing MermaidPreview and MarkdownPreview components
- Search input in drawer mirrors sidebar search

---

### Item 4: Chat and Terminal tabs
**Type:** code
**Status:** documented

**Problem/Goal:**
Full-screen Chat and Terminal tabs for mobile. Chat tab also hosts inline AI UI cards.

**Approach:**

**ChatTab** (`ui/src/components/mobile/ChatTab.tsx`):
- Wraps existing `ChatPanel` component in a full-screen container
- ChatPanel already renders messages and has input — reuse as-is
- AI UI cards (`QuestionPanel` content) render inline within the chat message flow instead of as an overlay
- On mobile, when a new AI UI card arrives, auto-switch to Chat tab (via callback to MobileLayout)

**TerminalTab** (`ui/src/components/mobile/TerminalTab.tsx`):
- Wraps existing terminal component in a full-screen container
- Terminal fills available height between header and tab bar
- xterm `addon-fit` handles resize automatically
- If no terminal session exists, show a "No active terminal" placeholder

**Shared behavior:**
- Both tabs fill `flex-1` space between MobileHeader and BottomTabBar
- Tab content stays mounted when switching tabs (hidden with `display: none`) to preserve state
- No additional scroll wrappers — each component manages its own scrolling

**Success Criteria:**
- Chat is usable full-screen with messages and AI UI cards inline
- Terminal is usable full-screen and resizes correctly
- Switching tabs doesn't lose chat history or terminal state

**Decisions:**
- Keep tabs mounted (hidden) rather than unmount/remount to preserve state
- AI UI cards inline in chat flow, not as overlay on mobile
- Auto-switch to Chat tab when AI UI arrives

---

## Diagrams
(auto-synced)