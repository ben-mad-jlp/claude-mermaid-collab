# Interface: Item 11 - Fix Split Bar Jumping

## [APPROVED]

## File Structure
- `ui/src/components/layout/SplitPane.tsx` - Add drag state handling

## Type Definitions

```typescript
// No new types needed
```

## Function Signatures

```typescript
// ui/src/components/layout/SplitPane.tsx

// Add state for tracking drag
const [isDragging, setIsDragging] = useState(false);

// Add handlers
const handleDragStart = () => setIsDragging(true);
const handleDragEnd = () => setIsDragging(false);
```

## Changes

### 1. Track drag state

```typescript
<PanelResizeHandle
  onDragging={(isDragging) => setIsDragging(isDragging)}
  // or if library doesn't support:
  onMouseDown={handleDragStart}
  onMouseUp={handleDragEnd}
>
```

### 2. Disable pointer events on content during drag

```typescript
<Panel>
  <div className={`w-full h-full overflow-hidden ${isDragging ? 'pointer-events-none select-none' : ''}`}>
    {primaryContent}
  </div>
</Panel>
```

### 3. Remove potential CSS conflicts

Check for and remove any `transition` properties on panel width/height.

## Verification
- [ ] Drag state tracked
- [ ] Panel content has pointer-events-none during drag
- [ ] No CSS transitions on panel dimensions
- [ ] Smooth drag without jumping
