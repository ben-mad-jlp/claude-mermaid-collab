# Interface: Item 4f - Collab Codex GUI Flags + Missing Topics

## Interface Definition

### File Structure

- `codex/ui/src/components/flags/FlagsView.tsx`
- `codex/ui/src/components/flags/FlagsList.tsx`
- `codex/ui/src/components/flags/FlagRow.tsx`
- `codex/ui/src/components/flags/FlagActions.tsx`
- `codex/ui/src/components/missing/MissingTopicsView.tsx`
- `codex/ui/src/components/missing/MissingTopicRow.tsx`
- `codex/ui/src/components/common/ConfirmDialog.tsx`
- `codex/ui/src/hooks/useFlags.ts`
- `codex/ui/src/hooks/useMissingTopics.ts`
- `codex/ui/src/pages/FlagsPage.tsx`
- `codex/ui/src/pages/MissingTopicsPage.tsx`

### Type Definitions

```typescript
// codex/ui/src/types/index.ts

type FlagStatus = 'open' | 'addressed' | 'resolved' | 'dismissed';

interface Flag {
  id: number;
  topicName: string;
  comment: string;
  status: FlagStatus;
  createdAt: string;
  addressedAt?: string;
  resolvedAt?: string;
  dismissedReason?: string;
}

interface MissingTopic {
  topicName: string;
  requestCount: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
}

interface FlagFilters {
  status?: FlagStatus[];
  topicName?: string;
  dateFrom?: string;
  dateTo?: string;
}
```

### Component Props

```typescript
// FlagsView.tsx
interface FlagsViewProps {
  initialTab?: FlagStatus | 'all';
}

// FlagsList.tsx
interface FlagsListProps {
  flags: Flag[];
  onResolve: (flagId: number, resolvedBy: string) => Promise<void>;
  onDismiss: (flagId: number, dismissedBy: string, reason?: string) => Promise<void>;
  onReopen: (flagId: number, reopenedBy: string) => Promise<void>;
  onGoToTopic: (topicName: string) => void;
}

// FlagRow.tsx
interface FlagRowProps {
  flag: Flag;
  onAction: (action: 'resolve' | 'dismiss' | 'reopen') => void;
  onGoToTopic: () => void;
}

// FlagActions.tsx
interface FlagActionsProps {
  flag: Flag;
  onResolve: () => void;
  onDismiss: (reason?: string) => void;
  onReopen: () => void;
}

// MissingTopicsView.tsx
interface MissingTopicsViewProps {
  onCreateTopic: (topicName: string) => void;
}

// MissingTopicRow.tsx
interface MissingTopicRowProps {
  topic: MissingTopic;
  onCreate: () => void;
  onDismiss: () => void;
}

// ConfirmDialog.tsx
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  showReasonInput?: boolean;
  reasonValue?: string;
  onReasonChange?: (reason: string) => void;
}
```

### Hook Signatures

```typescript
// codex/ui/src/hooks/useFlags.ts
function useFlags(filters?: FlagFilters): {
  flags: Flag[];
  isLoading: boolean;
  error: Error | null;
  resolve: (flagId: number, resolvedBy: string) => Promise<void>;
  dismiss: (flagId: number, dismissedBy: string, reason?: string) => Promise<void>;
  reopen: (flagId: number, reopenedBy: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// codex/ui/src/hooks/useMissingTopics.ts
function useMissingTopics(): {
  topics: MissingTopic[];
  isLoading: boolean;
  error: Error | null;
  dismiss: (topicName: string, dismissedBy: string) => Promise<void>;
  refresh: () => Promise<void>;
}
```
