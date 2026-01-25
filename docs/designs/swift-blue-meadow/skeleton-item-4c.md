# Skeleton: Item 4c - Collab Codex GUI Layout + Dashboard

## Planned Files

| File | Purpose |
|------|---------|
| `codex/ui/src/components/layout/Layout.tsx` | Main layout wrapper |
| `codex/ui/src/components/layout/Sidebar.tsx` | Navigation sidebar |
| `codex/ui/src/components/layout/Header.tsx` | Page header |
| `codex/ui/src/components/dashboard/Dashboard.tsx` | Dashboard container |
| `codex/ui/src/components/dashboard/StatCard.tsx` | Stat display card |
| `codex/ui/src/components/dashboard/PendingDraftsList.tsx` | Drafts list |
| `codex/ui/src/components/dashboard/OpenFlagsList.tsx` | Flags list |
| `codex/ui/src/components/dashboard/StaleTopicsList.tsx` | Stale topics list |
| `codex/ui/src/components/common/RefreshButton.tsx` | Refresh action button |
| `codex/ui/src/components/common/ConfidenceBadge.tsx` | Confidence tier badge |
| `codex/ui/src/components/common/StatusBadge.tsx` | Status indicator badge |
| `codex/ui/src/hooks/useDashboard.ts` | Dashboard data hook |
| `codex/ui/src/pages/DashboardPage.tsx` | Dashboard route page |
| `codex/ui/src/types/index.ts` | Frontend type definitions |

## Task Dependency Graph

```yaml
tasks:
  - id: 4c-types
    files: [codex/ui/src/types/index.ts]
    description: Create frontend type definitions for dashboard, topics, flags
    parallel: true

  - id: 4c-common-badges
    files:
      - codex/ui/src/components/common/ConfidenceBadge.tsx
      - codex/ui/src/components/common/StatusBadge.tsx
      - codex/ui/src/components/common/RefreshButton.tsx
    description: Create common badge and button components
    depends-on: [4c-types]
    parallel: true

  - id: 4c-layout
    files:
      - codex/ui/src/components/layout/Layout.tsx
      - codex/ui/src/components/layout/Sidebar.tsx
      - codex/ui/src/components/layout/Header.tsx
    description: Create layout shell with sidebar navigation
    parallel: true

  - id: 4c-dashboard-hook
    files: [codex/ui/src/hooks/useDashboard.ts]
    description: Create useDashboard hook for parallel data fetching
    depends-on: [4c-types]

  - id: 4c-stat-card
    files: [codex/ui/src/components/dashboard/StatCard.tsx]
    description: Create StatCard component with variant styling
    depends-on: [4c-types]

  - id: 4c-dashboard-lists
    files:
      - codex/ui/src/components/dashboard/PendingDraftsList.tsx
      - codex/ui/src/components/dashboard/OpenFlagsList.tsx
      - codex/ui/src/components/dashboard/StaleTopicsList.tsx
    description: Create dashboard list components
    depends-on: [4c-types, 4c-common-badges]
    parallel: true

  - id: 4c-dashboard
    files: [codex/ui/src/components/dashboard/Dashboard.tsx]
    description: Create Dashboard container with stats and lists
    depends-on: [4c-dashboard-hook, 4c-stat-card, 4c-dashboard-lists, 4c-common-badges]

  - id: 4c-dashboard-page
    files: [codex/ui/src/pages/DashboardPage.tsx]
    description: Create DashboardPage route component
    depends-on: [4c-layout, 4c-dashboard]
```

## Execution Order

1. **Parallel batch 1:** 4c-types, 4c-layout (can start immediately)
2. **Parallel batch 2:** 4c-common-badges, 4c-dashboard-hook, 4c-stat-card (after types)
3. **Parallel batch 3:** 4c-dashboard-lists (after badges)
4. **Parallel batch 4:** 4c-dashboard (after all dashboard components)
5. **Parallel batch 5:** 4c-dashboard-page (after layout and dashboard)

## Notes

- Dashboard fetches stats, flags, stale topics, drafts in parallel
- StatCard variants: default (gray), warning (yellow), error (red)
- Navigation: Dashboard, Topics, Flags, Missing
