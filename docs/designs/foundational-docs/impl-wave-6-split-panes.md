# Wave 6 Implementation — Split Tab Panes

## Tasks
- **active-pane-focus-ring** — In `SplitEditorHost`, each pane's content is wrapped in a focus-aware div (split mode only). `onMouseDown` sets `activePaneId`; conditional ring (`ring-2 ring-inset ring-accent-500`) marks the active pane. Single-pane render path unchanged.

## Verification
- Full tsc: no errors in split-pane files.
- Tests: 23/23 passed.
