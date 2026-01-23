# Skeleton: Item 4
## Move render_ui drawer to adjustable panel on right side

[APPROVED]

## Planned Files

- [ ] `ui/src/components/chat-drawer/ChatPanel.tsx` - New component (based on ChatDrawer)
- [ ] `ui/src/App.tsx` - Modify layout to use SplitPane
- [ ] `ui/src/components/chat-drawer/index.ts` - Update exports

**Note:** Files are documented but NOT created yet. They will be created during implementation.

## File Contents

### Planned File: ui/src/components/chat-drawer/ChatPanel.tsx

```typescript
import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { AIUIRenderer } from '../ai-ui/renderer';

export interface ChatPanelProps {
  className?: string;
}

/**
 * ChatPanel Component
 *
 * Always-visible panel displaying chat messages and AI UI components.
 * Designed to be used within a SplitPane layout.
 */
export const ChatPanel: React.FC<ChatPanelProps> = ({ className }) => {
  const { messages, respondToMessage } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // TODO: Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    // Copy scroll logic from ChatDrawer
  }, [messages]);

  // TODO: Handle action from rendered components
  const handleAction = async (actionId: string, payload?: any) => {
    // Copy action handler from ChatDrawer
  };

  return (
    <div
      className={`
        flex flex-col h-full
        bg-white dark:bg-gray-900
        border-l border-gray-200 dark:border-gray-800
        ${className || ''}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Claude
        </h2>
        {/* TODO: No close button - panel is always visible */}
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* TODO: Copy message rendering from ChatDrawer */}
        {/* Empty state */}
        {/* Message list */}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer Status */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
        {/* TODO: Copy footer from ChatDrawer */}
      </div>
    </div>
  );
};

ChatPanel.displayName = 'ChatPanel';
```

**Status:** [ ] Will be created during implementation

### Modification: ui/src/App.tsx

**Add imports:**
```typescript
import { SplitPane } from './components/layout/SplitPane';
import { ChatPanel } from './components/chat-drawer/ChatPanel';
```

**Remove state:**
```typescript
// DELETE THIS LINE:
const [isChatOpen, setIsChatOpen] = useState(false);
```

**Replace layout structure:**
```typescript
// FIND:
<div className="flex flex-1 min-h-0 overflow-hidden">
  <Sidebar className="h-full" />
  <main className="flex-1 min-h-0 overflow-hidden">
    {renderMainContent()}
  </main>
</div>
<ChatToggle onClick={() => setChatOpen(!isChatOpen)} />
<ChatDrawer isOpen={isChatOpen} onClose={() => setChatOpen(false)} />

// REPLACE WITH:
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

**Status:** [ ] Will be modified during implementation

### Modification: ui/src/components/chat-drawer/index.ts

**Add export:**
```typescript
export { ChatPanel } from './ChatPanel';
export type { ChatPanelProps } from './ChatPanel';
```

**Status:** [ ] Will be modified during implementation

## Task Dependency Graph

```yaml
tasks:
  - id: create-chat-panel
    files: [ui/src/components/chat-drawer/ChatPanel.tsx]
    tests: [ui/src/components/chat-drawer/__tests__/ChatPanel.test.tsx]
    description: Create ChatPanel component based on ChatDrawer
    parallel: true

  - id: update-chat-exports
    files: [ui/src/components/chat-drawer/index.ts]
    description: Add ChatPanel to exports
    depends-on: [create-chat-panel]

  - id: update-app-layout
    files: [ui/src/App.tsx]
    tests: [ui/src/App.test.tsx]
    description: Replace ChatDrawer/ChatToggle with SplitPane+ChatPanel
    depends-on: [create-chat-panel]
```

## Execution Order

**Wave 1:**
- create-chat-panel

**Wave 2 (parallel):**
- update-chat-exports
- update-app-layout

## Verification

- [ ] ChatPanel.tsx exists with correct props interface
- [ ] ChatPanel has no fixed positioning classes
- [ ] ChatPanel has no overlay div
- [ ] App.tsx imports SplitPane and ChatPanel
- [ ] App.tsx no longer has isChatOpen state
- [ ] App.tsx no longer renders ChatToggle
- [ ] App.tsx no longer renders ChatDrawer
- [ ] SplitPane wraps main content and ChatPanel
- [ ] Panel is visible and resizable in browser
- [ ] Panel width persists on page reload
