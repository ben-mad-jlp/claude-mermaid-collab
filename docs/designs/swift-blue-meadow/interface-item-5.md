# Interface: Item 5 - Terminal tmux clipboard feature

## Interface Definition

### File Structure

- `ui/src/components/terminal/TerminalTabBar.tsx` - Modified to add copy button

### Type Definitions

No new types needed. Uses existing `TerminalSession` type which already includes `tmuxSession: string`.

### Component Changes

```typescript
// ui/src/components/terminal/TerminalTabBar.tsx

// Add to SortableTab component (inside each tab)
interface CopyButtonProps {
  tmuxSession: string;  // e.g., "mc-openboldmeadow-a1b2"
}

// New internal state
const [copiedId, setCopiedId] = useState<string | null>(null);
```

### Function Signatures

```typescript
// ui/src/components/terminal/TerminalTabBar.tsx

// Add to SortableTab or as utility
async function copyAttachCommand(tmuxSession: string): Promise<void> {
  const command = `tmux attach -t ${tmuxSession}`;
  await navigator.clipboard.writeText(command);
}

// Feedback handling
function handleCopy(tabId: string, tmuxSession: string): void {
  copyAttachCommand(tmuxSession);
  setCopiedId(tabId);
  setTimeout(() => setCopiedId(null), 2000);
}
```

### UI Addition

Add copy button inside each tab, between the tab name and close button:

```tsx
// In SortableTab render
<button
  onClick={(e) => {
    e.stopPropagation();
    handleCopy(tab.id, tab.tmuxSession);
  }}
  title="Copy tmux attach command"
  className="..."
>
  {copiedId === tab.id ? <CheckIcon /> : <CopyIcon />}
</button>
```

### Component Interactions

1. User clicks copy button on a terminal tab
2. `handleCopy` is called with tab ID and tmux session name
3. `copyAttachCommand` writes `tmux attach -t {session}` to clipboard
4. `copiedId` state updates to show checkmark
5. After 2 seconds, checkmark reverts to copy icon
