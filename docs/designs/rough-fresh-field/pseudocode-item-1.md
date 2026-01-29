# Pseudocode: Item 1 - Fix Browse Items on Mobile UI

## PreviewTab Component Modifications

### New Imports

```
1. Add import for useShallow from 'zustand/react/shallow'
2. Add import for useSessionStore from '@/stores/sessionStore'
3. Add import for useDataLoader from '@/hooks/useDataLoader'
4. Add import for useCallback, useMemo from 'react'
```

### Store Integration (new code at component top)

```
1. Extract from useSessionStore (using useShallow for performance):
   - diagrams: Diagram[]
   - documents: Document[]
   - selectedDiagramId: string | null
   - selectedDocumentId: string | null
   - currentSession: Session | null

2. Extract from useDataLoader:
   - selectDiagramWithContent(project, session, id)
   - selectDocumentWithContent(project, session, id)
```

### Computed Items (new useMemo)

```
1. Create items array combining diagrams and documents:
   - Map diagrams to Item[] with type: 'diagram'
   - Map documents to Item[] with type: 'document'
   - Concatenate both arrays
   
2. Sort by lastModified descending (newest first)

3. Return combined array

Dependencies: [diagrams, documents]
```

### Computed Selected Item (new useMemo)

```
1. If selectedDiagramId exists:
   - Find diagram in diagrams array by id
   - If found: return as Item with type: 'diagram'
   
2. Else if selectedDocumentId exists:
   - Find document in documents array by id
   - If found: return as Item with type: 'document'
   
3. Return null if neither found

Dependencies: [diagrams, documents, selectedDiagramId, selectedDocumentId]
```

### Item Selection Handler (new useCallback)

```
1. Check if currentSession exists
   - If not: return early (no-op)

2. Check item.type:
   - If 'diagram': call selectDiagramWithContent(project, session, item.id)
   - If 'document': call selectDocumentWithContent(project, session, item.id)

Dependencies: [currentSession, selectDiagramWithContent, selectDocumentWithContent]
```

### Props Interface Change

```
1. Remove from props:
   - selectedItem: Item | null
   - items: Item[]
   - onItemSelect: (item: Item) => void

2. Keep in props:
   - className?: string
```

### JSX Updates

```
1. Replace prop references:
   - selectedItem (prop) → selectedItem (computed)
   - items (prop) → items (computed)
   - onItemSelect (prop) → handleItemSelect (callback)

2. Update ItemDrawer props:
   - items={items}  // from computed
   - selectedItemId={selectedItem?.id ?? null}  // from computed
   - onItemSelect={handleItemSelect}  // from callback
```

## Error Handling

- **No currentSession**: handleItemSelect returns early (no-op)
- **Item not found in store**: selectedItem returns null (empty state shown)
- **Store not hydrated**: items array is empty until hydrated (shows empty state)

## Edge Cases

- **Empty session**: items=[], selectedItem=null → shows "Select an item to preview"
- **Session switch**: Store updates → computed values recompute → UI updates
- **Item deleted**: If selectedItem's id no longer in store → selectedItem becomes null
- **Rapid selection**: useCallback ensures stable reference, store handles deduplication

## External Dependencies

- `useSessionStore` - Zustand store (already used by Sidebar)
- `useDataLoader` - Custom hook (already used by Sidebar)
- No new API calls - all data comes from existing store
