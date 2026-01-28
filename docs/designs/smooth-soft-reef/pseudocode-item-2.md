# Pseudocode: Item 2 - Add item drawer toggle to mobile UI

## Component: PreviewTab

### Empty State Render Logic

```
1. Check if selectedItem is null
   - If null: render empty state
   - If not null: render preview content (existing behavior)

2. Inside empty state div:
   a. Render existing icon (placeholder image)
   b. Render existing "Select an item to preview" text
   c. Render existing "Browse items from the drawer below" subtext
   d. NEW: Render "Browse Items" button
      - onClick: call setIsDrawerOpen(true)
      - Style: match existing accent button pattern
```

### Button Click Handler

```
1. User clicks "Browse Items" button
2. Call setIsDrawerOpen(true)
3. ItemDrawer slides up (existing behavior)
4. User selects item from drawer
5. handleItemSelect is called (existing behavior)
6. Drawer closes, preview shows selected item
```

## Error Handling

N/A - This is a pure UI addition with no error conditions:
- No async operations
- No external API calls
- No data validation needed
- Button simply toggles existing state

## Edge Cases

| Case | Behavior |
|------|----------|
| No items available | Empty state shows, button opens empty drawer (existing UX) |
| Items exist but none selected | Empty state shows with button (new behavior) |
| Item already selected | Top bar shows "Browse" button instead (existing) |
| Rapid button clicks | State toggle is idempotent (already open = no-op) |

## External Dependencies

None - uses only existing component state (`isDrawerOpen`) and existing child component (`ItemDrawer`).

## Verification Checklist

- [x] Every function from Interface has pseudocode (button click → setIsDrawerOpen)
- [x] Error handling is explicit (N/A - no errors possible)
- [x] Edge cases are identified (4 cases documented)
- [x] External dependencies are noted (none)
