# Interface Definition - Item 2

## Add UI to view document update history in desktop GUI

### File Structure

- `ui/src/components/editors/HistoryDropdown.tsx` - History dropdown component
- `ui/src/components/editors/HistoryModal.tsx` - Modal for diff view display
- `ui/src/hooks/useDocumentHistory.ts` - Hook for fetching/subscribing to history
- `ui/src/types/history.ts` - Frontend type definitions
- `ui/src/components/editors/DocumentEditor.tsx` - Integration (modification)

### Type Definitions

```typescript
// ui/src/types/history.ts

/**
 * A single change entry from the history API
 */
export interface ChangeEntry {
  /** ISO timestamp when the change occurred */
  timestamp: string;
  /** Diff details */
  diff: {
    oldString: string;
    newString: string;
  };
}

/**
 * Response from GET /api/document/:id/history
 */
export interface DocumentHistory {
  /** Original document content before any changes */
  original: string;
  /** Array of changes in chronological order */
  changes: ChangeEntry[];
}

/**
 * Props for the HistoryDropdown component
 */
export interface HistoryDropdownProps {
  /** Document ID to show history for */
  documentId: string;
  /** Current document content (for diff comparison) */
  currentContent: string;
  /** Callback when user selects a historical version */
  onVersionSelect: (timestamp: string, content: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Props for the HistoryModal component
 */
export interface HistoryModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close the modal */
  onClose: () => void;
  /** Historical content to show (left side of diff) */
  historicalContent: string;
  /** Current content to compare against (right side) */
  currentContent: string;
  /** Timestamp label for the historical version */
  timestamp: string;
  /** Optional document name for display */
  documentName?: string;
}

/**
 * Return type for useDocumentHistory hook
 */
export interface UseDocumentHistoryReturn {
  /** Document history data */
  history: DocumentHistory | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message if failed */
  error: string | null;
  /** Refetch history */
  refetch: () => Promise<void>;
  /** Get content at a specific timestamp */
  getVersionAt: (timestamp: string) => Promise<string | null>;
}
```

### Function Signatures

```typescript
// ui/src/hooks/useDocumentHistory.ts

import type { UseDocumentHistoryReturn } from '@/types/history';

/**
 * Hook to fetch and subscribe to document history updates
 * @param documentId - Document ID to track history for
 * @returns History data, loading state, and methods
 */
export function useDocumentHistory(documentId: string | null): UseDocumentHistoryReturn;
```

```typescript
// ui/src/components/editors/HistoryDropdown.tsx

import React from 'react';
import type { HistoryDropdownProps } from '@/types/history';

/**
 * Dropdown button showing document change history
 * - Displays clock icon button
 * - Opens dropdown with list of timestamps (relative format)
 * - Disabled when no history available
 */
export const HistoryDropdown: React.FC<HistoryDropdownProps>;
```

```typescript
// ui/src/components/editors/HistoryModal.tsx

import React from 'react';
import type { HistoryModalProps } from '@/types/history';

/**
 * Modal overlay showing diff between historical and current content
 * - Uses existing DiffView component
 * - Shows timestamp in header
 * - Close button and Escape key to dismiss
 */
export const HistoryModal: React.FC<HistoryModalProps>;
```

### Component Interactions

1. **HistoryDropdown → useDocumentHistory**:
   - Calls hook with documentId
   - Renders button disabled if `history === null` or `history.changes.length === 0`
   - Maps `history.changes` to dropdown items with relative timestamps

2. **HistoryDropdown → API**:
   - On item click, calls `GET /api/document/:id/version?timestamp=...`
   - Passes result to `onVersionSelect` callback

3. **DocumentEditor → HistoryDropdown**:
   - Renders HistoryDropdown in secondary toolbar (after existing buttons)
   - Handles `onVersionSelect` by opening HistoryModal

4. **HistoryModal → DiffView**:
   - Wraps existing `DiffView` component from `ui/src/components/ai-ui/display/DiffView.tsx`
   - Passes `before={historicalContent}` and `after={currentContent}`

5. **useDocumentHistory → WebSocket**:
   - Subscribes to `document_history_updated` messages
   - Refetches history when message received for current document

### UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ DocumentEditor Header                                           │
├─────────────────────────────────────────────────────────────────┤
│ [Annotation Tools...]          [Sync] [Diff] [History▼] [Export]│
│                                        ┌──────────────┐         │
│                                        │ 2m ago       │         │
│                                        │ 15m ago      │         │
│                                        │ 1h ago       │         │
│                                        │ Yesterday    │         │
│                                        └──────────────┘         │
├─────────────────────────────────────────────────────────────────┤
│ Editor Pane                    │ Preview Pane                   │
│                                │                                │
└─────────────────────────────────────────────────────────────────┘
```

### Relative Time Format

Uses relative time formatting for dropdown entries:
- "just now" - < 1 minute
- "Xm ago" - < 1 hour  
- "Xh ago" - < 24 hours
- "Yesterday" - 24-48 hours
- "X days ago" - < 7 days
- Full date for older entries
