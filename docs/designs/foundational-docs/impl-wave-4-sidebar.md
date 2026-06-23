# Wave 4 Implementation

## Tasks completed (2)

- **sidebar-integration** — Sidebar.tsx wraps <aside> body in `VITE_SIDEBAR_TREE` ternary. Flag-on branch renders Vibe Instructions + SubscriptionsPanel + `<ArtifactTree/>`. Flag-off keeps legacy tree intact (cleanup in wave 5).
- **tree-tab-wiring** — ArtifactTree wired: single-click → `openPreview`, double-click → `openPermanent`, context-menu Open-New-Tab → `openPermanent`. All gated by `VITE_SIDEBAR_TABS`. `toTabDescriptor` helper maps TreeNode kinds.

## Verification
- Typecheck: clean for wave 4 files
- Tests: ArtifactTree 4/4 + wave 2/3 tests still green
