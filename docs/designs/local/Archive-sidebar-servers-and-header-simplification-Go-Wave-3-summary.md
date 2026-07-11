# Wave 3 — sidebar-servers-and-header-simplification

## Tasks
- **modal-cleanup-and-back-compat**:
  - **`ServerSwitcher.tsx` deleted** (along with its co-located test `ServerSwitcher.test.tsx` which was the only remaining importer after Wave 2). Grep confirmed zero remaining code references; only documentary comments mention the symbol now.
  - **`SubscriptionsPanel.tsx`**: prepended a top-of-file JSDoc explaining the post-refactor mental model (servers live in the sidebar; modal lists across all servers; per-server IPC routes tokens-in-main).
  - **Visual order polish** inside each server's `<details>` block: `[server header] → [+ New project] → [pending projects] → [existing projects each with + New session]` (previously interleaved real-first; now matches spec).

## Verification
- tsc filtered to wave surface: clean (no matches).
- `npx vite build`: ✓ built in 28.04s.

## Wave TSC
Clean.
