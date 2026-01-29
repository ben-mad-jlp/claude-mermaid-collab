# Pseudocode: Item 1 - Move Status to Header

## SessionStatusPanel Component

### SessionStatusPanel(props: SessionStatusPanelProps)

```
1. Destructure props
   - Extract variant (default: 'default')
   - Extract className (optional)

2. Get collab state from store
   - const collabState = useSessionStore(state => state.collabState)

3. Early return if no state
   - If !collabState: return null

4. Extract display values from collabState
   - state, displayName, currentItem
   - lastActivity, completedTasks, pendingTasks
   - totalItems, documentedItems

5. Calculate progress
   - progressItems = totalItems > 0 ? documentedItems : (completedTasks?.length || 0)
   - progressTotal = totalItems > 0 ? totalItems : ((completedTasks?.length || 0) + (pendingTasks?.length || 0))
   - progressPercent = progressTotal > 0 ? Math.round((progressItems / progressTotal) * 100) : 0

6. Branch on variant
   - If variant === 'inline':
     - Return inline layout (Step 7)
   - Else:
     - Return default stacked layout (existing code)

7. Render inline layout
   - Container: flex items-center gap-2 text-xs
   - Elements in order:
     a. Phase badge (displayName || state)
     b. Timestamp (relative time from lastActivity)
     c. Current item indicator if currentItem exists: "Item {currentItem}"
     d. Progress bar container:
        - Fixed width (~80px / w-20)
        - Background track
        - Filled progress bar (width = progressPercent%)
        - Count label: "{progressItems}/{progressTotal}"
```

**Error Handling:**
- Missing collabState: Graceful return null (component doesn't render)
- Missing lastActivity: Don't render timestamp element
- Zero total progress: Show "0/0" and 0% filled bar

**Edge Cases:**
- No current item: Omit "Item N" from inline display
- Session just started (no tasks): Show empty progress (0/0)
- Dark mode: Use dark: prefixed tailwind classes for colors

---

## Header.tsx Changes

### Header Component (existing)

```
1. Existing imports stay unchanged

2. Add new import
   - import { SessionStatusPanel } from '@/components/SessionStatusPanel'

3. Find Connection Badge location (around line 278)
   - Look for: isConnected / WifiOff / badge rendering

4. After Connection Badge, before other header items:
   - Add: <SessionStatusPanel variant="inline" />
```

**Error Handling:**
- SessionStatusPanel handles its own null state
- No additional error handling needed in Header

**Edge Cases:**
- SessionStatusPanel returns null when no session: Header layout unaffected

---

## Sidebar.tsx Changes

### Sidebar Component (existing)

```
1. Remove import
   - Delete: import { SessionStatusPanel } from '@/components/SessionStatusPanel'

2. Find SessionStatusPanel JSX (around lines 172-175)
   - Look for: <SessionStatusPanel /> or wrapper div with opacity-50

3. Remove entire block
   - Delete the div wrapper and SessionStatusPanel
```

**Error Handling:**
- N/A - just removal

**Edge Cases:**
- Ensure no broken references remain after removal
