# Skeleton: Item 1 - Fix Browse Items on Mobile UI

## Planned Files

- [x] `ui/src/components/mobile/PreviewTab.tsx` - **MODIFY** existing file

**Note:** This is a modification to an existing file, not a new file. The changes are documented below.

## File Changes

### ui/src/components/mobile/PreviewTab.tsx

**New Imports (add after line 13):**

```typescript
import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useDataLoader } from '@/hooks/useDataLoader';
```

**Updated Props Interface (replace lines 19-28):**

```typescript
export interface PreviewTabProps {
  /** Optional custom class name */
  className?: string;
}
```

**New Store Integration (add after line 38, inside component):**

```typescript
// Store integration (same pattern as Sidebar.tsx)
const {
  diagrams,
  documents,
  selectedDiagramId,
  selectedDocumentId,
  currentSession,
} = useSessionStore(
  useShallow((state) => ({
    diagrams: state.diagrams,
    documents: state.documents,
    selectedDiagramId: state.selectedDiagramId,
    selectedDocumentId: state.selectedDocumentId,
    currentSession: state.currentSession,
  }))
);

const { selectDiagramWithContent, selectDocumentWithContent } = useDataLoader();

// Combine diagrams and documents into items array
const items: Item[] = useMemo(() => {
  const combined: Item[] = [
    ...diagrams.map((d) => ({ ...d, type: 'diagram' as const })),
    ...documents.map((d) => ({ ...d, type: 'document' as const })),
  ];
  combined.sort((a, b) => b.lastModified - a.lastModified);
  return combined;
}, [diagrams, documents]);

// Get currently selected item
const selectedItem: Item | null = useMemo(() => {
  if (selectedDiagramId) {
    const d = diagrams.find((d) => d.id === selectedDiagramId);
    return d ? { ...d, type: 'diagram' as const } : null;
  }
  if (selectedDocumentId) {
    const d = documents.find((d) => d.id === selectedDocumentId);
    return d ? { ...d, type: 'document' as const } : null;
  }
  return null;
}, [diagrams, documents, selectedDiagramId, selectedDocumentId]);

// Handle item selection
const handleItemSelect = useCallback(
  (item: Item) => {
    if (!currentSession) return;
    if (item.type === 'diagram') {
      selectDiagramWithContent(currentSession.project, currentSession.name, item.id);
    } else {
      selectDocumentWithContent(currentSession.project, currentSession.name, item.id);
    }
  },
  [currentSession, selectDiagramWithContent, selectDocumentWithContent]
);
```

**Component Signature Change (replace line 33-37):**

```typescript
export const PreviewTab: React.FC<PreviewTabProps> = ({
  className = '',
}) => {
```

**Remove from destructuring:**
- `selectedItem` (now computed)
- `items` (now computed)
- `onItemSelect` (now `handleItemSelect`)

**Update ItemDrawer call (around line 179-185):**

```typescript
<ItemDrawer
  isOpen={isDrawerOpen}
  onClose={() => setIsDrawerOpen(false)}
  items={items}
  selectedItemId={selectedItem?.id ?? null}
  onItemSelect={handleItemSelect}
/>
```

## Task Dependency Graph

```yaml
tasks:
  - id: preview-tab-fix
    files: [ui/src/components/mobile/PreviewTab.tsx]
    tests: [ui/src/components/mobile/PreviewTab.test.tsx, ui/src/components/mobile/__tests__/PreviewTab.test.tsx]
    description: Update PreviewTab to use store directly instead of props
    parallel: true
```

## Execution Order

**Wave 1 (parallel-safe):**
- `preview-tab-fix` - No dependencies, can run immediately

## Verification

- [x] File path documented: `ui/src/components/mobile/PreviewTab.tsx`
- [x] All type definitions present (uses existing Item type)
- [x] All function signatures documented
- [x] TODO comments match pseudocode
- [x] Dependency graph covers all files
- [x] No circular dependencies
