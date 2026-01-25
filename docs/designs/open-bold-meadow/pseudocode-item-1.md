# Pseudocode: Item 1 - Auto-start terminals

## EmbeddedTerminal Component

```
1. Receive props: { config, sessionName, className }

2. Build iframe URL:
   - Start with config.wsUrl
   - Replace 'ws://' with 'http://' (or 'wss://' with 'https://')
   - Remove '/ws' suffix
   - If sessionName provided:
     - Append '?arg=' + encodeURIComponent(sessionName)

3. Render:
   - Container div with flex column layout, full height
   - Single iframe with:
     - src = computed iframeUrl
     - flex: 1 to fill container
     - no border
     - dark background (#1e1e1e)
     - title="Terminal" for accessibility
```

**Error Handling:**
- Invalid wsUrl format: Browser will show error in iframe (acceptable)
- ttyd not running: iframe shows connection error (acceptable)
- No explicit error handling needed in component

**Edge Cases:**
- sessionName is undefined → no query param, ttyd creates anonymous session
- sessionName contains special chars → encodeURIComponent handles it
- Multiple tabs with same sessionName → ttyd handles (attaches to same tmux)

---

## Removed Code

The following code is REMOVED (no pseudocode needed):

```
REMOVE:
- const [isStarted, setIsStarted] = useState(false)
- const startTerminal = useCallback(() => { setIsStarted(true) }, [])
- Conditional rendering based on isStarted
- "Start Terminal" button
- Placeholder div with data-testid="terminal-container"
```

**Rationale:**
- Simplifies component to pure render
- Eliminates state that caused remount issues
- Terminal starts immediately on mount
