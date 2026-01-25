# Pseudocode: Item 5 - Terminal tmux clipboard feature

## TerminalTabBar Changes

```
FUNCTION TerminalTabBar({ tabs, activeTabId, ... }):
  [copiedId, setCopiedId] = useState(null)
  
  handleCopy(tabId, tmuxSession):
    command = `tmux attach -t ${tmuxSession}`
    await navigator.clipboard.writeText(command)
    setCopiedId(tabId)
    setTimeout(() => setCopiedId(null), 2000)
  
  RETURN (
    FOR tab in tabs:
      <SortableTab
        tab={tab}
        isCopied={tab.id === copiedId}
        onCopy={() => handleCopy(tab.id, tab.tmuxSession)}
      />
  )
```

## SortableTab Copy Button Addition

```
FUNCTION SortableTab({ tab, isCopied, onCopy, onClose }):
  RETURN (
    <div className="tab">
      <span>{tab.name}</span>
      
      {/* NEW: Copy button */}
      <button onClick={(e) => { e.stopPropagation(); onCopy() }}
              title="Copy tmux attach command">
        {isCopied ? <CheckIcon green /> : <CopyIcon gray />}
      </button>
      
      {/* Existing: Close button */}
      <button onClick={onClose}><XIcon /></button>
    </div>
  )
```

## Error Handling

- Clipboard API fails: Log error, optionally show toast
- stopPropagation: Prevent tab selection when clicking copy
- Timer cleanup: Clear timeout on unmount
