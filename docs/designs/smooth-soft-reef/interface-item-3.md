# Interface Definition: Item 3

## Add terminal button to terminal tab

### File Structure

- `ui/src/components/mobile/TerminalTab.tsx` - **MODIFY** - Add button in empty state
- `ui/src/components/mobile/MobileLayout.tsx` - **MODIFY** - Wire up onCreateTerminal callback

### Type Definitions

```typescript
// ui/src/components/mobile/TerminalTab.tsx

interface TerminalTabProps {
  terminalId: string | null;
  onCreateTerminal?: () => void;  // NEW: callback to create terminal
}
```

### Function Signatures

```typescript
// ui/src/components/mobile/TerminalTab.tsx
export function TerminalTab({ terminalId, onCreateTerminal }: TerminalTabProps): JSX.Element
```

```typescript
// ui/src/components/mobile/MobileLayout.tsx
// Add handler function
const handleCreateTerminal = async (): Promise<void> => {
  // Create new terminal session via API
}
```

### Component Interactions

1. `TerminalTab` receives `onCreateTerminal` prop from `MobileLayout`
2. When no terminal exists, empty state shows "New Terminal" button
3. Button click calls `onCreateTerminal()`
4. `MobileLayout` handles terminal creation (API call or WebSocket message)
5. After creation, `terminalId` prop updates and terminal connects

### UI Elements

```
Empty State Layout:
┌─────────────────────────────────────┐
│                                     │
│         📺 No active terminal       │
│                                     │
│         [  New Terminal  ]          │
│                                     │
└─────────────────────────────────────┘
```

### Verification Checklist

- [x] All files from design are listed (2 files)
- [x] All public interfaces have signatures
- [x] Parameter types are explicit (no `any`)
- [x] Return types are explicit
- [x] Component interactions are documented
