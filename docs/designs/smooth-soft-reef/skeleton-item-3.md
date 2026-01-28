# Skeleton: Item 3

## Add terminal button to terminal tab

### Task Graph

```yaml
tasks:
  - id: item3-terminaltab-props
    file: ui/src/components/mobile/TerminalTab.tsx
    action: modify
    description: Add onCreateTerminal prop to TerminalTabProps interface
    depends: []
    
  - id: item3-terminaltab-button
    file: ui/src/components/mobile/TerminalTab.tsx
    action: modify
    description: Add New Terminal button to empty state
    depends: [item3-terminaltab-props]
    
  - id: item3-mobilelayout-handler
    file: ui/src/components/mobile/MobileLayout.tsx
    action: modify
    description: Add handleCreateTerminal function and pass to TerminalTab
    depends: [item3-terminaltab-props]
```

### Stub Code

#### ui/src/components/mobile/TerminalTab.tsx

```typescript
// Update interface
interface TerminalTabProps {
  terminalId: string | null;
  onCreateTerminal?: () => void;  // ADD THIS
}

// Update component signature
export function TerminalTab({ terminalId, onCreateTerminal }: TerminalTabProps) {
  if (!terminalId) {
    return (
      <div className="empty-state">
        {/* Existing empty state content */}
        <p>No active terminal</p>
        
        {/* ADD: New Terminal button */}
        {onCreateTerminal && (
          <Button variant="accent" onClick={onCreateTerminal}>
            New Terminal
          </Button>
        )}
      </div>
    );
  }
  
  // ... existing terminal rendering
}
```

#### ui/src/components/mobile/MobileLayout.tsx

```typescript
// ADD: Handler function
const handleCreateTerminal = async () => {
  // TODO: Create terminal via API/WebSocket
  // TODO: Update terminalId state
  // TODO: Switch to terminal tab
  throw new Error('Not implemented');
};

// UPDATE: Pass to TerminalTab
<TerminalTab 
  terminalId={terminalId}
  onCreateTerminal={handleCreateTerminal}  // ADD THIS
/>
```

### Verification Checklist

- [x] All files from interface listed with tasks
- [x] Task dependencies form valid DAG
- [x] Stubs show where modifications go
- [x] 3 tasks - appropriate granularity
