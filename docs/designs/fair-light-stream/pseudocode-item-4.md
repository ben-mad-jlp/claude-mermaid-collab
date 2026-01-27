# Pseudocode: Item 4 - Terminal selection without copying (xterm.js)

### XTermTerminal component

```
ON MOUNT (useEffect):

1. IF terminalRef.current is null, return early

2. Create Terminal instance:
   - const term = new Terminal({
       scrollback: 10000,
       rightClickSelectsWord: false,
       cursorBlink: true,
       theme: { background: '#1e1e1e', foreground: '#d4d4d4' }
     })

3. Store term reference: termRef.current = term

4. Open terminal in DOM container:
   - term.open(terminalRef.current)

5. Create and load FitAddon:
   - const fitAddon = new FitAddon()
   - term.loadAddon(fitAddon)
   - fitAddon.fit()

6. Connect to ttyd via WebSocket:
   - const ws = new WebSocket(wsUrl)
   - const attachAddon = new AttachAddon(ws)
   - term.loadAddon(attachAddon)

7. Add contextmenu handler for right-click copy:
   - terminalRef.current.addEventListener('contextmenu', handleContextMenu)

8. Add resize observer for responsive sizing:
   - new ResizeObserver(() => fitAddon.fit())

9. Call onReady callback if provided

10. CLEANUP on unmount:
    - term.dispose()
    - ws.close()
    - Remove event listeners
```

### handleContextMenu(e, term)

```
1. Prevent default browser context menu:
   - e.preventDefault()

2. Get selected text from terminal:
   - const selectedText = term.getSelection()

3. IF selectedText is not empty:
   - Copy to clipboard:
     navigator.clipboard.writeText(selectedText)
       .then(() => console.debug('Copied to clipboard'))
       .catch(err => console.error('Copy failed:', err))
```

### EmbeddedTerminal changes

```
BEFORE: Render iframe with src={ttydUrl}
AFTER:  Render <XTermTerminal wsUrl={wsUrl} />

Note: wsUrl is derived from existing ttyd configuration
      e.g., ws://localhost:7681/ws or wss://... for secure
```

**Error Handling:**
- WebSocket connection failure: AttachAddon handles reconnection
- Clipboard write failure: Logged, user sees no visual feedback
- Terminal creation failure: Component won't render (React error boundary)

**Edge Cases:**
- No text selected on right-click: No clipboard action (empty string check)
- Browser doesn't support Clipboard API: Catch and log error
- Window resize: ResizeObserver triggers fitAddon.fit()
- Component unmount during connection: Cleanup in useEffect return

**Dependencies:**
- @xterm/xterm (Terminal)
- @xterm/addon-attach (AttachAddon)
- @xterm/addon-fit (FitAddon)
- navigator.clipboard (Browser API)
