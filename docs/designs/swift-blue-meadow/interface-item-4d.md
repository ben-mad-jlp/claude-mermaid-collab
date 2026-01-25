# Interface: Item 4d - Collab Codex GUI Topic Browser + Detail

## Interface Definition

### File Structure

- `codex/ui/src/components/topics/TopicBrowser.tsx`
- `codex/ui/src/components/topics/TopicRow.tsx`
- `codex/ui/src/components/topics/TopicDetail.tsx`
- `codex/ui/src/components/topics/DocumentTabs.tsx`
- `codex/ui/src/components/topics/DocumentViewer.tsx`
- `codex/ui/src/components/common/FilterBar.tsx`
- `codex/ui/src/hooks/useTopics.ts`
- `codex/ui/src/hooks/useTopic.ts`
- `codex/ui/src/pages/TopicBrowserPage.tsx`
- `codex/ui/src/pages/TopicDetailPage.tsx`

### Type Definitions

```typescript
// codex/ui/src/types/index.ts

type DocumentType = 'conceptual' | 'technical' | 'files' | 'related';

interface TopicSummary {
  name: string;
  confidence: ConfidenceTier;
  lastVerified: string | null;
  accessCount: number;
  openFlagCount: number;
  hasDraft: boolean;
}

interface TopicFull extends TopicSummary {
  documents: {
    conceptual: string;
    technical: string;
    files: string;
    related: string;
  };
  lastModified: string | null;
  flags: Flag[];
}

interface TopicFilters {
  confidence?: ConfidenceTier[];
  hasFlags?: boolean;
  hasDraft?: boolean;
  staleDays?: number;
}

type TopicSortBy = 'name' | 'confidence' | 'lastVerified' | 'accessCount';
type SortOrder = 'asc' | 'desc';
```

### Component Props

```typescript
// TopicBrowser.tsx
interface TopicBrowserProps {
  onSelectTopic: (name: string) => void;
}

// TopicRow.tsx
interface TopicRowProps {
  topic: TopicSummary;
  onClick: () => void;
}

// TopicDetail.tsx
interface TopicDetailProps {
  topicName: string;
  onEdit: () => void;
  onVerify: () => void;
  onDelete: () => void;
}

// DocumentTabs.tsx
interface DocumentTabsProps {
  activeTab: DocumentType;
  onTabChange: (tab: DocumentType) => void;
  hasDraft?: boolean;
}

// DocumentViewer.tsx
interface DocumentViewerProps {
  content: string;
  documentType: DocumentType;
}

// FilterBar.tsx
interface FilterBarProps {
  filters: TopicFilters;
  sortBy: TopicSortBy;
  sortOrder: SortOrder;
  onFiltersChange: (filters: TopicFilters) => void;
  onSortChange: (sortBy: TopicSortBy, order: SortOrder) => void;
}
```

### Hook Signatures

```typescript
// codex/ui/src/hooks/useTopics.ts
function useTopics(filters?: TopicFilters, sortBy?: TopicSortBy, sortOrder?: SortOrder): {
  topics: TopicSummary[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

// codex/ui/src/hooks/useTopic.ts
function useTopic(name: string): {
  topic: TopicFull | null;
  isLoading: boolean;
  error: Error | null;
  verify: () => Promise<void>;
  refresh: () => Promise<void>;
}
```
