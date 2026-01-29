# Session: slow-tall-oasis

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** 
- Items 1 & 2 designed together as "Dual-Channel Status Sync"
- WebSocket = primary real-time channel, Polling = fallback every 5s

---

## Work Items

### Item 1: Update GUI status when a skill is completed
**Type:** code
**Status:** documented

**Problem/Goal:**
GUI status updates are delayed or inconsistent when skills complete. The WebSocket broadcast happens but updates don't reliably appear in the UI. Root cause unknown - needs investigation across broadcast, receive, and render layers.

**Approach:**
1. Add logging/debugging to trace WebSocket update path (broadcast → receive → render)
2. Fix any identified issues in the WebSocket flow
3. Add periodic polling as fallback for resilience (combines with Item 2)

**Success Criteria:**
- GUI updates immediately when skill completes (< 1 second)
- If WebSocket fails, polling picks up changes within poll interval
- No stale status displayed

**Decisions:**
- Fix WebSocket AND add polling for maximum robustness

---

### Item 2: GUI periodically checks status
**Type:** code
**Status:** documented

**Problem/Goal:**
The GUI should periodically poll/check the session status to stay in sync, serving as a fallback when WebSocket updates are missed.

**Approach:**
- Poll session state every 5 seconds
- Use existing `get_session_state` API endpoint
- Only update store if state has changed (avoid unnecessary re-renders)

**Success Criteria:**
- GUI stays in sync even if WebSocket connection drops
- No unnecessary re-renders from unchanged state
- Polling stops when session is inactive/closed

**Decisions:**
- 5 second polling interval
- Always poll when a session is selected (not just during collab or when WebSocket disconnects)

---

### Item 3: Fix terminal resize/display issues with xterm.js fit addon
**Type:** bugfix
**Status:** documented

**Problem/Goal:**
Terminal display shows content corruption and disappearing text when resizing. Related to xterm.js not properly propagating resize events.

**Root Cause Analysis:**
The FitAddon IS installed and configured (`@xterm/addon-fit@^0.11.0`), but there are **timing issues between visibility changes and FitAddon measurements**.

**Identified Gaps:**
1. **display:none prevents accurate fit calculations** - When tabs hidden with `display: none`, FitAddon cannot calculate correct dimensions
2. **Race condition** - `safeFit()` is called in same frame as visibility change, before DOM layout settles
3. **IntersectionObserver threshold too low** - Fires at 10% visibility, too early for accurate measurements
4. **No dimension validation** - `fit()` called even when container has zero dimensions

**Affected Files:**
- `ui/src/components/terminal/XTermTerminal.tsx` (lines 62-85: safeFit function)
- `ui/src/components/terminal/TerminalTabsContainer.tsx` (line 93: display:none)
- `ui/src/components/mobile/TerminalTab.tsx` (line 200: display:none)

**Proposed Fix:**
1. **Add dimension validation** - In `safeFit()`, check container has non-zero width/height before calling `fit()`
2. **Use double RAF** - Change from single RAF to two consecutive RAFs to ensure DOM layout settles
3. **Increase IntersectionObserver threshold** - Change from `0.1` to `1.0` (fully visible)
4. **Add explicit resize on tab activation** - Trigger resize from parent component state change, not just IntersectionObserver

**Success Criteria:**
- Terminal content remains intact when resizing window
- No text corruption or disappearing content
- Terminal dimensions properly sync with container size

**Decisions:**
- Use xterm.js fit addon for resize handling

---

## Diagrams
(auto-synced)

---

## Design Sections

### Section 1: useSessionPolling Hook ✓

Create a new React hook `ui/src/hooks/useSessionPolling.ts`:

```typescript
export function useSessionPolling(
  project: string | null,
  session: string | null,
  intervalMs = 5000
) {
  const { collabState, setCollabState } = useSession();
  
  useEffect(() => {
    if (!project || !session) return;
    
    const poll = async () => {
      const response = await fetch(
        `/api/session-state?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`
      );
      const newState = await response.json();
      
      // Only update if state changed (compare lastActivity)
      if (newState.lastActivity !== collabState?.lastActivity) {
        setCollabState(newState);
      }
    };
    
    const interval = setInterval(poll, intervalMs);
    poll(); // Initial fetch
    
    return () => clearInterval(interval);
  }, [project, session, intervalMs]);
}
```

**Key points:**
- Polls every 5 seconds when session is selected
- Compares `lastActivity` to avoid unnecessary re-renders
- Cleans up interval on unmount or session change

---

### Section 2: Hook Integration in App.tsx ✓

Add the polling hook to `ui/src/App.tsx`:

```typescript
// In App component, after existing hooks
const { currentSession } = useSession();

// Add polling for session state
useSessionPolling(
  currentSession?.project ?? null,
  currentSession?.name ?? null,
  5000
);
```

The hook runs alongside the existing WebSocket handler. Both channels write to the same `sessionStore`:

- **WebSocket**: Instant updates when `session_state_updated` message arrives
- **Polling**: Catches any missed updates every 5 seconds

No changes needed to the WebSocket handler - it continues working as before. The polling hook is purely additive.

---

### Section 3: Terminal Fit Addon Setup ✓

In the terminal component (likely `ui/src/components/mobile/TerminalTab.tsx` or similar):

```typescript
import { FitAddon } from '@xterm/addon-fit';

// During terminal initialization
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

// After terminal opens and container is visible
fitAddon.fit();

// On window/container resize
const handleResize = () => {
  fitAddon.fit();
};

window.addEventListener('resize', handleResize);

// Use ResizeObserver for container size changes
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
});
resizeObserver.observe(containerRef.current);
```

**Key points:**
- `FitAddon.fit()` calculates correct cols/rows based on container size
- Must be called after terminal is visible (not during initial render)
- Both window resize and container resize trigger fit

---

### Section 4: PTY Resize Propagation ✓

After `fitAddon.fit()`, propagate new dimensions to PTY backend:

```typescript
// Terminal onResize callback
terminal.onResize(({ cols, rows }) => {
  // Send resize message to backend via WebSocket
  ws.send(JSON.stringify({
    type: 'terminal_resize',
    terminalId: terminalId,
    cols: cols,
    rows: rows
  }));
});
```

Backend handler (in WebSocket message handler):

```typescript
case 'terminal_resize': {
  const { terminalId, cols, rows } = message;
  const pty = terminals.get(terminalId);
  if (pty) {
    pty.resize(cols, rows);
  }
  break;
}
```

**Key points:**
- xterm.js fires `onResize` after fit calculates new dimensions
- WebSocket sends cols/rows to backend
- Backend calls `pty.resize()` to propagate to the actual process
- This triggers SIGWINCH in the child process