# Interface: Item 8 - Move Clear Button, Remove Top Chat Bar

## File Structure
- `ui/src/components/ChatBar.tsx` - Remove (DELETE)
- `ui/src/components/InputControls.tsx` - Add clear button (MODIFY)
- `ui/src/components/WorkspacePanel.tsx` - Remove ChatBar usage (MODIFY)

## Component Changes

### Remove ChatBar
```typescript
// DELETE: ui/src/components/ChatBar.tsx
// This component is removed entirely
```

### Modify InputControls

```typescript
// ui/src/components/InputControls.tsx
interface InputControlsProps {
  onSend: (message: string) => void;
  onClear: () => void;  // NEW: clear callback
  disabled?: boolean;
}
```

## Layout Changes

Before:
```
┌─────────────────────┐
│ ChatBar (header)    │  ← REMOVE
├─────────────────────┤
│ Message Area        │
├─────────────────────┤
│ Input + Send Button │
└─────────────────────┘
```

After:
```
┌─────────────────────┐
│ Message Area        │
├─────────────────────┤
│ [Clear] Input [Send]│  ← Clear button added
└─────────────────────┘
```

## Button Placement
- Clear button: Left of input field
- Send button: Right of input field (existing)
- Icons or text labels based on design preference
