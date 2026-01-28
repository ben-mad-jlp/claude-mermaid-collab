# Interface Definition: Item 2

## Add item drawer toggle to mobile UI

### File Structure

- `ui/src/components/mobile/PreviewTab.tsx` - **MODIFY** - Add button to empty state

### Type Definitions

No new types required. Uses existing:

```typescript
// From ui/src/types/index.ts
export interface Item {
  id: string;
  name: string;
  type: 'diagram' | 'document';
  content: string;
  lastModified: number;
}
```

### Function Signatures

No new functions. Modifying existing component:

```typescript
// ui/src/components/mobile/PreviewTab.tsx
// Existing interface (unchanged)
export interface PreviewTabProps {
  selectedItem: Item | null;
  items: Item[];
  onItemSelect: (item: Item) => void;
  className?: string;
}
```

### Component Interactions

The "Browse Items" button will call the existing `setIsDrawerOpen(true)` function, same as the "Browse" button in the top bar (line 119).

### Implementation Details

**Location:** Lines 141-166 (empty state div)

**Change:** Add a button inside the empty state that opens the drawer:

```tsx
<button
  data-testid="preview-browse-items-button"
  onClick={() => setIsDrawerOpen(true)}
  className="mt-4 px-4 py-2 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 dark:bg-accent-600 dark:hover:bg-accent-700 rounded-lg transition-colors"
>
  Browse Items
</button>
```

### Verification Checklist

- [x] All files from design are listed (1 file)
- [x] All public interfaces have signatures (PreviewTabProps - unchanged)
- [x] Parameter types are explicit (no `any`)
- [x] Return types are explicit (React.FC)
- [x] Component interactions are documented (calls setIsDrawerOpen)
