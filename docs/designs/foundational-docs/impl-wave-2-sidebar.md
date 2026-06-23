# Wave 2 Implementation

## Tasks completed (7)

- **sidebar-node-context-menu** — floating context menu mirroring `diagram/ContextMenu` pattern; outside-click + Escape close; destructive/disabled/separator styling
- **tree-node** — `ArtifactTreeNode` leaf row with icon/name/selected/deprecated/pinned; click/dblclick/contextmenu/keydown handlers; memoized
- **tree-section** — `ArtifactTreeSection` with chevron toggle, count, headerActions slot, drag-over ring (valid/invalid hint), onDrop → File[]
- **tab-bar** — dnd-kit horizontal sortable TabBar using PointerSensor, filters out pinned; reorderTabs wired
- **pinned-tab-bar** — `PinnedTabBar` hidden when empty; uses `hideClose` on Tab; right-click opens TabContextMenu
- **editor-auto-promote** — `useEditorAutoPromote` hook + module-level `editorDirtyBus` with `reportEditorDirty()`; promotes preview→permanent once per tabId
- **tab-keyboard** — `useTabKeyboard({enabled})` hook: Ctrl/Cmd+Tab cycle, Ctrl+W close, Ctrl+1..9 jump; skips input targets

## Verification

- TypeScript: clean (pre-existing onboarding errors unrelated)
- Tests: 54/54 passing across 7 wave 2 files
