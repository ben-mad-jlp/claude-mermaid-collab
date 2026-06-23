# Retriage: Split-Pane Bugs vs. Unified-UX Model

Context: the split-pane UX was refactored to a single tab list per session with `rightPaneTabId` as a pointer. `PaneContent` dispatches every `TabKind` to its subview. This document re-evaluates each bug in `review-bugs-split-panes` against the new model.

## Parity Test

- **File**: `ui/src/components/layout/editor/__tests__/SplitPaneParity.test.tsx`
- **Result**: 12/12 passing (1 test per TabKind / artifactType + null-tab fallback)
- **What each test verifies**: pins a tab of that kind to the right pane, then asserts `PaneContent` renders the correct (mocked) subview, with the correct id/path/project/session propagated.

Coverage map:
| TabKind / artifactType | Subview asserted |
|---|---|
| artifact/diagram | UnifiedEditor (type=diagram) |
| artifact/document | DocumentView |
| artifact/design | UnifiedEditor (type=design) |
| artifact/spreadsheet | UnifiedEditor (type=spreadsheet) |
| artifact/snippet | UnifiedEditor (type=snippet) |
| artifact/image | ImageViewer (by imageId prop) |
| embed | EmbedViewer |
| task-graph | TaskGraphView (project+session) |
| task-details | NotFound placeholder ("not implemented") |
| blueprint | DocumentView |
| code-file | PseudoViewer (path+project) |
| null tab | EmptyPane |

Mocking strategy: `vi.mock()` for all heavy subviews (UnifiedEditor, DocumentView, EmbedViewer, ImageViewer, TaskGraphView, PseudoViewer). `sessionStore` and `tabsStore` are seeded via `setState`.

## Per-Bug Verdicts

### HIGH (originally 3)

- **H1 — moveTabBetweenPanes preserves isPreview → duplicate previews: MOOT / CLOSED.**
  The new store has no per-pane tab list. `rightPaneTabId` is just a pointer into the single `tabs[]`; moving a tab "to the right pane" via `pinTabRight(id)` never clones anything, so there is no way to produce two tabs with `isPreview: true` through a move. The "one preview per pane" invariant is now "one preview per session" and holds structurally.

- **H2 — moveTabBetweenPanes active-fallback picks first tab: MOOT / CLOSED.**
  There is no cross-pane move anymore; `pinTabRight` does not touch `activeTabId`. The active-fallback logic only exists in `closeTab`, which already uses the neighbor-first pattern (`tabs[i+1] ?? tabs[i-1]`, tabsStore.ts:287). No jarring active-jump surface remains.

- **H3 — right-to-left drain leaves activePaneId='right' with empty right pane: MOOT / CLOSED.**
  `activePaneId` is now deprecated and pinned to `'left'` (tabsStore.ts:103–104, 407–409). `setActivePaneId` is a no-op. Unpinning the last right-pinned tab via `unpinTabRight` simply sets `rightPaneTabId = null` — there is no per-pane active-tab state to desync. Keyboard hooks reading `entry.panes[activePaneId]` go through the compat shim in `useSessionTabs`, which derives from the single list.

All three HIGH bugs are CLOSED.

### MEDIUM

- **M1 — SplitPane primarySize desyncs from persisted size on reload: STILL_VALID.**
  `SplitEditorHost.tsx:163` still does `useState<number>(50)` and passes it to `SplitTabBar primarySizePercent`. The refactor did not touch this init. Visible desync on reload persists until the user drags the splitter. Fix is independent of the unified-UX refactor (lazy read from localStorage or SplitPane onMount emit).

- **M2 — Duplicate onMouseDown→setActivePaneId handlers + iframe focus gap: PARTIALLY MOOT.**
  `setActivePaneId` is now a no-op, so the "redundant sources" concern is gone. However, `SplitEditorHost.tsx:141,152` still registers these handlers and still paints a focus ring based on `activePaneId`. Since `activePaneId` never changes, the right-pane focus ring never activates in practice — effectively dead UX. Recommend cleanup (see New Issue N1).

- **M3 — setActivePaneId refuses empty pane: MOOT.**
  `setActivePaneId` is a no-op. The "can't click empty right to activate" concern is gone; the right pane is never empty when shown (gated on `rightPaneTabId != null`).

- **M4 — Orphaned v1 localStorage blob: STILL_VALID (low urgency).**
  The store now uses `name: 'collab.tabs.v3'` and `migrate: prevVersion < 3 ? { bySession: {} } : _persisted`. This drops *any* pre-v3 state deliberately. If the deployment previously shipped `v2`, v2 users lose their tabs on upgrade. This is an intentional hard reset — valid for a refactor wave, but worth documenting in a release note.

- **M5 — Asymmetric legacy-selection fallback (right pane never resolves legacy selection): MOOT / CLOSED.**
  `app-integration` removed standalone selection-id render branches; all sidebar opens now create tabs through `tabsStore`. `SplitEditorHost` resolves right pane purely from `rightPaneTabId`. No legacy-selection fallback asymmetry can exist.

### LOW

- **L1 — onContentChange drops edits in inactive pane: STILL_VALID.**
  `App.tsx` still has a shared `localContent` plus a guard `pane === activePaneId`. The unified refactor did not change this. Still low-priority because in practice the left pane is the write surface; the right pane is usually a read/preview.

- **L2 — useEditorAutoPromote `promoted` Set leak: STILL_VALID (unchanged).**
  Not touched by the refactor; still low-impact.

- **L3 — reorderTabs refuses mixed pinned+unpinned silently: STILL_VALID.**
  tabsStore.ts:300 still has the guard shape; callers get no feedback. Unchanged.

- **L4 — EditorAreaDropZones pointer-events: NOT A BUG (confirmed).**
  Refactor did not change this; still correct.

- **L5 — TabBar key uses tab.id: MOOT.**
  With a single tab list, there can never be duplicate ids across panes — the original concern (clone-on-move) no longer exists.

## New Issues Exposed by the Refactor

- **N1 — Dead per-pane focus-ring code in SplitEditorHost.**
  `SplitEditorHost.tsx:136–161` still computes `leftIsActive`/`rightIsActive` from `activePaneId` and renders a ring, but `setActivePaneId` is now a no-op (tabsStore.ts:407). The ring is structurally unreachable for the right pane; for the left pane it renders only when a right pane exists *and* `activePaneId === 'left'` (the default). Recommend either removing the ring code entirely, or re-introducing a real per-pane focus notion (pointerdown/focusin on each wrapper to set a local "lastInteractedPane" state) if the ring UX is still desired. Low severity but misleading for future maintainers.

- **N2 — Deprecated `moveTabBetweenPanes` shim still present.**
  tabsStore.ts:379–405. Callers should have been migrated to `pinTabRight`/`unpinTabRight`; the shim is there only for safety. Grep confirms no in-tree callers remain (SplitEditorHost uses pin/unpin directly). Recommend deletion in a follow-up to shrink the surface area.

- **N3 — task-details TabKind has no subview.**
  `PaneContent.tsx:163–165` returns a "Task details view not implemented" placeholder. The TabKind exists in the enum and can be opened, but dispatch is a stub. Either implement `TaskDetailsView` or drop the kind until a consumer needs it. Medium priority (user-visible dead-end if the kind is ever opened).

- **N4 — SplitEditorHost's `primarySize` state initial value (50) still hardcoded.**
  Same root cause as M1 but newly relevant because `SplitTabBar` now receives `primarySizePercent` and paints its split-proportion from it. Pre-drag mismatch between the tab bar layout and the SplitPane body is now *more* visible (tab bar splits at 50/50, editor body at persisted value). Upgrade M1's priority.

## Summary

- H1, H2, H3, M3, M5, L5 → CLOSED (moot under new model).
- M1, M2 (partial), M4, L1, L2, L3, L4 → unchanged or documented.
- 4 new issues filed (N1–N4), none blocking; N3 and N4 are worth fixing in a follow-up.
- Parity test: 12/12 passing.
