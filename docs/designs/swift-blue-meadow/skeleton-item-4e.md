# Skeleton: Item 4e - Collab Codex GUI Topic Editor + Draft Review

## Planned Files

| File | Purpose |
|------|---------|
| `codex/ui/src/components/topics/TopicEditor.tsx` | Topic create/edit form |
| `codex/ui/src/components/topics/DraftReviewPanel.tsx` | Draft approval panel |
| `codex/ui/src/components/topics/DraftDiffViewer.tsx` | Side-by-side diff |
| `codex/ui/src/components/common/CodeMirrorEditor.tsx` | CodeMirror wrapper |
| `codex/ui/src/components/common/MarkdownRenderer.tsx` | Markdown render component |
| `codex/ui/src/components/common/NameInput.tsx` | Name input with validation |
| `codex/ui/src/hooks/useDrafts.ts` | Drafts list and single draft hooks |
| `codex/ui/src/pages/TopicEditorPage.tsx` | Editor route page |

## Task Dependency Graph

```yaml
tasks:
  - id: 4e-name-input
    files: [codex/ui/src/components/common/NameInput.tsx]
    description: Create NameInput component for "edited by" / "approved by" fields
    depends-on: [4c-types]

  - id: 4e-codemirror
    files: [codex/ui/src/components/common/CodeMirrorEditor.tsx]
    description: Create CodeMirror wrapper with markdown mode
    parallel: true

  - id: 4e-markdown-renderer
    files: [codex/ui/src/components/common/MarkdownRenderer.tsx]
    description: Create MarkdownRenderer using react-markdown
    parallel: true

  - id: 4e-drafts-hook
    files: [codex/ui/src/hooks/useDrafts.ts]
    description: Create useDrafts and useDraft hooks with approve/reject
    depends-on: [4c-types]

  - id: 4e-diff-viewer
    files: [codex/ui/src/components/topics/DraftDiffViewer.tsx]
    description: Create DraftDiffViewer with react-diff-viewer or similar
    depends-on: [4c-types]

  - id: 4e-draft-review
    files: [codex/ui/src/components/topics/DraftReviewPanel.tsx]
    description: Create DraftReviewPanel with current/draft/diff toggle
    depends-on: [4e-drafts-hook, 4e-diff-viewer, 4e-markdown-renderer, 4e-name-input]

  - id: 4e-topic-editor
    files: [codex/ui/src/components/topics/TopicEditor.tsx]
    description: Create TopicEditor with 4 document tabs and save buttons
    depends-on: [4d-document-tabs, 4e-codemirror, 4e-name-input]

  - id: 4e-editor-page
    files: [codex/ui/src/pages/TopicEditorPage.tsx]
    description: Create TopicEditorPage route component
    depends-on: [4c-layout, 4e-topic-editor, 4e-draft-review]
```

## Execution Order

1. **Parallel batch 1:** 4e-codemirror, 4e-markdown-renderer, 4e-name-input (can start immediately)
2. **Parallel batch 2:** 4e-drafts-hook, 4e-diff-viewer (after types)
3. **Parallel batch 3:** 4e-draft-review, 4e-topic-editor (after their dependencies)
4. **Parallel batch 4:** 4e-editor-page (after layout and components)

## Notes

- TopicEditor works in create mode (no topicName) or edit mode
- Save vs Save & Verify buttons - verify also updates lastVerifiedAt
- Draft view modes: Current | Draft | Diff
- "Edited by" / "Approved by" fields required for audit trail
