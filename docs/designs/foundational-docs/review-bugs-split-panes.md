# Split-Tab-Pane Bug Review (bp-split-tab-panes)

Scope: review-only. Severity scale: HIGH / MEDIUM / LOW.

## HIGH

### H1. moveTabBetweenPanes preserves isPreview, allowing duplicate previews per pane
- **File:Line**: `ui/src/stores/tabsStore.ts:388` (`const cloned: TabDescriptor = { ...movedTab };`)
- **Why**: The cloned tab retains `isPreview: true` when moved. The destination pane can already have a preview tab, violating the "single preview per pane" invariant that `openPreview` (lines 143-165) relies on by finding exactly one `previewIdx`. Once there are two previews, later `openPreview` calls on that pane only replace one of them; the other becomes a permanent-looking preview that can't be promoted by the replace path.
- **Fix**: Decide on one of: (a) always promote moved previews to permanent (`cloned.isPreview = false`), (b) if the target already has a preview, replace it with the moved tab, or (c) preserve preview but promote the existing one in the target pane.

### H2. moveTabBetweenPanes active-fallback picks first tab instead of neighbor
- **File:Line**: `ui/src/stores/tabsStore.ts:383-386`
- **Why**: When the moved tab was the source pane's active tab, fallback is `fromTabs[0]?.id`. Inconsistent with `closeTab` (line 303), which prefers `tabs[i+1] ?? tabs[i-1]`. Moving the active tab jumps focus to the first tab rather than the adjacent one; jarring UX and inconsistent with close.
- **Fix**: Mirror closeTab: compute index of removed tab before filter/renumber, pick `tabs[i+1]?.id ?? tabs[i-1]?.id ?? null`.

### H3. Right-to-left drain leaves activePaneId = 'right' with empty right pane
- **File:Line**: `ui/src/stores/tabsStore.ts:410-424`
- **Why**: The promotion branch only runs when `fromPane === 'left'`. If the user drags the last tab from right → left, `right.tabs` becomes empty but `activePaneId` stays `'right'`. Rendering collapses to single-pane (SplitTabBar/SplitEditorHost both gate on `right.tabs.length > 0`), but store state now has `activePaneId === 'right'` pointing to an empty pane. `setActivePaneId('left')` isn't invoked here, and the keyboard hook (`useTabKeyboard.ts:25-29`) reads `entry.panes[entry.activePaneId]` — now `{ tabs: [], activeTabId: null }`, so Ctrl+Tab / Ctrl+W become no-ops until the user clicks the left pane.
- **Fix**: Add a symmetric branch: if `toPane === 'left'` and `right.tabs.length === 0`, set `activePaneId = 'left'`. Or unconditionally collapse whenever either pane drains to 0.

## MEDIUM

### M1. SplitEditorHost's `primarySize` state desyncs from SplitPane's persisted size on reload
- **File:Line**: `ui/src/components/layout/editor/SplitEditorHost.tsx:191` (`useState<number>(50)`), passed to `SplitTabBar primarySizePercent={primarySize}`.
- **Why**: `SplitPane` reads `storageId="editor-split"` from localStorage and starts at (say) 70, but `primarySize` state here is hard-initialized to 50. Until the user drags, the SplitTabBar renders at 50/50 while the editor area renders at 70/30. `onSizeChange` fires during drag, not on mount.
- **Fix**: Either read the persisted size eagerly (lazy initializer that reads `localStorage.getItem('collab.splitpane.editor-split')` or whatever key SplitPane uses), or have SplitPane fire `onSizeChange` once on mount after reading storage.

### M2. Duplicate `onMouseDown → setActivePaneId` handlers on left/right pane
- **File:Line**: `ui/src/components/layout/tabs/SplitTabBar.tsx:45,54` AND `ui/src/components/layout/editor/SplitEditorHost.tsx:170,181`
- **Why**: Both the tab-bar wrapper and the editor-body wrapper register `onMouseDown → setActivePaneId(pane)`. Mousedown in the tab bar triggers the tab bar's handler only (events don't reach editor body); mousedown in the editor body triggers editor body only. So in practice they don't fire together — but they're redundant sources of truth. If future refactors nest them, both would fire. Also: clicking inside an iframe-hosted editor (embed, image, etc.) won't emit mousedown to the React tree at all, so focus ring won't update — a real gap.
- **Fix**: Consolidate in one place (SplitEditorHost is the better owner since it covers editor body); and add a `pointerdown` capture-phase listener, or listen on `focusin`/`focus`, to catch iframe/canvas interactions. Alternatively attach to the whole pane wrapper at the outer div.

### M3. `setActivePaneId` silently refuses to activate an empty pane → focus ring cannot move to empty right
- **File:Line**: `ui/src/stores/tabsStore.ts:440`
- **Why**: `if (entry.panes[pane].tabs.length === 0) return state;` — user clicking on EmptyPane cannot make it active. That's fine in single-pane mode, but in split mode after dragging the last right tab out, the right pane is empty AND rendering collapses; conversely, if a user somehow sees an EmptyPane on the right (shouldn't happen since we gate on `right.tabs.length > 0`), they can't click to activate. Not currently exploitable but brittle — couples focus semantics to "must have tabs".
- **Fix**: Allow activating empty panes; guard other code paths against `activeTabId: null`. (Or document this invariant.)

### M4. Potential orphaned v1 localStorage blob
- **File:Line**: `ui/src/stores/tabsStore.ts:456` (`name: 'collab.tabs.v2'`)
- **Why**: The `migrate` function only runs on data zustand finds under the persist key. If v1 used a different `name:` (e.g. `'collab.tabs'` or `'tabs-store'`), the migration never fires for existing users — they lose all tab state on upgrade despite the explicit migration code. The migration code assumes zustand reads the same key and just finds an old `version`.
- **Fix**: Verify v1's persist name. If it differed, read the old key in the migrate callback (or via a pre-hydrate step) and fold it in. If the name didn't change, then `name` should NOT include `.v2` (zustand already uses `version` for this); keeping a constant name + `version` bump is the standard pattern.

### M5. Asymmetric legacy-selection fallback: right pane never resolves legacy selection
- **File:Line**: `ui/src/App.tsx:1049-1056`
- **Why**: `leftItem` falls back to `resolveFromLegacySelection()` when the left tab doesn't resolve; `rightItem` does not. Any code path that sets `selectedDocumentId` etc. via `useSessionStore` (e.g. sidebar click, WebSocket selection sync) will only surface in the left pane. If the right pane is active and sidebar click writes to legacy selection without also calling `openPreview` with `pane: 'right'`, the right pane will not reflect the click.
- **Fix**: Either (a) when `activePaneId === 'right'` and rightTab is null, also fall back to legacy selection for rightItem, or (b) remove the legacy fallback entirely and require all selection to flow through the tab store.

## LOW

### L1. onContentChange drops edits in the inactive pane
- **File:Line**: `ui/src/App.tsx:1222-1226`
- **Why**: `handleContentChange` only calls `setLocalContent` when `pane === activePaneId && itemId === activeItem?.id`. Edits typed in the inactive pane are silently discarded by localContent (which is shared), and auto-save only runs for the active pane. The TODO comment acknowledges this.
- **Fix**: Per-pane localContent state, or keep localContent per itemId in a map keyed by item.id.

### L2. useEditorAutoPromote's `promoted` Set leaks across session switches
- **File:Line**: `ui/src/hooks/useEditorAutoPromote.ts:26`
- **Why**: The `promoted` Set lives for the lifetime of the effect (app lifetime, since empty deps). If the same tab id appears in a different session (unlikely) or after close+reopen, the Set still remembers the old id and never re-promotes. Low impact because tab ids are typically globally unique.
- **Fix**: Clear `promoted` on session change, or check the store for `isPreview` and skip only if already permanent.

### L3. reorderTabs refuses mixed pinned+unpinned selections silently
- **File:Line**: `ui/src/stores/tabsStore.ts:329-330`
- **Why**: If caller passes ids that span pinned+unpinned, function returns state unchanged. Caller has no feedback. Not a bug per se; just silent.
- **Fix**: Document or split into two actions.

### L4. EditorAreaDropZones' DropHalf `pointerEvents: 'none'` when not dragging
- **File:Line**: `ui/src/components/layout/editor/EditorAreaDropZones.tsx:26`
- **Why**: Dropzones are absolutely positioned over the editor area; `pointer-events: none` when not dragging means children still get events. OK. But the outer wrapper (line 46) also has `pointer-events-none`, and only the DropHalf can override with `auto`. Correct pattern — no bug. Noted for completeness.

### L5. TabBar key= uses tab.id but SortableTab re-mounts on pane switch
- **File:Line**: `ui/src/components/layout/tabs/TabBar.tsx:156,173`
- **Why**: `pane` is passed to `useSortable` via `data: { tab, pane }`; key is just `tab.id`. If the same tab id ever existed in both panes (post-move), React would reconcile wrongly. moveTabBetweenPanes does clone (not dedupe) but since the source is filtered out, ids stay unique. OK so long as H1/H2 fixes maintain uniqueness.

## Counts
- HIGH: 3
- MEDIUM: 5
- LOW: 5
- **Total: 13**

## Top priorities to fix before merge
1. H1 (duplicate preview via move) — invariant break
2. H3 (right-drain leaves activePaneId inconsistent) — blocks keyboard interaction
3. M1 (SplitPane storage desync) — visible visual bug on reload
4. H2 (active fallback picks first tab) — UX inconsistency with close
5. M4 (verify v1 persist key) — silent data loss on upgrade risk
