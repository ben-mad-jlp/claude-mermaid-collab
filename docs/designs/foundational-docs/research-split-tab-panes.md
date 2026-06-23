# Research: Left/Right Split Tab Pane Layout with Drag-and-Drop

## UX Refinement: Drop Zone Model (Agreed Design)

**Model:** The editor area is a single visual region. While dragging a tab, the region splits conceptually into a **left half** and a **right half**. Whichever half the cursor is over highlights (blue tint + thick border). Drop on that half → the tab is routed to that pane.

**Behavior matrix:**

| Start state | Drag tab, drop on LEFT half | Drag tab, drop on RIGHT half |
|---|---|---|
| One pane only (single editor) | Tab stays/routes to the existing pane | **Creates a new right pane** with this tab; existing pane becomes "left" |
| Two panes already | Tab moves to left pane, becomes active there | Tab moves to right pane, becomes active there |
| Drag last tab OUT of a pane | Opposite pane absorbs it; empty pane closes and split collapses to single-pane | Same |

**Why halves (not edge strips):**
- Forgiving — user doesn't have to aim at a narrow edge
- Visually unambiguous — the highlight snaps to a 50/50 column so it's obvious where the tab will land
- Matches VS Code / Zed / JetBrains split behavior

**Implementation notes:**
- Two invisible `useDroppable` zones layered over the editor region, each covering 50% width. Highlight when `isOver === true`.
- Drag overlay shows a floating preview of the tab during drag.
- No split indicator on hover unless a drag is active — idle state stays clean.
- When second pane is created, the splitter defaults to 50/50 (respects existing `SplitPane` `autoSaveId`).
- When a pane is emptied by drag, animate collapse back to single-pane (could be phase-2 polish; v1 can just snap).

**What this replaces from the original plan:**
- Section 3 "TabBar pane DnD" — drop targets are the **editor area halves**, not the tab bar. The tab bar still handles intra-pane reordering, but cross-pane moves happen via editor-area drop.
- Section 5 empty-pane placeholder — still shown, but a single-pane user never sees it unless they explicitly split.

**Updated effort estimate:** No change to overall M verdict. Drop-zone layering adds ~1–2 hrs to Step 2 but simplifies Step 5 (no "drag to empty tab bar" edge case).

---

## Executive Summary

**Difficulty Verdict: MEDIUM (3-4 day effort, achievable with good isolation from session routing)**

Adding a split-pane editor layout with tab mobility across panes is moderately scoped. The main complexity stems from (1) refactoring a single `activeTabId` into dual panes with separate active tabs, and (2) wiring cross-list drag-and-drop. However, `@dnd-kit` already supports multi-list DnD, and `SplitPane` is ready to host two editors. The session store is the bottleneck: today it assumes one tab list per session, so migrating to `panes: { left, right }` will touch `persist`, `promoteToPermanent`, `pinTab`, and `reorderTabs`.

**MVP Breakdown (5 steps):**
1. Migrate `tabsStore` from `tabs[]` + `activeTabId` to `panes: { left: { tabs, activeTabId }, right: { tabs, activeTabId } }` + `activePane` (persist required)
2. Refactor `TabBar` to render two sortable tab lists with cross-pane drop zones using `@dnd-kit/core` + `useDroppable`
3. Update `App.tsx` to route both pane `activeTabId`s through `sessionStore` selection logic, with "active pane" awareness for keyboard shortcuts
4. Wrap two `<UnifiedEditor>` instances in `SplitPane` (horizontal)
5. Design empty-pane placeholder state (collapse vs close)

---

## 1. Store Shape Analysis

### Current State

**`tabsStore.ts` (`SessionTabsState`):**
```typescript
export interface SessionTabsState {
  tabs: TabDescriptor[];        // Single flat list
  activeTabId: string | null;   // One active tab per session
}

export type TabsMap = Record<string, SessionTabsState>;  // key: "project::name"
```

**Persistence:** Zustand `persist` middleware stores to `collab.tabs.v1` key in localStorage.

**Operations:**
- `openPreview(tab)`: Appends or replaces preview tab, sets active
- `openPermanent(tab)`: Appends or promotes existing, sets active
- `promoteToPermanent(id)`: Changes `isPreview` flag
- `pinTab(id) / unpinTab(id)`: Toggles `isPinned` flag
- `closeTab(id)`: Removes and advances active if needed
- `reorderTabs(ids)`: Reorders matched tabs, updates `order` field
- `setActive(id)`: Sets `activeTabId`

### Proposed Multi-Pane Shape

**Option A: Explicit Panes Object (Recommended)**
```typescript
export interface PaneState {
  tabs: TabDescriptor[];
  activeTabId: string | null;
}

export interface SessionTabsState {
  panes: {
    left: PaneState;
    right: PaneState;
  };
  activePaneId: 'left' | 'right';  // Which pane receives keyboard actions
}
```

**Option B: Tab Groups with Metadata**
```typescript
export interface TabGroup {
  id: 'left' | 'right';
  tabs: TabDescriptor[];
  activeTabId: string | null;
}

export interface SessionTabsState {
  groups: TabGroup[];
  activePaneId: 'left' | 'right';
}
```

**Recommendation: Option A**
- Simpler indexing (`state.panes.left.activeTabId` vs `state.groups.find(g => g.id === 'left')`)
- Avoids array iteration for common pane access
- Migration path: reshape on load if old version detected

### Breaking Changes

**Which operations need refactoring:**
1. `openPreview(tab, pane?: 'left' | 'right')` — add optional pane param, default to active pane
2. `openPermanent(tab, pane?: 'left' | 'right')` — same
3. `promoteToPermanent(id, pane?: 'left' | 'right')` — find tab in specified pane
4. `pinTab(id, pane?: 'left' | 'right')` — scoped to pane
5. `closeTab(id, pane?: 'left' | 'right')` — scoped to pane, may shift active pane if pane becomes empty
6. `reorderTabs(ids, pane?: 'left' | 'right')` — only reorder within specified pane
7. `setActive(id, pane?: 'left' | 'right')` — scoped to pane, also set `activePaneId`
8. **New:** `moveTabBetweenPanes(tabId, fromPane, toPane)` — cross-pane drag-and-drop
9. **New:** `setActivePaneId(pane)` — track which pane has focus (keyboard dispatch)

**Persist migration:**
- Add version check: if `bySession[key].tabs` exists (old format), migrate to `panes.left` on init
- Use `version: 2` in persist config to force migration

### Estimated Store Effort
- File edits: ~150 lines in `tabsStore.ts`
- New functions: ~3-4 small helpers for pane access
- Testing: ~20 test cases (both panes, cross-pane move, empty pane)
- Persist migration: ~10 lines (optional fallback for old sessions)

---

## 2. Active Tab / Editor Routing

### Current Architecture (Single Pane)

**Flow:**
1. User clicks tab → `TabBar.activateTab(tab)` calls `useTabsStore.setActive(tab.id)`
2. `setActive` updates `activeTabId` in session
3. `TabBar.activateTab` also calls data loader (`selectDiagramWithContent`, etc.)
4. Data loader updates `sessionStore` (`selectDiagram(id)`, etc.)
5. `App.tsx` reads `sessionStore.selectedDiagramId` → derives `selectedItem` via `useMemo`
6. `selectedItem` → fed to `UnifiedEditor` or `DocumentView`

**Key insight:** Tab store and session store are decoupled; tab store holds UI state (which tab is open/active), session store holds data selection (which artifact is displayed).

### Required Changes for Dual Panes

**New routing:** Two parallel flows for left + right panes:
- Left pane: click tab → `setActive(tabId, 'left')` → update `sessionStore` based on left pane's active tab
- Right pane: click tab → `setActive(tabId, 'right')` → update `sessionStore` based on right pane's active tab
- **Problem:** `sessionStore` has only one `selectedDiagramId`, `selectedDocumentId`, etc. per session

**Solution: Add "pane-aware" selection in `sessionStore`**

Option 1: Add dual selection state
```typescript
export interface SessionStore {
  selectedDiagramId: string | null;
  selectedDocumentId: string | null;
  panesSelection?: {
    left: { selectedDiagramId: string | null; };
    right: { selectedDiagramId: string | null; };
  };
  activePaneId?: 'left' | 'right';
}
```

Option 2: Simpler — store `activeTabId` in both stores, query tab in `tabsStore` to get artifact details
```typescript
const leftTab = useTabsStore(s => s.panes.left.tabs.find(t => t.id === s.panes.left.activeTabId));
const rightTab = useTabsStore(s => s.panes.right.tabs.find(t => t.id === s.panes.right.activeTabId));
```

**Recommendation: Option 2 + lightweight pane tracking in `sessionStore`**

---

## 3. Drag-and-Drop Across Panes

**@dnd-kit natively supports cross-list reordering.** Use a single `DndContext` at app root with drop zones layered over each editor-area half (per UX Refinement above), plus the tab bars themselves for intra-pane reorder.

```typescript
<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  <EditorAreaDropZones>
    <SplitPane ...>
      <TabBarPane pane="left" /> <UnifiedEditor .../>
      <TabBarPane pane="right" /> <UnifiedEditor .../>
    </SplitPane>
  </EditorAreaDropZones>
</DndContext>
```

`handleDragEnd` inspects `over.data.paneId` (from the droppable half) and routes the tab accordingly via `moveTabBetweenPanes(tabId, fromPane, toPane)`. If the target pane doesn't exist yet (single-pane state), the store creates it and flips to split layout.

### Gotchas
- Dragging "floats" above both lists — use `@dnd-kit` DragOverlay with `z-50 shadow-lg`.
- Dropping on empty pane: mark empty pane as droppable target with min-height.
- Active tab moved → `moveTabBetweenPanes()` calls `setActivePaneId(toPane)`.
- Tab list filtered (pinned vs non-pinned) breaks drag indices → store drag source index at drag start.

---

## 4. Layout & Editor Hosting

`SplitPane` is reusable as-is (built on `react-resizable-panels`, already persists via `autoSaveId`). Wrap two editor columns in a horizontal split, each with its own `TabBar pane="left|right"` + `UnifiedEditor item={leftSelectedItem | rightSelectedItem}`.

### Empty Pane State

Options: (1) placeholder "No tab open — drag here or open from sidebar", (2) collapse to single pane, (3) always show both.

**Recommendation: Option 1 for MVP.** A single-pane user never triggers this unless they explicitly drag to the right half.

---

## 5. Scope Creep: What's NOT in MVP

| Feature | Why Not |
|---------|---------|
| Resizable splitter persistence | Already handled by `react-resizable-panels` ✓ |
| Collapse/expand one pane | Adds complexity; defer |
| 3+ panes (grid layout) | ~2–3 extra days |
| Vertical split option | Nice-to-have; ~0.5 day |
| Swap panes | ~1 day |
| Maximize/focus one pane | ~0.5 day |
| Per-pane undo/redo stacks | ~2 days |
| Tab grouping within pane | Defer |

---

## 6. Effort Breakdown (MVP)

| Step | Scope | Time |
|---|---|---|
| 1 | Migrate `tabsStore` to dual panes (persist migration included) | 4–6 h |
| 2 | Refactor `TabBar` + editor-area drop zones; cross-pane DnD | 5–7 h |
| 3 | Update `App.tsx` routing (dual `selectedItem`, keyboard dispatch) | 4–6 h |
| 4 | Host in `SplitPane`, empty-pane placeholder | 2–3 h |
| 5 | Empty state UX, focus ring, accessibility | 2–3 h |

**Total: 17–25 h (~2.5–3 days). T-shirt: MEDIUM.**

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Persist migration breaks old sessions | Version bump + fallback to single pane |
| DnD cross-pane sensor issues | Proven `@dnd-kit`; test on touch |
| Tab routing confusion | Visual focus ring + active pane indicator |
| Perf: two editors + DnD | Memoize filters, debounce reorder |
| Auto-save conflicts | Separate timers per pane |
| Keyboard ambiguity | Explicit "active pane" indicator |

---

## 8. Integration Checklist

- [ ] Store refactor + tests pass
- [ ] TabBar refactored; editor-area drop zones wired
- [ ] App.tsx routing updated; dual editors render
- [ ] SplitPane hosting; placeholder displays
- [ ] Keyboard dispatch routed to active pane
- [ ] Persist migration tested
- [ ] Accessibility audit
- [ ] Mobile fallback (single pane only)
- [ ] E2E: open two tabs, drag to split, move across, close, collapse
- [ ] Perf profiling (no jank on DnD)

---

## Appendix: `moveTabBetweenPanes` Sketch

```typescript
moveTabBetweenPanes: (tabId, fromPane, toPane, position?) => {
  const key = currentKey();
  if (!key || fromPane === toPane) return;

  set((state) => {
    const entry = getEntry(state.bySession, key);
    const tab = entry.panes[fromPane].tabs.find(t => t.id === tabId);
    if (!tab) return state;

    const fromTabs = entry.panes[fromPane].tabs
      .filter(t => t.id !== tabId)
      .map((t, i) => ({ ...t, order: i }));
    const toTabs = [...entry.panes[toPane].tabs, tab]
      .map((t, i) => ({ ...t, order: i }));

    const fromActive = entry.panes[fromPane].activeTabId === tabId
      ? (fromTabs[0]?.id ?? null)
      : entry.panes[fromPane].activeTabId;

    return {
      bySession: {
        ...state.bySession,
        [key]: {
          ...entry,
          panes: {
            ...entry.panes,
            [fromPane]: { tabs: fromTabs, activeTabId: fromActive },
            [toPane]:   { tabs: toTabs, activeTabId: tabId },
          },
          activePaneId: toPane,
        },
      },
    };
  });
},
```
