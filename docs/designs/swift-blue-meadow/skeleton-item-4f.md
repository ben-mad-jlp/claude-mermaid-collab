# Skeleton: Item 4f - Collab Codex GUI Flags + Missing Topics

## Planned Files

| File | Purpose |
|------|---------|
| `codex/ui/src/components/flags/FlagsView.tsx` | Flags main view with tabs |
| `codex/ui/src/components/flags/FlagsList.tsx` | Flags table |
| `codex/ui/src/components/flags/FlagRow.tsx` | Single flag row |
| `codex/ui/src/components/flags/FlagActions.tsx` | Resolve/dismiss/reopen buttons |
| `codex/ui/src/components/missing/MissingTopicsView.tsx` | Missing topics view |
| `codex/ui/src/components/missing/MissingTopicRow.tsx` | Single missing topic row |
| `codex/ui/src/components/common/ConfirmDialog.tsx` | Confirmation dialog |
| `codex/ui/src/hooks/useFlags.ts` | Flags list hook with actions |
| `codex/ui/src/hooks/useMissingTopics.ts` | Missing topics hook |
| `codex/ui/src/pages/FlagsPage.tsx` | Flags route page |
| `codex/ui/src/pages/MissingTopicsPage.tsx` | Missing topics route page |

## Task Dependency Graph

```yaml
tasks:
  - id: 4f-confirm-dialog
    files: [codex/ui/src/components/common/ConfirmDialog.tsx]
    description: Create ConfirmDialog with optional reason input
    depends-on: [4c-types]

  - id: 4f-flags-hook
    files: [codex/ui/src/hooks/useFlags.ts]
    description: Create useFlags hook with resolve/dismiss/reopen actions
    depends-on: [4c-types]

  - id: 4f-missing-hook
    files: [codex/ui/src/hooks/useMissingTopics.ts]
    description: Create useMissingTopics hook with dismiss action
    depends-on: [4c-types]

  - id: 4f-flag-actions
    files: [codex/ui/src/components/flags/FlagActions.tsx]
    description: Create FlagActions with status-aware buttons
    depends-on: [4c-types, 4f-confirm-dialog]

  - id: 4f-flag-row
    files: [codex/ui/src/components/flags/FlagRow.tsx]
    description: Create FlagRow with status badge and actions
    depends-on: [4c-common-badges, 4f-flag-actions]

  - id: 4f-flags-list
    files: [codex/ui/src/components/flags/FlagsList.tsx]
    description: Create FlagsList table component
    depends-on: [4f-flag-row]

  - id: 4f-flags-view
    files: [codex/ui/src/components/flags/FlagsView.tsx]
    description: Create FlagsView with status tabs
    depends-on: [4f-flags-hook, 4f-flags-list, 4e-name-input]

  - id: 4f-missing-row
    files: [codex/ui/src/components/missing/MissingTopicRow.tsx]
    description: Create MissingTopicRow with create/dismiss buttons
    depends-on: [4c-types]

  - id: 4f-missing-view
    files: [codex/ui/src/components/missing/MissingTopicsView.tsx]
    description: Create MissingTopicsView with name input and table
    depends-on: [4f-missing-hook, 4f-missing-row, 4e-name-input]

  - id: 4f-pages
    files:
      - codex/ui/src/pages/FlagsPage.tsx
      - codex/ui/src/pages/MissingTopicsPage.tsx
    description: Create route pages for flags and missing topics
    depends-on: [4c-layout, 4f-flags-view, 4f-missing-view]
    parallel: true
```

## Execution Order

1. **Parallel batch 1:** 4f-confirm-dialog, 4f-flags-hook, 4f-missing-hook (after types)
2. **Parallel batch 2:** 4f-flag-actions, 4f-missing-row (after dependencies)
3. **Parallel batch 3:** 4f-flag-row (after actions)
4. **Parallel batch 4:** 4f-flags-list (after row)
5. **Parallel batch 5:** 4f-flags-view, 4f-missing-view (after lists and hooks)
6. **Parallel batch 6:** 4f-pages (after layout and views)

## Notes

- Flag tabs: All | Open | Addressed | Resolved | Dismissed
- Flag actions depend on status (open can resolve/dismiss, resolved can reopen)
- Dismiss requires reason via ConfirmDialog
- Missing topic "Create" navigates to editor with prefilled name
