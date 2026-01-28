# Skeleton: Item 3 - Preview Tab with Item Drawer

## Planned Files

- [ ] `ui/src/components/mobile/PreviewTab.tsx` - Full-screen preview container
- [ ] `ui/src/components/mobile/ItemDrawer.tsx` - Slide-up item selection sheet

**Note:** These files are documented but NOT created yet. They will be created during the implementation phase by executing-plans.

## File Contents

### Planned File: ui/src/components/mobile/PreviewTab.tsx

```typescript
import React, { useState, useEffect } from 'react';
import { MermaidPreview } from '@/components/editors/MermaidPreview';
import { MarkdownPreview } from '@/components/editors/MarkdownPreview';
import { ItemDrawer } from './ItemDrawer';
import type { Item } from '@/types';

export interface PreviewTabProps {
  selectedItem: Item | null;
  items: Item[];
  onItemSelect: (item: Item) => void;
  className?: string;
}

export const PreviewTab: React.FC<PreviewTabProps> = ({
  selectedItem,
  items,
  onItemSelect,
  className = '',
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  
  // TODO: Auto-open drawer if no item selected (useEffect)
  useEffect(() => {
    // if (!selectedItem && items.length > 0) setIsDrawerOpen(true);
  }, [selectedItem, items]);
  
  const handleItemSelect = (item: Item) => {
    // TODO: Call onItemSelect and close drawer
    onItemSelect(item);
    setIsDrawerOpen(false);
  };
  
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* TODO: Compact top bar */}
      <div className="flex items-center px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        {/* Item type icon */}
        {/* Item name (truncated) */}
        {/* Browse button -> setIsDrawerOpen(true) */}
      </div>
      
      {/* TODO: Preview content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {selectedItem ? (
          selectedItem.type === 'diagram' ? (
            // TODO: <MermaidPreview content={selectedItem.content} />
            <div>MermaidPreview placeholder</div>
          ) : (
            // TODO: <MarkdownPreview content={selectedItem.content} />
            <div>MarkdownPreview placeholder</div>
          )
        ) : (
          // TODO: Empty state
          <div className="flex items-center justify-center h-full text-gray-500">
            No item selected
          </div>
        )}
      </div>
      
      {/* TODO: ItemDrawer */}
      <ItemDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        items={items}
        selectedItemId={selectedItem?.id ?? null}
        onItemSelect={handleItemSelect}
      />
    </div>
  );
};
```

**Status:** [ ] Will be created during implementation

---

### Planned File: ui/src/components/mobile/ItemDrawer.tsx

```typescript
import React, { useState, useRef } from 'react';
import type { Item } from '@/types';

export interface ItemDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
  selectedItemId: string | null;
  onItemSelect: (item: Item) => void;
  className?: string;
}

export const ItemDrawer: React.FC<ItemDrawerProps> = ({
  isOpen,
  onClose,
  items,
  selectedItemId,
  onItemSelect,
  className = '',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);
  
  // TODO: Filter items by search query
  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  // TODO: Drag gesture handling for dismiss
  // Track touch start Y, current Y, apply transform
  // On release: if deltaY > 100, close; else animate back
  
  if (!isOpen) return null;
  
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      
      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`
          fixed bottom-0 left-0 right-0 z-50
          bg-white dark:bg-gray-800
          rounded-t-2xl
          h-[60vh]
          flex flex-col
          ${className}
        `}
      >
        {/* TODO: Drag handle */}
        <div className="flex justify-center py-2">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>
        
        {/* TODO: Search input */}
        <div className="px-4 pb-2">
          <input
            type="text"
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          />
        </div>
        
        {/* TODO: Item list */}
        <div className="flex-1 overflow-y-auto px-4">
          {filteredItems.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No items found
            </div>
          ) : (
            filteredItems.map(item => (
              <button
                key={item.id}
                onClick={() => onItemSelect(item)}
                className={`
                  w-full text-left p-3 rounded-lg mb-2
                  ${item.id === selectedItemId
                    ? 'bg-blue-100 dark:bg-blue-900'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'}
                `}
              >
                {/* TODO: Item icon, name, type badge */}
                <div className="font-medium">{item.name}</div>
                <div className="text-sm text-gray-500">{item.type}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
};
```

**Status:** [ ] Will be created during implementation

## Task Dependency Graph

```yaml
tasks:
  - id: item-drawer
    files: [ui/src/components/mobile/ItemDrawer.tsx]
    tests: [ui/src/components/mobile/ItemDrawer.test.tsx, ui/src/components/mobile/__tests__/ItemDrawer.test.tsx]
    description: Slide-up bottom sheet for item selection
    parallel: true

  - id: preview-tab
    files: [ui/src/components/mobile/PreviewTab.tsx]
    tests: [ui/src/components/mobile/PreviewTab.test.tsx, ui/src/components/mobile/__tests__/PreviewTab.test.tsx]
    description: Full-screen preview with item drawer
    depends-on: [item-drawer]
```

## Execution Order

**Wave 1 (parallel):**
- item-drawer

**Wave 2:**
- preview-tab (depends on item-drawer)

## Verification

- [x] All files from Interface documented
- [x] File paths match exactly
- [x] All types defined (PreviewTabProps, ItemDrawerProps)
- [x] All function signatures present
- [x] TODO comments match pseudocode
- [x] Dependency graph covers all files
- [x] No circular dependencies