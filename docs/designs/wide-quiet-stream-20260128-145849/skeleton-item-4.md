# Skeleton: Item 4 - Chat and Terminal Tabs

## Planned Files

- [ ] `ui/src/components/mobile/ChatTab.tsx` - Full-screen chat wrapper
- [ ] `ui/src/components/mobile/TerminalTab.tsx` - Full-screen terminal wrapper

**Note:** These files are documented but NOT created yet. They will be created during the implementation phase by executing-plans.

## File Contents

### Planned File: ui/src/components/mobile/ChatTab.tsx

```typescript
import React, { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQuestionStore } from '@/stores/questionStore';
import { ChatPanel } from '@/components/chat-drawer';

export interface ChatTabProps {
  onRequestFocus?: () => void;
  className?: string;
}

export const ChatTab: React.FC<ChatTabProps> = ({
  onRequestFocus,
  className = '',
}) => {
  // Get question state to detect AI UI arrival
  const { currentQuestion } = useQuestionStore(
    useShallow((state) => ({
      currentQuestion: state.currentQuestion,
    }))
  );
  
  // TODO: Auto-switch to chat tab when AI UI arrives
  useEffect(() => {
    // When currentQuestion changes from null to non-null, request focus
    // if (currentQuestion && onRequestFocus) {
    //   onRequestFocus();
    // }
  }, [currentQuestion, onRequestFocus]);
  
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* TODO: Render ChatPanel full-screen */}
      {/* ChatPanel already handles:
          - Message list with AI UI cards inline
          - Input controls at bottom
          - WebSocket message sending
      */}
      <ChatPanel className="h-full" />
    </div>
  );
};
```

**Status:** [ ] Will be created during implementation

---

### Planned File: ui/src/components/mobile/TerminalTab.tsx

```typescript
import React from 'react';
// TODO: Import terminal component (check actual path in codebase)
// import { Terminal } from '@/components/terminal/Terminal';

export interface TerminalTabProps {
  className?: string;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({
  className = '',
}) => {
  // TODO: Check if terminal session exists
  // const hasTerminal = /* check terminal state */;
  const hasTerminal = false; // placeholder
  
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {hasTerminal ? (
        // TODO: Render terminal component
        // <Terminal className="flex-1" />
        <div className="flex-1 bg-black text-green-400 p-4">
          Terminal placeholder
        </div>
      ) : (
        // Placeholder when no terminal
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="text-lg font-medium mb-2">No active terminal</div>
            <div className="text-sm">Start a terminal session from desktop</div>
          </div>
        </div>
      )}
    </div>
  );
};
```

**Status:** [ ] Will be created during implementation

## Task Dependency Graph

```yaml
tasks:
  - id: chat-tab
    files: [ui/src/components/mobile/ChatTab.tsx]
    tests: [ui/src/components/mobile/ChatTab.test.tsx, ui/src/components/mobile/__tests__/ChatTab.test.tsx]
    description: Full-screen chat wrapper with AI UI auto-switch
    parallel: true

  - id: terminal-tab
    files: [ui/src/components/mobile/TerminalTab.tsx]
    tests: [ui/src/components/mobile/TerminalTab.test.tsx, ui/src/components/mobile/__tests__/TerminalTab.test.tsx]
    description: Full-screen terminal wrapper
    parallel: true
```

## Execution Order

**Wave 1 (parallel):**
- chat-tab
- terminal-tab

(Both can be implemented in parallel - no dependencies between them)

## Verification

- [x] All files from Interface documented
- [x] File paths match exactly
- [x] All types defined (ChatTabProps, TerminalTabProps)
- [x] All function signatures present
- [x] TODO comments match pseudocode
- [x] Dependency graph covers all files
- [x] No circular dependencies