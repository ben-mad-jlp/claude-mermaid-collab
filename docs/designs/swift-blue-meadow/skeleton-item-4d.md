# Skeleton: Item 4d - Collab Codex GUI Topic Browser + Detail

## Planned Files

| File | Purpose |
|------|---------|
| `codex/ui/src/components/topics/TopicBrowser.tsx` | Topic list with filters |
| `codex/ui/src/components/topics/TopicRow.tsx` | Single topic row |
| `codex/ui/src/components/topics/TopicDetail.tsx` | Full topic view |
| `codex/ui/src/components/topics/DocumentTabs.tsx` | Document type tabs |
| `codex/ui/src/components/topics/DocumentViewer.tsx` | Markdown document viewer |
| `codex/ui/src/components/common/FilterBar.tsx` | Filter/sort controls |
| `codex/ui/src/hooks/useTopics.ts` | Topics list hook |
| `codex/ui/src/hooks/useTopic.ts` | Single topic hook |
| `codex/ui/src/pages/TopicBrowserPage.tsx` | Browser route page |
| `codex/ui/src/pages/TopicDetailPage.tsx` | Detail route page |

## Task Dependency Graph

```yaml
tasks:
  - id: 4d-hooks
    files:
      - codex/ui/src/hooks/useTopics.ts
      - codex/ui/src/hooks/useTopic.ts
    description: Create useTopics and useTopic hooks for data fetching
    depends-on: [4c-types]
    parallel: true

  - id: 4d-filter-bar
    files: [codex/ui/src/components/common/FilterBar.tsx]
    description: Create FilterBar with confidence, flags, draft, stale filters
    depends-on: [4c-types]

  - id: 4d-topic-row
    files: [codex/ui/src/components/topics/TopicRow.tsx]
    description: Create TopicRow with badges and click handler
    depends-on: [4c-types, 4c-common-badges]

  - id: 4d-topic-browser
    files: [codex/ui/src/components/topics/TopicBrowser.tsx]
    description: Create TopicBrowser with filtering and sorting
    depends-on: [4d-hooks, 4d-filter-bar, 4d-topic-row]

  - id: 4d-document-tabs
    files: [codex/ui/src/components/topics/DocumentTabs.tsx]
    description: Create DocumentTabs for conceptual/technical/files/related
    depends-on: [4c-types]

  - id: 4d-document-viewer
    files: [codex/ui/src/components/topics/DocumentViewer.tsx]
    description: Create DocumentViewer with markdown rendering
    depends-on: [4c-types]

  - id: 4d-topic-detail
    files: [codex/ui/src/components/topics/TopicDetail.tsx]
    description: Create TopicDetail with tabs, viewer, verify button
    depends-on: [4d-hooks, 4d-document-tabs, 4d-document-viewer, 4c-common-badges]

  - id: 4d-pages
    files:
      - codex/ui/src/pages/TopicBrowserPage.tsx
      - codex/ui/src/pages/TopicDetailPage.tsx
    description: Create route pages for browser and detail
    depends-on: [4c-layout, 4d-topic-browser, 4d-topic-detail]
    parallel: true
```

## Execution Order

1. **Parallel batch 1:** 4d-hooks, 4d-filter-bar, 4d-document-tabs (after types)
2. **Parallel batch 2:** 4d-topic-row, 4d-document-viewer (after types/badges)
3. **Parallel batch 3:** 4d-topic-browser, 4d-topic-detail (after their dependencies)
4. **Parallel batch 4:** 4d-pages (after layout and components)

## Notes

- Filter options: confidence tier, has flags, has draft, stale (>30 days)
- Sort options: name, confidence, last verified, access count
- Document tabs: Conceptual | Technical | Files | Related
- Verify button updates lastVerifiedAt
