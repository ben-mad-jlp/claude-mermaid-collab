# Pseudocode: Item 11 - Fix Split Bar Jumping

## [APPROVED]

## File: ui/src/components/layout/SplitPane.tsx

### Add Drag State Tracking

```
FUNCTION SplitPane({ primaryContent, secondaryContent, defaultSizes }):
  # Add state to track drag
  [isDragging, setIsDragging] = useState(false)
  
  # Drag handlers
  handleDragStart = () => setIsDragging(true)
  handleDragEnd = () => setIsDragging(false)
```

### Connect to PanelResizeHandle

```
# Check if library supports onDragging callback
IF library has onDragging:
  <PanelResizeHandle
    onDragging={(dragging) => setIsDragging(dragging)}
  />

# Fallback to mouse events
ELSE:
  <PanelResizeHandle
    onMouseDown={handleDragStart}
    onMouseUp={handleDragEnd}
    onMouseLeave={handleDragEnd}
  />
```

### Disable Pointer Events During Drag

```
FUNCTION renderPanel(content, isDragging):
  # Apply pointer-events-none during drag to prevent content interference
  panelClass = "w-full h-full overflow-hidden"
  
  IF isDragging:
    panelClass += " pointer-events-none select-none"
  
  RETURN (
    <Panel>
      <div className={panelClass}>
        {content}
      </div>
    </Panel>
  )
```

### Remove CSS Transition Conflicts

```
# Check for and remove transitions on panel dimensions
# These cause jumping during drag

PROBLEMATIC CSS (to remove or modify):
  .panel {
    transition: width 0.2s;  /* REMOVE - causes jumping */
    transition: flex 0.2s;   /* REMOVE - causes jumping */
  }

SAFE CSS:
  .panel {
    transition: background-color 0.2s;  /* OK - not dimension */
  }
```

### Full Component Structure

```
FUNCTION SplitPane({ primaryContent, secondaryContent, defaultSizes }):
  [isDragging, setIsDragging] = useState(false)
  
  contentClass = isDragging 
    ? "w-full h-full overflow-hidden pointer-events-none select-none"
    : "w-full h-full overflow-hidden"
  
  RETURN (
    <PanelGroup direction="horizontal" defaultSizes={defaultSizes}>
      <Panel>
        <div className={contentClass}>
          {primaryContent}
        </div>
      </Panel>
      
      <PanelResizeHandle
        className="w-1 bg-gray-300 hover:bg-blue-500 cursor-col-resize"
        onDragging={setIsDragging}
      />
      
      <Panel>
        <div className={contentClass}>
          {secondaryContent}
        </div>
      </Panel>
    </PanelGroup>
  )
```

### Debugging Steps

```
IF still jumping after changes:
  1. Check for CSS transitions:
     - Inspect panel elements in DevTools
     - Look for transition properties on width/flex
  
  2. Check for re-renders during drag:
     - Add console.log in render
     - Should not re-render content during drag
  
  3. Check library version:
     - Current: react-resizable-panels@0.0.56
     - Consider upgrade to 2.x if issues persist
  
  4. Check Mermaid diagram re-rendering:
     - Mermaid may re-render on container resize
     - Wrap in memo or debounce resize events
```

## Verification
- [ ] isDragging state tracked
- [ ] Panel content has pointer-events-none during drag
- [ ] No CSS transitions on panel dimensions
- [ ] Smooth drag without jumping
- [ ] Works with Mermaid content in panels
