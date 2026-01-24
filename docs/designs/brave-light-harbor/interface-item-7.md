# Interface: Item 7 - Fix DiffView on Patch

## File Structure
- `ui/src/components/DocumentViewer.tsx` - Modify to show diff on patch
- `ui/src/hooks/useDocumentHistory.ts` - Track previous content (NEW)
- `ui/src/components/DiffControls.tsx` - Clear diff button (NEW)

## Type Definitions

```typescript
// ui/src/types/diff.ts
interface DiffState {
  showDiff: boolean;
  oldContent: string | null;
  newContent: string | null;
}

interface DocumentHistory {
  previous: string | null;
  current: string;
  hasDiff: boolean;
}
```

## Component Interfaces

```typescript
// ui/src/components/DiffControls.tsx
interface DiffControlsProps {
  hasDiff: boolean;
  onClearDiff: () => void;
}

// ui/src/hooks/useDocumentHistory.ts
function useDocumentHistory(documentId: string): {
  history: DocumentHistory;
  clearDiff: () => void;
  recordChange: (oldContent: string, newContent: string) => void;
}
```

## API Changes

```typescript
// WebSocket message when patch_document completes
interface PatchNotification {
  type: 'patch';
  documentId: string;
  oldContent: string;
  newContent: string;
  patchApplied: {
    old_string: string;
    new_string: string;
  };
}
```

## Component Interactions
- `patch_document` MCP tool sends WebSocket notification with old/new content
- `useDocumentHistory` stores the diff state
- `DocumentViewer` detects `hasDiff` and shows `DiffView` automatically
- `DiffControls` provides "Clear Diff" button
- Clear button calls `clearDiff()` to return to normal view
