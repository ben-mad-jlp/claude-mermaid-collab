# Interface: Item 4e - Collab Codex GUI Topic Editor + Draft Review

## Interface Definition

### File Structure

- `codex/ui/src/components/topics/TopicEditor.tsx`
- `codex/ui/src/components/topics/DraftReviewPanel.tsx`
- `codex/ui/src/components/topics/DraftDiffViewer.tsx`
- `codex/ui/src/components/common/CodeMirrorEditor.tsx`
- `codex/ui/src/components/common/MarkdownRenderer.tsx`
- `codex/ui/src/components/common/NameInput.tsx`
- `codex/ui/src/hooks/useDrafts.ts`
- `codex/ui/src/pages/TopicEditorPage.tsx`

### Type Definitions

```typescript
// codex/ui/src/types/index.ts

interface DraftInfo {
  topicName: string;
  documents: {
    conceptual: string;
    technical: string;
    files: string;
    related: string;
  };
  generatedAt: string;
  triggerType: 'flag_response' | 'missing_topic' | 'scheduled_refresh' | 'source_change' | 'manual';
  sourceFiles?: string[];
  relatedFlagComment?: string;
}

interface DocumentDiff {
  documentType: DocumentType;
  current: string;
  draft: string;
  additions: number;
  deletions: number;
}

type DraftViewMode = 'current' | 'draft' | 'diff';
```

### Component Props

```typescript
// TopicEditor.tsx
interface TopicEditorProps {
  topicName?: string;  // undefined = create mode
  initialDocuments?: TopicDocuments;
  onSave: (documents: TopicDocuments, editedBy: string, verify: boolean) => Promise<void>;
  onCancel: () => void;
}

// DraftReviewPanel.tsx
interface DraftReviewPanelProps {
  topicName: string;
  draft: DraftInfo;
  onApprove: (approvedBy: string) => Promise<void>;
  onReject: (rejectedBy: string, reason?: string) => Promise<void>;
}

// DraftDiffViewer.tsx
interface DraftDiffViewerProps {
  current: string;
  draft: string;
  language?: string;  // default: 'markdown'
}

// CodeMirrorEditor.tsx
interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  placeholder?: string;
  readOnly?: boolean;
}

// MarkdownRenderer.tsx
interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// NameInput.tsx
interface NameInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}
```

### Hook Signatures

```typescript
// codex/ui/src/hooks/useDrafts.ts
function useDrafts(): {
  drafts: { topicName: string; generatedAt: string }[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function useDraft(topicName: string): {
  draft: DraftInfo | null;
  diff: DocumentDiff[] | null;
  isLoading: boolean;
  error: Error | null;
  approve: (approvedBy: string) => Promise<void>;
  reject: (rejectedBy: string, reason?: string) => Promise<void>;
}
```
