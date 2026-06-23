# Wave 2 Implementation — Unified Split-Pane UX

## Tasks Completed
- **pane-content-dispatcher**: new `ui/src/components/layout/editor/PaneContent.tsx`. Dispatches TabDescriptor → viewer: artifact (document/diagram/design/spreadsheet/snippet/image), embed, task-graph, blueprint (as document), code-file (PseudoViewer). Fallbacks for unknown kind / missing lookup / unimplemented views (task-details).
- **tabbar-single**: TabBar + PinnedTabBar dropped pane plumbing (no PaneId prop; reads flat `tabs`/`activeTabId` from compat shim). SplitTabBar reduced to thin wrapper over PinnedTabBar + TabBar. Hooks migrated: `useEditorAutoPromote` and `useTabKeyboard` now read `entry.tabs`/`entry.activeTabId` directly.

## Verification
- Zero unexpected errors in the 6 edited/created files.
- Expected remaining errors in SplitEditorHost.tsx and App.tsx — resolved in waves 3 & 4.
- Pre-existing unrelated TS errors (SplitPane / pseudo / onboarding / etc.) untouched.

## Follow-ups
- No TaskDetailsView / BlueprintView components exist; PaneContent falls back for `task-details` kind. Blueprint tabs resolve through documents (sufficient for now).
