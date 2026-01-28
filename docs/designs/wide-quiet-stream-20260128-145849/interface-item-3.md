# Interface Definition: Item 3 - Preview Tab with Item Drawer

## File Structure

- `ui/src/components/mobile/PreviewTab.tsx` - Full-screen preview container
- `ui/src/components/mobile/ItemDrawer.tsx` - Slide-up item selection sheet

## Type Definitions

```typescript
// ui/src/components/mobile/PreviewTab.tsx
export interface PreviewTabProps {
  /** Currently selected item (diagram or document) */
  selectedItem: Item | null;
  /** All available items for the drawer */
  items: Item[];
  /** Callback when an item is selected */
  onItemSelect: (item: Item) => void;
  /** Optional custom class name */
  className?: string;
}
```

```typescript
// ui/src/components/mobile/ItemDrawer.tsx
export interface ItemDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Callback to close the drawer */
  onClose: () => void;
  /** All available items to display */
  items: Item[];
  /** Currently selected item ID (for highlighting) */
  selectedItemId: string | null;
  /** Callback when an item is selected */
  onItemSelect: (item: Item) => void;
  /** Optional custom class name */
  className?: string;
}
```

## Function Signatures

```typescript
// ui/src/components/mobile/PreviewTab.tsx
export const PreviewTab: React.FC<PreviewTabProps>
// Internal state: isDrawerOpen: boolean (default: false)
// Renders:
//   - Compact top bar: item name, type icon, browse button
//   - Full-screen MermaidPreview or MarkdownPreview based on item.type
//   - ItemDrawer (slide-up sheet)
// If selectedItem is null: show "No item selected" and auto-open drawer
```

```typescript
// ui/src/components/mobile/ItemDrawer.tsx
export const ItemDrawer: React.FC<ItemDrawerProps>
// Internal state: searchQuery: string
// Renders:
//   - Backdrop overlay (tap to dismiss)
//   - Slide-up sheet (~60% screen height)
//   - Drag handle at top
//   - Search input
//   - Scrollable item list (filtered by search)
// Calls onItemSelect and onClose when item tapped
```

## Component Interactions

- `PreviewTab` is rendered by `MobileLayout` when `activeTab === 'preview'`
- `PreviewTab` manages drawer open/close state internally
- `PreviewTab` receives `selectedItem` and `items` from parent (via sessionStore)
- `ItemDrawer` filters items by search query and renders using `ItemCard` component
- When item selected in drawer, `PreviewTab.onItemSelect` is called, which calls parent's selectDiagramWithContent/selectDocumentWithContent
- `MermaidPreview` and `MarkdownPreview` components are reused from existing editors