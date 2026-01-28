# Interface Definition: Item 2 - Mobile Layout Shell

## File Structure

- `ui/src/hooks/useIsMobile.ts` - Mobile detection hook
- `ui/src/components/layout/MobileLayout.tsx` - Root mobile layout component
- `ui/src/components/layout/MobileHeader.tsx` - Compact mobile header
- `ui/src/components/layout/BottomTabBar.tsx` - Bottom navigation tabs
- `ui/src/App.tsx` - Modified to conditionally render mobile/desktop

## Type Definitions

```typescript
// ui/src/components/layout/MobileLayout.tsx
export type MobileTab = 'preview' | 'chat' | 'terminal';

export interface MobileLayoutProps {
  /** Available sessions to select from */
  sessions: Session[];
  /** Registered projects (may have no sessions yet) */
  registeredProjects: string[];
  /** Callback when a session is selected */
  onSessionSelect: (session: Session) => void;
  /** Callback to refresh sessions list */
  onRefreshSessions: () => void;
  /** Callback to create a new session */
  onCreateSession: (project: string) => void;
  /** Callback to add a new project */
  onAddProject: () => void;
  /** Callback to delete a session */
  onDeleteSession: (session: Session) => void;
  /** WebSocket connection status */
  isConnected: boolean;
  /** Whether WebSocket is connecting */
  isConnecting: boolean;
}
```

```typescript
// ui/src/components/layout/MobileHeader.tsx
export interface MobileHeaderProps {
  /** Available sessions to select from */
  sessions: Session[];
  /** Registered projects */
  registeredProjects: string[];
  /** Callback when a session is selected */
  onSessionSelect: (session: Session) => void;
  /** Callback to refresh */
  onRefreshSessions: () => void;
  /** Callback to create a new session */
  onCreateSession: (project: string) => void;
  /** Callback to add a new project */
  onAddProject: () => void;
  /** Callback to delete a session */
  onDeleteSession: (session: Session) => void;
  /** WebSocket connection status */
  isConnected: boolean;
  /** Whether WebSocket is connecting */
  isConnecting: boolean;
  /** Optional custom class name */
  className?: string;
}
```

```typescript
// ui/src/components/layout/BottomTabBar.tsx
export interface BottomTabBarProps {
  /** Currently active tab */
  activeTab: MobileTab;
  /** Callback when tab is tapped */
  onTabChange: (tab: MobileTab) => void;
  /** Optional custom class name */
  className?: string;
}
```

## Function Signatures

```typescript
// ui/src/hooks/useIsMobile.ts
/**
 * Hook to detect if viewport is mobile-sized (< 640px)
 * Uses matchMedia with resize listener
 */
export function useIsMobile(): boolean
```

```typescript
// ui/src/components/layout/MobileLayout.tsx
export const MobileLayout: React.FC<MobileLayoutProps>
// Internal state: activeTab: MobileTab (default: 'preview')
// Renders: MobileHeader + tab content + BottomTabBar
// Provides: setActiveTab callback to child components (for auto-switch on AI UI)
```

```typescript
// ui/src/components/layout/MobileHeader.tsx
export const MobileHeader: React.FC<MobileHeaderProps>
// Compact single-row header
// Uses ProjectDropdown and SessionDropdown from existing Header.tsx logic
```

```typescript
// ui/src/components/layout/BottomTabBar.tsx
export const BottomTabBar: React.FC<BottomTabBarProps>
// Fixed to bottom, 3 tabs with icons and labels
```

## Component Interactions

- `App.tsx` calls `useIsMobile()` and renders `<MobileLayout>` or desktop layout
- `MobileLayout` manages `activeTab` state and passes to `BottomTabBar`
- `MobileLayout` renders tab content components (PreviewTab, ChatTab, TerminalTab)
- `MobileHeader` reuses dropdown logic from `Header.tsx` with compact styling
- Tab components receive `setActiveTab` callback for auto-switching (e.g., Chat tab on AI UI arrival)