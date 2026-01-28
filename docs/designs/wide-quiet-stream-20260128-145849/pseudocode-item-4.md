# Pseudocode: Item 4 - Chat and Terminal Tabs

## ChatTab

```
1. Receive props: onRequestFocus, className

2. Get chat state from useChatStore:
   - messages, currentUI (for AI UI cards)

3. Get question state from useQuestionStore:
   - currentQuestion

4. Effect: Auto-switch to chat tab on AI UI arrival
   - Watch currentQuestion
   - When currentQuestion changes from null to non-null:
     - If onRequestFocus is defined: call onRequestFocus()

5. Render full-screen container:
   - flex flex-col flex-1
   - ChatPanel component fills entire container
     - Already handles:
       - Message list rendering
       - AI UI cards inline via MessageArea
       - Input controls at bottom
       - WebSocket message sending
```

**Error Handling:**
- ChatPanel already handles WebSocket errors internally
- Message send failures shown inline

**Edge Cases:**
- No messages yet: ChatPanel shows welcome/empty state
- Rapid AI UI arrivals: only switch once (currentQuestion is replaced, not queued)
- Tab switch while typing: input state preserved (ChatPanel stays mounted)

**Dependencies:**
- ChatPanel component (existing)
- useChatStore (Zustand)
- useQuestionStore (Zustand)

---

## TerminalTab

```
1. Receive props: className

2. Get terminal state:
   - Check if terminal session/connection exists
   - Use existing terminal hooks/stores

3. Render full-screen container:
   a. If terminal session exists:
      - Render Terminal component
      - Terminal fills flex-1 space
      - xterm addon-fit handles resize automatically
   
   b. Else (no terminal):
      - Render placeholder:
        - Centered message: "No active terminal"
        - Muted text: "Start a terminal session from desktop"

4. Effect: Trigger terminal fit on mount/resize
   - Call terminal.fit() when container size changes
   - xterm addon-fit handles this automatically via ResizeObserver
```

**Error Handling:**
- Terminal connection lost: xterm shows disconnect state
- WebSocket errors: handled by existing terminal component

**Edge Cases:**
- Terminal output while on different tab: buffered by xterm
- Switch to terminal tab: content appears immediately (mounted but hidden)
- Very fast output (build logs): xterm handles buffering

**Dependencies:**
- Terminal component (existing)
- @xterm/xterm
- @xterm/addon-fit

---

## MobileLayout Tab Rendering (Hidden State Preservation)

```
1. In MobileLayout, render all tabs in DOM:
   
   <div className="flex-1 relative">
     <div style={{ display: activeTab === 'preview' ? 'flex' : 'none' }} className="flex-1">
       <PreviewTab ... />
     </div>
     <div style={{ display: activeTab === 'chat' ? 'flex' : 'none' }} className="flex-1">
       <ChatTab onRequestFocus={() => setActiveTab('chat')} />
     </div>
     <div style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }} className="flex-1">
       <TerminalTab />
     </div>
   </div>

2. Benefits:
   - State preserved (no remount on tab switch)
   - Instant tab switching (no loading)
   - WebSocket connections maintained
   - Terminal buffer preserved
   - Chat scroll position preserved

3. Tradeoff:
   - All tabs render to DOM initially
   - Memory usage slightly higher
   - Acceptable for 3 tabs
```

**Error Handling:**
- If a tab component crashes: ErrorBoundary catches per-tab

**Edge Cases:**
- Initial mount: all tabs render once, only active is visible
- Tab switch animation: none (instant switch via display)