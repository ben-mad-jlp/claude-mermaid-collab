# Design — Unified Split-Pane UX

## Goal

One consistent split-pane model for **every** artifact type. Today the UX is fragmented:

- Documents, diagrams, designs, spreadsheets, snippets flow through `SplitEditorHost` → they get tab/pane behavior.
- Embeds, images, pseudo-paths, task-graph, task-details, blueprint, code-file render in **separate standalone branches** in `App.tsx` — they bypass the split host entirely and can never appear on the right pane.

This is spec drift. Fix: route all artifact/tab kinds through a single split-pane host with a single tab bar.

## Finalized UX Model (locked)

1. **One tab bar.** Always rendered (primary / "left"). Lists every open tab regardless of which pane renders it.
2. **Sidebar item click** → opens/shows on the left pane.
3. **Tab click in the bar** → shows on the left pane. If that tab is also pinned to the right pane, the right pane continues to show it (dual view of the same item).
4. **Drag a tab onto the right half-drop-zone** → pins that tab to the right pane. The tab stays in the single tab bar. No visual marker on the tab.
5. **Hovering close button at the right pane's top-right** → collapses the split. Right-pinned tabs simply un-pin (they remain listed in the bar; left pane is active).
6. **No second tab bar.** `SplitTabBar` (the split-aware variant) is removed or reduced to a thin wrapper over the single `TabBar`.

### Store implications

- `activePaneId` is effectively always `'left'` for interaction purposes (keyboard, focus, new-opens). The right pane is a passive view slot.
- `moveTabBetweenPanes` is replaced (or repurposed) by a simpler "pin to right / unpin from right" operation. Tabs are NOT duplicated across panes — a single `TabDescriptor` has an optional `pinnedRight: boolean` flag, OR the right pane simply references a tab id from the single tab list.
- Close-split action: clear all `pinnedRight` flags (or clear `rightPaneTabId`); tabs themselves are untouched.
- Opening a new item from the sidebar/tab click always sets the left pane's active tab. It does NOT change what the right pane shows unless the right pane's pinned item was the one just closed.

### Bugs from review-bugs-split-panes — re-evaluated

- **H1 (moveTabBetweenPanes clones with isPreview:true)** — moot. No more cross-pane move; tabs are single instances with a right-pin flag.
- **H2 (active-tab fallback is fromTabs[0] not neighbor)** — moot. Only one tab list now.
- **H3 (right→left drain leaves activePaneId='right')** — moot. `activePaneId` is effectively pinned to `'left'`.

The medium/low bugs will be re-triaged during implementation.

## Artifact-Type Parity

**Every** tab kind must render inside the split host the same way:

| TabKind / item.type | Today's render path | Target |
|---|---|---|
| `artifact` / document | `DocumentView` via `SplitEditorHost.renderPane` | ✅ already in split host |
| `artifact` / diagram | `UnifiedEditor` via `SplitEditorHost.renderPane` | ✅ already in split host |
| `artifact` / design | `UnifiedEditor` → `DesignEditor` branch | ✅ already in split host |
| `artifact` / spreadsheet | `UnifiedEditor` → `SpreadsheetEditor` branch | ✅ already in split host |
| `artifact` / snippet | `UnifiedEditor` → `SnippetGroupView`/`CodeEditor` | ✅ already in split host |
| `artifact` / image | ❌ standalone branch in `App.tsx` (`selectedImageId` → `ImageViewer`) | ➜ route through split host |
| `embed` | ❌ standalone branch (`selectedEmbedId` → `EmbedViewer`) | ➜ route through split host |
| `task-graph` | ❌ standalone branch (`TaskGraphView`) | ➜ route through split host |
| `task-details` | ❌ standalone branch | ➜ route through split host |
| `blueprint` | ❌ standalone branch | ➜ route through split host |
| `code-file` | ❌ (pseudo-path) standalone branch (`PseudoViewer`) | ➜ route through split host |

### Proposed dispatcher

Introduce a **single** `PaneContent` component that, given a `TabDescriptor`, returns the correct viewer/editor. `SplitEditorHost.renderPane` delegates to it. The standalone branches in `App.tsx` (`selectedEmbedId`, `selectedImageId`, `selectedPseudoPath`, task-graph block) are deleted — their content is reachable only as tabs, and tabs route through `PaneContent`.

```
PaneContent(descriptor):
  switch descriptor.kind:
    case 'artifact':
      switch descriptor.artifactType:
        document   → DocumentView
        diagram    → UnifiedEditor (diagram branch)
        design     → DesignEditor
        spreadsheet→ SpreadsheetEditor
        snippet    → SnippetGroupView / CodeEditor
        image      → ImageViewer
    case 'embed'       → EmbedViewer
    case 'task-graph'  → TaskGraphView
    case 'task-details'→ TaskDetailsView
    case 'blueprint'   → BlueprintView
    case 'code-file'   → PseudoViewer
```

### Consequences

- `selectedImageId`, `selectedEmbedId`, `selectedPseudoPath`, task-graph mode flag (and any similar "current thing" globals) are replaced by reading the active tab from the tabs store.
- Toolbar (`EditorToolbar`) dispatch currently keys on `selectedItem?.type`; it must key on the **left pane's active tab** instead (same source of truth). Same mechanism already exists for document/diagram/design; it just needs to cover the newly-tabbed kinds.
- Opening an embed/image/pseudo-path/task-graph from the sidebar or a link becomes "open a tab of that kind on the left pane" instead of "set a standalone selection state."

## Work Breakdown (for a future blueprint)

1. Store refactor: single tab list with optional `pinnedRight` flag (or `rightPaneTabId`); drop `moveTabBetweenPanes` semantics; add `pinTabRight` / `unpinTabRight` / `closeRightPane`.
2. Tab-bar refactor: delete/reduce `SplitTabBar`; use the single `TabBar` always.
3. Promote non-artifact viewers (image, embed, pseudo, task-graph, task-details, blueprint, code-file) to first-class tab kinds.
4. Build `PaneContent` dispatcher; use from `SplitEditorHost.renderPane`.
5. Delete standalone branches in `App.tsx` (`selectedEmbedId`, `selectedImageId`, `selectedPseudoPath`, task-graph block).
6. Sidebar open handlers always target left pane; drag-to-right-half is the only way to pin right.
7. Right-pane close overlay button (top-right, on-hover).
8. Re-triage review-bugs-split-panes medium/low bugs against the new model.

## Deferred Follow-ups (still open)

- Per-pane `localContent` / auto-save routing.
- Cmd+Z undo routing per pane.
- History / zoom / preview props threaded through `SplitEditorHost` to each pane.
- Visual feedback for drag-to-right-half drop zone.

## Open Questions

- Should non-artifact tabs (task-graph, blueprint, etc.) be pinnable to the right pane, or only artifact tabs? (Default assumption: **yes, all tab kinds are pinnable** — that's the whole point of parity.)
- When the user opens an image/embed from within a document preview link, should it replace the left pane's active tab, or open a new tab? (Current doc-click behavior = new tab; keep consistent.)
