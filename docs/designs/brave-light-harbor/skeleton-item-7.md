# Skeleton: Item 7 - Fix DiffView on Patch

## File Stubs

### ui/src/types/diff.ts (NEW)
```typescript
export interface DiffState {
  showDiff: boolean;
  oldContent: string | null;
  newContent: string | null;
}

export interface DocumentHistory {
  previous: string | null;
  current: string;
  hasDiff: boolean;
}

export interface PatchNotification {
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

### ui/src/hooks/useDocumentHistory.ts (NEW)
```typescript
import { useState } from 'react';
import { DocumentHistory } from '../types/diff';

export function useDocumentHistory(documentId: string) {
  // TODO: Implement document history tracking
  // - Track previous and current content
  // - recordChange function
  // - clearDiff function
  throw new Error('Not implemented');
}
```

### ui/src/components/DiffControls.tsx (NEW)
```typescript
import React from 'react';

interface DiffControlsProps {
  hasDiff: boolean;
  onClearDiff: () => void;
}

export function DiffControls({ hasDiff, onClearDiff }: DiffControlsProps) {
  // TODO: Implement diff controls
  // - Show "Showing changes" badge
  // - Clear Diff button
  throw new Error('Not implemented');
}
```

### src/mcp/server.ts (MODIFY)
```typescript
// TODO: Update patch_document handler
// - Store old content before patch
// - Broadcast patch notification with old/new content via WebSocket
```

### ui/src/components/DocumentViewer.tsx (MODIFY)
```typescript
// TODO: Integrate diff display
// - Use useDocumentHistory hook
// - Show DiffView when hasDiff is true
// - Include DiffControls
```

## Task Dependency Graph

```yaml
tasks:
  - id: diff-types
    files: [ui/src/types/diff.ts]
    description: Create diff-related type definitions
    parallel: true

  - id: document-history-hook
    files: [ui/src/hooks/useDocumentHistory.ts]
    description: Implement document history tracking hook
    depends-on: [diff-types]

  - id: diff-controls
    files: [ui/src/components/DiffControls.tsx]
    description: Create DiffControls component with clear button
    parallel: true

  - id: patch-notification
    files: [src/mcp/server.ts]
    description: Update patch_document to broadcast diff info
    depends-on: [diff-types]

  - id: document-viewer-diff
    files: [ui/src/components/DocumentViewer.tsx]
    description: Integrate diff display into DocumentViewer
    depends-on: [document-history-hook, diff-controls, patch-notification]
```
