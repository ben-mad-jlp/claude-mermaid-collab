# Pseudocode: Item 3 - Preview Tab with Item Drawer

## PreviewTab

```
1. Receive props: selectedItem, items, onItemSelect

2. Initialize state: isDrawerOpen = false

3. Define handlers:
   - openDrawer: set isDrawerOpen = true
   - closeDrawer: set isDrawerOpen = false
   - handleItemSelect(item):
      a. Call onItemSelect(item)
      b. Close drawer

4. Render layout:
   a. If selectedItem is null:
      - Render empty state message
      - Auto-open drawer on mount (useEffect)
   
   b. Else render:
      - Top bar (compact):
        - Item type icon (diagram/document)
        - Item name (truncated)
        - "Browse" button → openDrawer
      
      - Preview content (flex-1):
        - If item.type === 'diagram':
          - Render MermaidPreview with item.content
          - Enable zoom/pan gestures
        - Else (document):
          - Render MarkdownPreview with item.content
          - Enable scroll

5. Render ItemDrawer:
   - isOpen = isDrawerOpen
   - items = items (from props)
   - selectedItemId = selectedItem?.id
   - onItemSelect = handleItemSelect
   - onClose = closeDrawer
```

**Error Handling:**
- Invalid item content: MermaidPreview shows parse error inline
- Empty content: show placeholder text

**Edge Cases:**
- Very long item names: truncate with ellipsis in top bar
- No items at all: drawer shows "No items in session" message
- Item deleted while viewing: selectedItem becomes null, show empty state

**Dependencies:**
- MermaidPreview component (existing)
- MarkdownPreview component (existing)

---

## ItemDrawer

```
1. Receive props: isOpen, onClose, items, selectedItemId, onItemSelect

2. Initialize state: searchQuery = ''

3. Compute filteredItems:
   - If searchQuery is empty: return items
   - Else: filter items where name includes searchQuery (case-insensitive)

4. If not isOpen: return null (don't render)

5. Render overlay structure:
   a. Backdrop (fixed, full screen, semi-transparent black)
      - onClick: onClose
   
   b. Sheet container (fixed, bottom, 60% height):
      - Drag handle at top (visual indicator)
      - Touch drag gesture:
        - Track deltaY during drag
        - If dragged down > 100px and released: onClose
        - Else: animate back to original position
   
   c. Search input:
      - Placeholder: "Search items..."
      - value = searchQuery
      - onChange: update searchQuery
   
   d. Scrollable item list:
      - For each item in filteredItems:
        - Render item card (simplified ItemCard)
        - Highlight if item.id === selectedItemId
        - onClick: onItemSelect(item)
      
      - If filteredItems is empty:
        - Show "No items found" message

6. Animate sheet:
   - On open: slide up from bottom
   - On close: slide down
```

**Error Handling:**
- Touch events not supported: fall back to click-only (backdrop click works)

**Edge Cases:**
- Keyboard open (on search focus): sheet may need to adjust position
- Very long list: virtualization not needed initially (< 100 items typical)
- Search while scrolled: reset scroll position to top on search change
- Rapid open/close: ensure animations don't conflict

**Dependencies:**
- ItemCard component (existing) or simplified version
- CSS animations (slide-up/down)