# Skeleton: Item 5 - Terminal tmux clipboard feature

## Planned Files

| File | Purpose |
|------|---------|
| `ui/src/components/terminal/TerminalTabBar.tsx` | Modified to add copy button |

## Task Dependency Graph

```yaml
tasks:
  - id: 5-copy-button
    files: [ui/src/components/terminal/TerminalTabBar.tsx]
    description: Add copy button to terminal tabs that copies tmux attach command to clipboard
    parallel: true
```

## Execution Order

1. **Single task:** 5-copy-button (no dependencies)

## Changes Required

### TerminalTabBar.tsx Modifications

1. **Add state for tracking copied tab:**
```typescript
const [copiedId, setCopiedId] = useState<string | null>(null);
```

2. **Add copy handler:**
```typescript
const handleCopy = async (tabId: string, tmuxSession: string) => {
  const command = `tmux attach -t ${tmuxSession}`;
  await navigator.clipboard.writeText(command);
  setCopiedId(tabId);
  setTimeout(() => setCopiedId(null), 2000);
};
```

3. **Add copy button in SortableTab (between name and close button):**
```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    handleCopy(tab.id, tab.tmuxSession);
  }}
  title="Copy tmux attach command"
  className="opacity-0 group-hover:opacity-100 hover:text-blue-500 transition-opacity"
>
  {copiedId === tab.id ? <CheckIcon className="w-3.5 h-3.5 text-green-500" /> : <CopyIcon className="w-3.5 h-3.5" />}
</button>
```

4. **Import icons:**
```typescript
import { CopyIcon, CheckIcon } from 'lucide-react'; // or similar icon library
```

## Notes

- Button appears on hover (opacity-0 group-hover:opacity-100)
- stopPropagation prevents tab selection when clicking copy
- 2-second feedback showing checkmark before reverting to copy icon
- Uses existing tab.tmuxSession property (already available in TerminalSession type)
- Follow existing CodeBlock.tsx clipboard pattern
