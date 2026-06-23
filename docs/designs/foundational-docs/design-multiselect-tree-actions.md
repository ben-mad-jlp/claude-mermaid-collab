# Design: Multi-Select + Right-Click Context Menu for Artifact Sidebar Tree

Scope: the Items sidebar tree in `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx`. The Code tab (`PseudoTreeBody`) is out of scope for v1 — different concern (pseudo files, navigation semantics). Mobile/touch out of scope.

## 1. Goals / Non-goals

### Goals
- Click selects a single row (existing behavior preserved).
- Ctrl/Cmd-click toggles individual rows into a multi-selection.
- Shift-click extends selection to a range anchored on the last singly-clicked row.
- Right-click opens a context menu with batch actions applicable to the current multi-selection (or just the clicked row when nothing is selected).
- Batch actions: Deprecate/Undeprecate, Delete, Pin/Unpin, Download (zipped, v2), Rename (single-only), Clear selection.
- Keep the single-selection "what's open in the editor" concept in `sessionStore` untouched and authoritative for viewer state.

### Non-goals
- Drag-and-drop of a multi-selection (defer to v2; the existing file-drop handler on the `<aside>` could conflict).
- Touch/long-press multi-select on mobile.
- Cross-session or cross-project selection.
- Pseudo/code tree multi-select (v2 can mirror the pattern).
- Persisting multi-selection across reloads (intentionally ephemeral).

## 2. Selection model

### Where it lives
A new slice in `ui/src/stores/sidebarTreeStore.ts` (not a new store — we already keep UI-only tree state here). **Not persisted**: excluded from the `partialize` whitelist so it never hits localStorage.

### Key format
```ts
type SelectionKey = `${NodeKind}:${string}`; // e.g. "artifact:abc123", "blueprint:def", "embed:xyz"
```
We cannot key by `id` alone because the tree mixes types and different types could (theoretically) collide on ids; also Pinned/Recent sections reference the same underlying artifact as its home section — keying by `NodeKind:id` lets us deduplicate clicks on the "same" item appearing in two sections. See the `Pinned`/`Recently Updated` branches in `ArtifactTree.tsx:176-212`.

### Store shape (additions)
```ts
interface SidebarTreeState {
  // ...existing...
  multiSelection: Set<SelectionKey>;       // current multi-select
  multiSelectAnchor: SelectionKey | null;  // last single-clicked row; range pivot for shift-click
  // actions
  setSelection: (keys: SelectionKey[]) => void;     // replace
  toggleInSelection: (key: SelectionKey) => void;   // ctrl/cmd-click
  extendSelectionTo: (key: SelectionKey, orderedKeys: SelectionKey[]) => void; // shift-click
  clearSelection: () => void;
  setAnchor: (key: SelectionKey | null) => void;
}
```

### Invariants
- `multiSelection.size === 0` means "no multi-select active"; the sessionStore single-selection drives viewer behavior as today.
- `multiSelection.size === 1` is still multi-select conceptually — keyboard Delete hits it, right-click shows batch menu. UX-wise it just looks like a highlighted row.
- When multi-selection is non-empty, the visual "active editor row" from `sessionStore` should still render its own style *in addition* to the multi-select highlight (composable; see §6).
- On session change (`currentSession` in `ArtifactTree.tsx:106`), clear selection and anchor — stale ids would leak.
- On artifact removal (delete completes), filter removed keys out of `multiSelection`.

### Coexistence with sessionStore
`sessionStore` single-selection (`selectedDiagramId`, etc., see `sessionStore.ts:54-58`) remains the source of truth for what the editor shows. Multi-selection in `sidebarTreeStore` is a separate UI concept and never assigns to the sessionStore. A plain click does both: sets single-selection (via existing `openNode`) AND collapses multi-selection to that one item.

## 3. Interaction spec

Event target: a row rendered by `ArtifactTreeNode` inside `ArtifactTree.renderSection` (`ArtifactTree.tsx:709-770`). "Selectable row" = any leaf that produces a `TreeNode` (artifact, blueprint, embed, image). Section branch rows (`SectionBranchRow`) are NOT selectable — they already toggle collapse. `task-graph` / `task-details` nodes are NOT selectable (they are pure navigation, no batch actions apply).

| Gesture | Current behavior | New behavior |
|---|---|---|
| Plain click on row | `openNode(node); openPreview(tabDescriptor)` | Same + `setSelection([key]); setAnchor(key)`. Collapses any prior multi-selection. |
| Double-click | `openNode + openPermanent` | Unchanged. If multi-select active, treat same as plain click (collapses then opens permanent). |
| Ctrl/Cmd-click | (nothing) | `toggleInSelection(key); setAnchor(key)`. Does NOT call `openNode` (viewer stays put — matches VS Code Explorer). `e.preventDefault()` to avoid native navigation on middle-mouse-ctrl. |
| Shift-click | (nothing) | `extendSelectionTo(key, orderedKeys)` — select inclusive range from anchor to clicked row based on visible render order. If no anchor, behave like plain click. Does NOT call `openNode`. |
| Right-click on row IN selection | `setContextMenu({node,...})` | If key is in `multiSelection`: open batch menu with all selected keys; don't mutate selection. |
| Right-click on row NOT in selection | `setContextMenu({node,...})` | Replace selection with just that key (`setSelection([key]); setAnchor(key)`), then open menu scoped to that single key. Mirrors Finder/VS Code. |
| Escape | closes menu (`SidebarNodeContextMenu.tsx:41`) | Also `clearSelection()` when no menu is open. |
| Delete / Backspace on focused row | (nothing) | If multi-selection non-empty, trigger Delete action (with the existing `ConfirmDialog`). |
| Arrow Up/Down | (nothing) | v2. Focus movement across visible rows. |

### Detecting modifiers
Use `e.metaKey || e.ctrlKey` for "toggle" (matches macOS Cmd and Windows/Linux Ctrl). Use `e.shiftKey` for range. If both are pressed, Shift wins (VS Code convention).

### Range semantics across sections
**Shift-click spans sections** using the full rendered order of currently-visible rows. Rationale:
- Users visually see one flat list after sectioning/collapse/search filters are applied. A range that stops at a section boundary is surprising when the user is trying to "grab everything from here down".
- Implementation: compute `orderedKeys` at click time from the same memoized section array that drives rendering (pins → recent → blueprints → embeds → images → diagrams → documents → designs → spreadsheets → snippets → archived-blueprints, honoring `filterNodes` and collapse state). Hidden rows (collapsed section, filtered out by search, or hidden because `showDeprecated` is false) are NOT in the range source.
- Dedup: if the anchor key and target key happen to reference the same artifact appearing in two sections (e.g., in Pinned *and* Diagrams), treat them as the same key and select once.

Trade-off vs. "same-section only": the latter is simpler but forces users to multi-click or re-anchor when selections naturally cross sections (e.g., clearing out old stuff from Recently Updated + Documents). The flat-list rule is the strictly more powerful superset; users who only want within-section ranges get that for free because sections render contiguously.

## 4. Context menu items

Menu items are produced by extending `getActionsForNode` (`ui/src/components/layout/sidebar-tree/getActionsForNode.ts`) to `getActionsForSelection(nodes: TreeNode[])` — returns actions valid for the intersection of types.

| Action | Applies | Backend | Confirm? | Notes |
|---|---|---|---|---|
| Pin / Unpin | both | `api.setPinned` (`api.ts:674`); fan-out N calls | no | When mixed (some pinned, some not): label "Pin All" and set all to pinned. Second invocation unpins all. |
| Rename | **single-only** | (no API yet — `getActionsForNode.ts:60` marks it disabled) | no | Hide from menu when `selection.size > 1`. |
| Duplicate | **single-only** | (no API yet, disabled) | no | Hide when multi. |
| Download | both (v1: single; v2: multi→zip) | `downloadArtifact` in `ui/src/lib/downloadArtifact.ts` (per-item) | no | v1: disable when multi. v2: client-side JSZip bundle. |
| Email | **single-only** | `emailArtifact` | no | Hide when multi (UX: "email 17 items" is rarely intended). |
| Deprecate / Undeprecate | both | `api.setDeprecated` (`api.ts:659`); fan-out. Blueprint special-case: also `api.clearTaskGraph` when deprecating (`ArtifactTree.tsx:652-658`). | **yes** when multi (single keeps current no-confirm) | Mixed state → label "Deprecate All" (targets not-yet-deprecated ones); second invocation "Undeprecate All". |
| Delete | both | Per-type: `deleteDiagram`/`deleteDocument`/`deleteDesign`/`deleteSpreadsheet`/`deleteSnippet`/`deleteImage`/embed DELETE endpoint (`ArtifactTree.tsx:588-631`) | **yes** always | Confirm dialog shows count: "Delete 5 items? This cannot be undone." |
| Open as Tabs | multi-only | `openPermanent` fanned out from `tabsStore` | no | New v2 action. Opens each selected artifact as a permanent tab. Could be expensive; cap at 20 with a warning. |
| Clear Selection | multi-only | (client-only: `clearSelection()`) | no | Always last, separator above. |

Single-only and inapplicable-mixed items should be **hidden** from the menu when multi (not disabled) to avoid a menu full of greyed-out entries. Disabled entries are reserved for "not yet supported" placeholders (existing convention in `getActionsForNode.ts:61-64`).

### Unsupported mixed-type combinations
`todo` rows live outside the artifact tree (`TodosTreeSection.tsx`) and have their own action set. v1: treat todos as NOT multi-selectable (don't attach selection handlers). `code-file` likewise (different tree).

`task-graph` / `task-details` nodes return `[]` from `getActionsForNode` already; skip selection for them.

## 5. Backend API assessment

### Current state
Grep for `bulk|batch` in `src/routes/api.ts` finds only `batches` in the task-graph code path — **no bulk delete / deprecate / pin endpoints exist**. The per-artifact endpoints are:

- `DELETE /api/diagram/:id`, `DELETE /api/document/:id`, etc. — wired through `api.deleteDiagram` (`ui/src/lib/api.ts:403+`).
- `PATCH /api/metadata/:id` with `{ deprecated?, pinned? }` handled at `src/routes/api.ts:2601` — one id per call.
- MCP `deprecate_artifact` tool (`src/mcp/setup.ts:1923`) is similarly per-id.

### Recommendation: **fan-out from the client in v1**; add `bulk_*` endpoints in v2 if telemetry shows N>10 selections are common.

Rationale:
- Typical multi-select batch size is 2–10. Ten HTTP calls in parallel (`Promise.allSettled`) is fine latency-wise.
- Fan-out surfaces partial-failure naturally — we can report "3 of 5 deleted; 2 failed" via `notificationStore`.
- Adding `POST /api/bulk/deprecate` etc. is mechanical once justified; no design block today.
- WebSocket broadcasts already fire per-item; clients picking up 10 events in rapid succession is handled by existing store reconciliation.

### Fan-out contract
```ts
async function runBatch<T>(keys: SelectionKey[], op: (k: SelectionKey) => Promise<T>) {
  const results = await Promise.allSettled(keys.map(op));
  const failed = results.filter(r => r.status === 'rejected');
  // surface via notificationStore; do not throw
}
```

## 6. Visual design

- **Multi-selected row**: `bg-accent-200 dark:bg-accent-800` (one shade darker than the existing single-select `bg-accent-100 dark:bg-accent-900` in `ArtifactTreeNode.tsx:50`). Add a 2px left border in `accent-500` to differentiate from "editor has this open".
- **Editor-active + multi-selected**: both styles compose. Left border = editor; background tint = multi-selected.
- **Selection summary bar**: when `multiSelection.size > 0`, render a sticky footer inside the `<aside>` at the bottom of the tree body:
  ```
  [ 5 selected ] [ Clear ] [ Deprecate ] [ Delete ]
  ```
  Gives discoverability without requiring users to know about right-click. Also useful on trackpads where right-click is friction.
- **Count badge** on the right-click menu header (optional): "Actions for 5 items".
- **No checkboxes** in v1 — keeps the tree compact and matches VS Code. Can revisit if user-testing shows discoverability issues.

## 7. Edge cases

1. **Deleting the row currently open in the editor**. If any deleted key matches a `sessionStore.selectedXxxId`, after bulk delete completes, call the corresponding `selectXxx(null)` to clear the editor. The `removeDiagram`/etc. store methods already null out the selection (see `sessionStore.ts:320-324`), so this is automatic as long as we call the store's remove method after each successful delete (matching `ArtifactTree.tsx:604-626`).
2. **Deprecating the editor item**. Editor stays open showing the (now deprecated) artifact; matches current single-item behavior. No action needed.
3. **Empty selection + keyboard Delete**. No-op.
4. **Selection contains items hidden by filter change**. User types in search → some selected rows disappear from view. Keep them in selection; show summary bar "5 selected (3 hidden)". Clearing search restores visibility. Alternative (rejected): auto-prune on filter — loses work, annoying.
5. **Selection contains items in a collapsed section**. Same as above — keep in selection, summary bar shows hidden count.
6. **Mixed-type selection → context menu**. Intersect actions across types. If nothing remains except "Delete" and "Clear Selection", that's fine — those two are always valid for artifacts+blueprints+embeds. Blueprints + artifacts together: Deprecate is valid for both; Delete is valid for artifacts+embeds but **not** blueprints (the current single-item menu for blueprint has NO delete — see `getActionsForNode.ts:106-114`). So mixed blueprint+artifact selection → hide Delete (or show disabled with tooltip "Blueprints cannot be deleted"). Recommendation: hide.
7. **Session switch mid-selection**. Clear selection on `currentSession` change — stale ids.
8. **Right-click with no selection** (rare race, e.g., after session change). Treat as "no-op menu" or fall back to single-row menu for the row under the cursor (preferred; matches native UX).
9. **Click on row while async `openNode` is still loading the previous row** (existing concern noted in §11 of the brief). Plain click already fires `openNode`; the multi-select logic layered on top does not change this. The race is pre-existing and not worsened.
10. **Right-click does NOT call `openNode`**. Good — avoids the race. Confirmed by menu opening via `onContextMenu` which only calls `setContextMenu` (`ArtifactTree.tsx:543-546`).
11. **Drag-start from a multi-selected row**. v1: disable native drag while multi-selection is non-empty (set `draggable={false}` on `ArtifactTreeNode` when selected in multi). The `<aside>`'s `onDrop` for file uploads must NOT capture internal drags — it already only reads `e.dataTransfer.files`, so internal drags without file payloads are inert. Still, defer DnD.

## 8. Rollout waves

### v1 (ships first)
- `multiSelection` + `multiSelectAnchor` in `sidebarTreeStore` (non-persisted).
- Click / Ctrl-click / Shift-click / Right-click behaviors on `ArtifactTreeNode` in the **Items** tab only.
- Shift-click range spans sections (flat visible-order rule).
- Extend `getActionsForNode` → `getActionsForSelection` that returns the intersection.
- Context menu batch actions: **Pin/Unpin, Deprecate/Undeprecate, Delete**. Single-only: Rename stays disabled, Download/Email stay as today.
- Confirmation dialog for bulk Delete (reuse `ConfirmDialog`) with count-aware message.
- Selection summary bar at bottom of Items tree with [Clear] [Deprecate] [Delete].
- Escape clears selection; Delete key triggers bulk delete with confirm.
- Fan-out via `Promise.allSettled`; partial-failure toast via `notificationStore`.
- Clear selection on session switch.
- Exclude `todo`, `task-graph`, `task-details`, `code-file` nodes from multi-select.

### v2
- Bulk Download as zip (client-side bundle) and Open as Tabs.
- Arrow-key focus navigation.
- Multi-select + DnD (drag group to reorder or drop out to OS — out of current scope).
- Server-side bulk endpoints if batch sizes > 10 become common: `POST /api/bulk/deprecate`, `POST /api/bulk/delete`, `POST /api/bulk/pin`.
- Extend the same model to the Code tree (`PseudoTreeBody`) with pseudo-file-specific batch actions (Sync from Disk, Unlink).
- Touch/long-press multi-select on mobile.
- Rename multi flow (via a generic rename modal added separately).

## References

- `ui/src/components/layout/sidebar-tree/ArtifactTree.tsx:105-974` — main component, hosts `contextMenu` state, click handlers, delete confirm dialog.
- `ui/src/components/layout/sidebar-tree/ArtifactTreeNode.tsx:38-109` — row component; `onClick`/`onContextMenu` hooks already there.
- `ui/src/components/layout/sidebar-tree/SidebarNodeContextMenu.tsx:1-107` — reusable positioning + Escape handler; extend to accept multi-scope label.
- `ui/src/components/layout/sidebar-tree/getActionsForNode.ts:47-167` — action list generator to extend.
- `ui/src/components/layout/tabs/TabContextMenu.tsx:1-110` — sibling pattern for mouse-position context menus.
- `ui/src/stores/sidebarTreeStore.ts:194-323` — where the new selection slice goes; note `partialize` (line 264) must NOT include `multiSelection`.
- `ui/src/stores/sessionStore.ts:54-58,110-118,197-331` — single-selection fields and their setters; do not alter.
- `ui/src/lib/api.ts:403-425,481,659,674` — per-item delete/deprecate/pin endpoints used for fan-out.
- `src/routes/api.ts:2601` — `PATCH /api/metadata/:id` (per-item only; no bulk).
- `src/mcp/setup.ts:1923,3948` — `deprecate_artifact` MCP tool (per-item).
