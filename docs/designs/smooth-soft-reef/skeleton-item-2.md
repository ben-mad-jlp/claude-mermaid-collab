# Skeleton: Item 2 - Add item drawer toggle to mobile UI

## Planned Files

- [ ] `ui/src/components/mobile/PreviewTab.tsx` - **MODIFY** (not create) - Add button to empty state

**Note:** This is a modification to an existing file, not a new file creation.

## File Changes

### Modification: ui/src/components/mobile/PreviewTab.tsx

**Location:** Lines 141-166 (empty state div)

**Current code:**
```tsx
{/* Empty state - show prompt to select an item */}
<div
  data-testid="preview-empty-state"
  className="flex items-center justify-center h-full"
>
  <div className="text-center">
    <svg ... />
    <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">
      Select an item to preview
    </p>
    <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
      Browse items from the drawer below
    </p>
  </div>
</div>
```

**Modified code:**
```tsx
{/* Empty state - show prompt to select an item */}
<div
  data-testid="preview-empty-state"
  className="flex items-center justify-center h-full"
>
  <div className="text-center">
    <svg ... />
    <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">
      Select an item to preview
    </p>
    <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
      Browse items from the drawer below
    </p>
    {/* NEW: Browse Items button */}
    <button
      data-testid="preview-browse-items-button"
      onClick={() => setIsDrawerOpen(true)}
      className="mt-4 px-4 py-2 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 dark:bg-accent-600 dark:hover:bg-accent-700 rounded-lg transition-colors"
    >
      Browse Items
    </button>
  </div>
</div>
```

## Task Dependency Graph

```yaml
tasks:
  - id: preview-tab-button
    files: [ui/src/components/mobile/PreviewTab.tsx]
    tests: [ui/src/components/mobile/PreviewTab.test.tsx, ui/src/components/mobile/__tests__/PreviewTab.test.tsx]
    description: Add Browse Items button to empty state
    parallel: true
```

## Execution Order

**Wave 1 (parallel-safe):**
- `preview-tab-button` - Single file modification with no dependencies

## Verification Checklist

- [x] All files from Interface are documented (1 file)
- [x] File paths match exactly (`ui/src/components/mobile/PreviewTab.tsx`)
- [x] All types are defined (no new types needed)
- [x] All function signatures present (uses existing `setIsDrawerOpen`)
- [x] Changes match pseudocode (button onClick → setIsDrawerOpen(true))
- [x] Dependency graph covers all files (1 task, 1 file)
- [x] No circular dependencies (single task)
