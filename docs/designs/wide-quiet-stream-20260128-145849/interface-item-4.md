# Interface Definition: Item 4 - Chat and Terminal Tabs

## File Structure

- `ui/src/components/mobile/ChatTab.tsx` - Full-screen chat wrapper
- `ui/src/components/mobile/TerminalTab.tsx` - Full-screen terminal wrapper

## Type Definitions

```typescript
// ui/src/components/mobile/ChatTab.tsx
export interface ChatTabProps {
  /** Callback to switch to this tab (used by AI UI arrival) */
  onRequestFocus?: () => void;
  /** Optional custom class name */
  className?: string;
}
```

```typescript
// ui/src/components/mobile/TerminalTab.tsx
export interface TerminalTabProps {
  /** Optional custom class name */
  className?: string;
}
```

## Function Signatures

```typescript
// ui/src/components/mobile/ChatTab.tsx
export const ChatTab: React.FC<ChatTabProps>
// Renders:
//   - Full-screen container (flex-1)
//   - ChatPanel component (reused from chat-drawer)
// ChatPanel already handles:
//   - Message list with AI UI cards inline
//   - Input controls
//   - WebSocket message sending
// On AI UI card arrival, ChatPanel's parent (MobileLayout) auto-switches to this tab
```

```typescript
// ui/src/components/mobile/TerminalTab.tsx
export const TerminalTab: React.FC<TerminalTabProps>
// Renders:
//   - Full-screen container (flex-1)
//   - Terminal component with xterm (reuse existing)
// If no terminal session active: show placeholder with "No active terminal" message
// xterm addon-fit handles auto-resize
```

## Component Interactions

- `ChatTab` is rendered by `MobileLayout` when `activeTab === 'chat'`
- `TerminalTab` is rendered by `MobileLayout` when `activeTab === 'terminal'`
- Both tabs stay **mounted but hidden** when inactive (display: none) to preserve state
- `ChatTab` wraps existing `ChatPanel` without modification
- `TerminalTab` wraps existing terminal component without modification
- `MobileLayout` passes `onRequestFocus` to `ChatTab` so external events (AI UI arrival via questionStore) can trigger tab switch
- AI UI cards are already rendered inline in ChatPanel via `MessageArea` component - no changes needed

## Existing Components Reused

From `ui/src/components/chat-drawer/`:
- `ChatPanel` - full chat UI with messages and input
- `MessageArea` - renders messages including AI UI cards

From `ui/src/components/terminal/`:
- Terminal component with xterm integration