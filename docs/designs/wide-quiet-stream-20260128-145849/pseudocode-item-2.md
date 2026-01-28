# Pseudocode: Item 2 - Mobile Layout Shell

## useIsMobile()

```
1. Initialize state: isMobile = false

2. On mount:
   a. Create mediaQuery = window.matchMedia('(max-width: 639px)')
   b. Set isMobile = mediaQuery.matches
   c. Add change listener to mediaQuery
      - On change: set isMobile = event.matches

3. On unmount:
   a. Remove change listener from mediaQuery

4. Return isMobile
```

**Error Handling:**
- SSR safety: Check `typeof window !== 'undefined'` before accessing matchMedia
- If matchMedia unavailable: default to false (desktop)

**Edge Cases:**
- Initial render before hydration: may flash briefly if mismatch
- Rapid resize crossing breakpoint: debounce not needed (matchMedia handles it)

---

## MobileLayout

```
1. Initialize state: activeTab = 'preview'

2. Define setActiveTab callback:
   - Update activeTab state

3. Get session data from sessionStore:
   - diagrams, documents, selectedDiagramId, selectedDocumentId, currentSession

4. Build items array:
   - Combine diagrams and documents
   - Sort by lastModified descending

5. Find selectedItem:
   - If selectedDiagramId: find in diagrams
   - Else if selectedDocumentId: find in documents
   - Else: null

6. Render layout:
   a. MobileHeader (receives session props from parent)
   b. Tab content container (flex-1):
      - Render ALL tabs but hide inactive with display:none
      - PreviewTab: visible when activeTab === 'preview'
      - ChatTab: visible when activeTab === 'chat'
      - TerminalTab: visible when activeTab === 'terminal'
   c. BottomTabBar (receives activeTab, onTabChange)

7. Pass setActiveTab to ChatTab for AI UI auto-switch
```

**Error Handling:**
- If sessionStore data is empty: tabs still render (empty state handled by each tab)

**Edge Cases:**
- No session selected: all tabs show empty/placeholder state
- Tab switch while loading: content preserved (no unmount)

**Dependencies:**
- useSessionStore (Zustand)
- useDataLoader hook

---

## MobileHeader

```
1. Receive props: sessions, registeredProjects, callbacks, connection state

2. Initialize dropdown states:
   - projectDropdownOpen = false
   - sessionDropdownOpen = false

3. Get theme state from useTheme()

4. Render single row:
   a. Left: Small logo (link to root)
   b. Project dropdown (compact):
      - Button showing current project name (truncated)
      - Dropdown menu: project list + "Add Project"
   c. Session dropdown (compact):
      - Button showing current session name (truncated)
      - Dropdown menu: session list + "Create New"
   d. Refresh icon button → onRefreshSessions
   e. Theme toggle icon → toggleTheme
   f. Connection status dot:
      - Green if isConnected
      - Yellow if isConnecting
      - Red otherwise

5. Close dropdowns when clicking outside (useClickOutside pattern)
```

**Error Handling:**
- Empty sessions/projects: show "(none)" in dropdown button

**Edge Cases:**
- Long project/session names: truncate with ellipsis
- Offline: show red dot, disable refresh

---

## BottomTabBar

```
1. Receive props: activeTab, onTabChange

2. Define tabs config:
   - { id: 'preview', label: 'Preview', icon: EyeIcon }
   - { id: 'chat', label: 'Chat', icon: ChatIcon }
   - { id: 'terminal', label: 'Terminal', icon: TerminalIcon }

3. Render fixed bottom bar:
   a. For each tab:
      - Button with icon + label stacked vertically
      - Active tab: highlighted (accent color, bold)
      - Inactive: muted color
      - onClick: onTabChange(tab.id)

4. Add safe area padding (pb-safe for iOS home indicator)
```

**Error Handling:**
- None needed (pure presentational)

**Edge Cases:**
- Tab icon accessibility: include aria-label
- Touch target size: minimum 44x44px

---

## App.tsx Modifications

```
1. Import useIsMobile hook

2. In App component:
   a. Call: isMobile = useIsMobile()

3. In render:
   a. If isMobile:
      - Render MobileLayout with same props as desktop layout
   b. Else:
      - Render existing desktop layout (unchanged)

4. QuestionPanel and ToastContainer remain outside layout
   (rendered regardless of mobile/desktop)
```

**Error Handling:**
- None new (existing error boundary handles crashes)

**Edge Cases:**
- Hot reload crossing breakpoint: React will re-render with correct layout