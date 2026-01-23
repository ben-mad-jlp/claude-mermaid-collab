# Pseudocode: Item 4
## Move render_ui drawer to adjustable panel on right side

[APPROVED]

---

### Step 1: Create ChatPanel Component

```
READ ui/src/components/chat-drawer/ChatDrawer.tsx

CREATE ui/src/components/chat-drawer/ChatPanel.tsx:

  1. Copy ChatDrawer content as base
  
  2. Update component name and interface:
     - RENAME: ChatDrawer → ChatPanel
     - REMOVE: isOpen prop
     - REMOVE: onClose prop
     - ADD: className?: string prop
  
  3. Remove overlay:
     - DELETE: overlay div (the one with bg-black/20)
  
  4. Remove fixed positioning from container:
     - DELETE: "fixed left-0 top-0 bottom-0"
     - DELETE: "z-40"
     - DELETE: "transition-transform duration-300 ease-out"
     - DELETE: translate-x conditional classes
  
  5. Update container classes:
     - KEEP: "flex flex-col"
     - KEEP: "bg-white dark:bg-gray-900"
     - CHANGE: "border-r" → "border-l" (now on left edge of panel)
     - ADD: "h-full"
     - REMOVE: width classes (SplitPane controls width)
  
  6. Remove close button from header:
     - DELETE: close button onClick handler
     - DELETE: close button JSX
     - OR KEEP for minimize functionality (optional)
  
  7. Export:
     - export const ChatPanel: React.FC<ChatPanelProps>
     - export default ChatPanel
```

---

### Step 2: Update App.tsx Layout

```
READ ui/src/App.tsx

1. Add import:
   - ADD: import { SplitPane } from './components/layout/SplitPane'
   - ADD: import { ChatPanel } from './components/chat-drawer/ChatPanel'

2. Remove ChatDrawer state:
   - DELETE: const [isChatOpen, setIsChatOpen] = useState(false)
   - DELETE: any setChatOpen calls

3. Remove ChatToggle and ChatDrawer:
   - DELETE: <ChatToggle onClick={...} />
   - DELETE: <ChatDrawer isOpen={...} onClose={...} />

4. Wrap main content with SplitPane:
   
   FIND current structure:
     <div className="flex flex-1 min-h-0 overflow-hidden">
       <Sidebar className="h-full" />
       <main className="flex-1 min-h-0 overflow-hidden">
         {renderMainContent()}
       </main>
     </div>
   
   REPLACE WITH:
     <div className="flex flex-1 min-h-0 overflow-hidden">
       <Sidebar className="h-full" />
       <SplitPane
         primaryContent={
           <main className="flex-1 min-h-0 overflow-hidden">
             {renderMainContent()}
           </main>
         }
         secondaryContent={<ChatPanel />}
         direction="horizontal"
         defaultPrimarySize={75}
         minPrimarySize={50}
         minSecondarySize={20}
         storageId="main-chat-split"
       />
     </div>
```

---

### Step 3: Update/Remove ChatToggle

```
OPTION A (Remove entirely):
  - DELETE: ui/src/components/chat-drawer/ChatToggle.tsx
  - UPDATE: ui/src/components/chat-drawer/index.ts (remove export)

OPTION B (Keep for future use):
  - KEEP file but remove from App.tsx
```

---

### Step 4: Update Exports

```
READ ui/src/components/chat-drawer/index.ts

UPDATE exports:
  - ADD: export { ChatPanel } from './ChatPanel'
  - KEEP or REMOVE: ChatDrawer export based on decision
  - KEEP or REMOVE: ChatToggle export based on decision
```

---

### Error Handling

- SplitPane import fails: Verify component exists at expected path
- Layout breaks on small screens: Ensure minSecondarySize is reasonable
- Messages don't scroll: Verify messagesEndRef still works in new structure

### Edge Cases

- Very long messages: Should still scroll correctly
- Empty message list: Should show "No messages" state
- Window resize: SplitPane should handle gracefully
- Storage persistence: First load uses defaultPrimarySize, subsequent uses stored value

### Dependencies

- SplitPane component from ui/src/components/layout/SplitPane.tsx
- useChatStore hook for message state
- AIUIRenderer for rendering UI components
