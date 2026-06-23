# Wave 6 Implementation

## Tasks
- **bug-retriage-and-parity-tests**
  - New test: `ui/src/components/layout/editor/__tests__/SplitPaneParity.test.tsx` — 12/12 passing, one per TabKind/artifactType (diagram, document, design, spreadsheet, snippet, image, embed, task-graph, task-details, blueprint, code-file, null fallback).
  - Retriage doc: `retriage-bugs-split-panes-unified`.

## H-bug verdicts (all closed as moot under single-list + pointer model)
- H1 (duplicate preview via move): MOOT — single tab list, no clone-on-move.
- H2 (active-fallback picks first tab): MOOT — only `closeTab` handles active fallback (neighbor-first).
- H3 (right-drain leaves activePaneId='right' empty): MOOT — `activePaneId` deprecated; `setActivePaneId` is a no-op.

## New follow-ups exposed
- N1: dead per-pane focus-ring code in `SplitEditorHost`.
- N2: `moveTabBetweenPanes` shim in tabsStore has no remaining callers.
- N3: `task-details` kind is openable but UI dead-ends at placeholder.
- N4: `SplitEditorHost` hardcoded `primarySize=50` now drives SplitTabBar layout on reload too.
