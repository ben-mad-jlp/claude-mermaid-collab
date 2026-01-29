# Interface Definition - Item 1: Fix Browse Items on Mobile UI

## File Structure

- `ui/src/components/mobile/PreviewTab.tsx` - **MODIFY** - Add store integration

## Type Definitions

No new types needed. Uses existing types:

```typescript
// Already defined in ui/src/types/item.ts
interface Item {
  id: string;
  name: string;
  type: 'diagram' | 'document';
  content: string;
  lastModified: number;
  folder?: string;
  locked?: boolean;
}

// Already defined in ui/src/types/session.ts
interface Session {
  name: string;
  project: string;
  lastAccess: string;
}
```

## Interface Changes

### PreviewTab Props (AFTER)

```typescript
// ui/src/components/mobile/PreviewTab.tsx
export interface PreviewTabProps {
  /** Optional custom class name */
  className?: string;
  // REMOVED: selectedItem, items, onItemSelect - now managed internally via store
}
```

### New Internal Dependencies

```typescript
// Imports to add
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useDataLoader } from '@/hooks/useDataLoader';
```

### Store Selectors (matching Sidebar pattern)

```typescript
// From useSessionStore (same pattern as Sidebar.tsx:32-46)
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

// From useDataLoader (same pattern as Sidebar.tsx:48)
const { selectDiagramWithContent, selectDocumentWithContent } = useDataLoader();
```

### Computed Values (matching Sidebar pattern)

```typescript
// Combine diagrams + documents into items (same as Sidebar.tsx:73-89)
const items: Item[] = useMemo(() => {
  const combined: Item[] = [
    ...diagrams.map((d) => ({ ...d, type: 'diagram' as const })),
    ...documents.map((d) => ({ ...d, type: 'document' as const })),
  ];
  combined.sort((a, b) => b.lastModified - a.lastModified);
  return combined;
}, [diagrams, documents]);

// Get selected item from IDs
const selectedItem: Item | null = useMemo(() => {
  if (selectedDiagramId) {
    const d = diagrams.find(d => d.id === selectedDiagramId);
    return d ? { ...d, type: 'diagram' as const } : null;
  }
  if (selectedDocumentId) {
    const d = documents.find(d => d.id === selectedDocumentId);
    return d ? { ...d, type: 'document' as const } : null;
  }
  return null;
}, [diagrams, documents, selectedDiagramId, selectedDocumentId]);
```

### Item Selection Handler

```typescript
// Handle item selection (same pattern as Sidebar.tsx:52-63)
const handleItemSelect = useCallback((item: Item) => {
  if (!currentSession) return;
  
  if (item.type === 'diagram') {
    selectDiagramWithContent(currentSession.project, currentSession.name, item.id);
  } else {
    selectDocumentWithContent(currentSession.project, currentSession.name, item.id);
  }
}, [currentSession, selectDiagramWithContent, selectDocumentWithContent]);
```

## Component Interactions

```
PreviewTab
  └── useSessionStore (via useShallow)
       ├── diagrams: Diagram[]
       ├── documents: Document[]
       ├── selectedDiagramId: string | null
       ├── selectedDocumentId: string | null
       └── currentSession: Session | null
  └── useDataLoader
       ├── selectDiagramWithContent()
       └── selectDocumentWithContent()
  └── ItemDrawer
       ├── items (computed from store)
       ├── selectedItemId (from selectedDiagramId/selectedDocumentId)
       └── onItemSelect (calls useDataLoader methods)
```

## MobileLayout Changes

After PreviewTab manages its own data:

```typescript
// MobileLayout.tsx - SIMPLIFIED
<PreviewTab />  // No props needed (all managed internally)
```
