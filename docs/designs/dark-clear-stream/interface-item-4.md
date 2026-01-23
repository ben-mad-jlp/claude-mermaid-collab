# Interface Definition: Item 4
## Move render_ui drawer to adjustable panel on right side

[APPROVED]

### File Structure

Files to modify:
- `ui/src/App.tsx` - Main layout changes
- `ui/src/components/chat-drawer/ChatDrawer.tsx` → Rename/refactor to `ChatPanel.tsx`

Files to potentially remove:
- `ui/src/components/chat-drawer/ChatToggle.tsx` - No longer needed

### Type Definitions

#### ChatPanel Props (replacing ChatDrawer)

```typescript
// ui/src/components/chat-drawer/ChatPanel.tsx

export interface ChatPanelProps {
  // No isOpen/onClose - always visible
  className?: string;
}
```

#### App.tsx Layout Changes

```typescript
// Current state (to remove)
const [isChatOpen, setIsChatOpen] = useState(false);

// New state (none needed - panel always visible)
// Remove: isChatOpen state
// Remove: ChatToggle component
// Remove: ChatDrawer isOpen/onClose props
```

### Function Signatures

#### ChatPanel Component

```typescript
// ui/src/components/chat-drawer/ChatPanel.tsx

/**
 * ChatPanel Component
 * 
 * Always-visible panel displaying chat messages and AI UI components.
 * Designed to be used within a SplitPane layout.
 * 
 * Changes from ChatDrawer:
 * - Removed fixed positioning
 * - Removed overlay behavior
 * - Removed slide animation
 * - Removed isOpen/onClose props
 */
export const ChatPanel: React.FC<ChatPanelProps> = ({ className }) => {
  const { messages, respondToMessage } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll behavior (unchanged)
  useEffect(() => { ... }, [messages]);

  // Handle action (unchanged)
  const handleAction = async (actionId: string, payload?: any) => { ... };

  return (
    <div className={`flex flex-col h-full ${className || ''}`}>
      {/* Header */}
      {/* Messages Container */}
      {/* Footer Status */}
    </div>
  );
};
```

#### App.tsx Layout Structure

```typescript
// ui/src/App.tsx - renderMainContent or main layout

// Current structure:
<div className="flex flex-col h-screen">
  <Header />
  <div className="flex flex-1 min-h-0 overflow-hidden">
    <Sidebar className="h-full" />
    <main className="flex-1 min-h-0 overflow-hidden">
      {renderMainContent()}
    </main>
  </div>
  <ChatToggle onClick={() => setChatOpen(!isChatOpen)} />
  <ChatDrawer isOpen={isChatOpen} onClose={() => setChatOpen(false)} />
</div>

// New structure:
<div className="flex flex-col h-screen">
  <Header />
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
</div>
```

### Component Interactions

```
App.tsx
    |
    +-- Header
    +-- Sidebar
    +-- SplitPane
            |
            +-- primaryContent (main content area)
            |       |
            |       +-- renderMainContent()
            |
            +-- secondaryContent (chat panel)
                    |
                    +-- ChatPanel
                            |
                            +-- useChatStore (messages, respondToMessage)
                            +-- AIUIRenderer (for each message)
```

### CSS/Styling Changes

#### ChatPanel (vs ChatDrawer)

Remove:
- `fixed left-0 top-0 bottom-0` - No fixed positioning
- `z-40` - No z-index needed
- `transition-transform duration-300 ease-out` - No slide animation
- `translate-x-0 / -translate-x-full` - No slide states
- Overlay div - No background overlay

Keep:
- `flex flex-col` - Column layout
- `bg-white dark:bg-gray-900` - Background colors
- `border-l border-gray-200 dark:border-gray-800` - Left border (now visible always)
- Header, messages, footer structure

Add:
- `h-full` - Full height within SplitPane

### Verification Checklist

- [ ] ChatPanel component created (or ChatDrawer refactored)
- [ ] Fixed positioning removed
- [ ] Overlay removed
- [ ] isOpen/onClose props removed
- [ ] App.tsx uses SplitPane with ChatPanel as secondaryContent
- [ ] ChatToggle component removed from App.tsx
- [ ] Panel resize works via drag handle
- [ ] Panel width persists (storageId set)
- [ ] Minimum 20% width enforced
