# Skeleton: Item 2 - Mobile Layout Shell

## Planned Files

- [ ] `ui/src/hooks/useIsMobile.ts` - Mobile detection hook
- [ ] `ui/src/components/layout/MobileLayout.tsx` - Root mobile layout
- [ ] `ui/src/components/layout/MobileHeader.tsx` - Compact header
- [ ] `ui/src/components/layout/BottomTabBar.tsx` - Bottom tab navigation
- [ ] `ui/src/App.tsx` - Modified to conditionally render layouts

**Note:** These files are documented but NOT created yet. They will be created during the implementation phase by executing-plans.

## File Contents

### Planned File: ui/src/hooks/useIsMobile.ts

```typescript
import { useState, useEffect } from 'react';

/**
 * Hook to detect if viewport is mobile-sized (< 640px)
 * Uses matchMedia with resize listener for efficient detection
 */
export function useIsMobile(): boolean {
  // TODO: Initialize state with matchMedia result
  // TODO: Add change listener on mount
  // TODO: Clean up listener on unmount
  // TODO: Handle SSR (check typeof window)
  
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    // TODO: Implement matchMedia detection
    // const mq = window.matchMedia('(max-width: 639px)');
    // setIsMobile(mq.matches);
    // mq.addEventListener('change', handler);
    // return () => mq.removeEventListener('change', handler);
  }, []);
  
  return isMobile;
}
```

**Status:** [ ] Will be created during implementation

---

### Planned File: ui/src/components/layout/MobileLayout.tsx

```typescript
import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useDataLoader } from '@/hooks/useDataLoader';
import { MobileHeader, MobileHeaderProps } from './MobileHeader';
import { BottomTabBar } from './BottomTabBar';
import { PreviewTab } from '@/components/mobile/PreviewTab';
import { ChatTab } from '@/components/mobile/ChatTab';
import { TerminalTab } from '@/components/mobile/TerminalTab';
import type { Session, Item } from '@/types';

export type MobileTab = 'preview' | 'chat' | 'terminal';

export interface MobileLayoutProps {
  sessions: Session[];
  registeredProjects: string[];
  onSessionSelect: (session: Session) => void;
  onRefreshSessions: () => void;
  onCreateSession: (project: string) => void;
  onAddProject: () => void;
  onDeleteSession: (session: Session) => void;
  isConnected: boolean;
  isConnecting: boolean;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({
  sessions,
  registeredProjects,
  onSessionSelect,
  onRefreshSessions,
  onCreateSession,
  onAddProject,
  onDeleteSession,
  isConnected,
  isConnecting,
}) => {
  const [activeTab, setActiveTab] = useState<MobileTab>('preview');
  
  // TODO: Get session data from sessionStore
  // TODO: Build items array from diagrams + documents
  // TODO: Find selectedItem based on selectedDiagramId/selectedDocumentId
  // TODO: Get selectDiagramWithContent, selectDocumentWithContent from useDataLoader
  
  // TODO: Implement handleItemSelect callback
  
  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* TODO: Render MobileHeader */}
      
      {/* TODO: Render tab content (all tabs mounted, inactive hidden) */}
      <div className="flex-1 min-h-0 relative">
        {/* PreviewTab, ChatTab, TerminalTab with display:none for inactive */}
      </div>
      
      {/* TODO: Render BottomTabBar */}
    </div>
  );
};
```

**Status:** [ ] Will be created during implementation

---

### Planned File: ui/src/components/layout/MobileHeader.tsx

```typescript
import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';
import type { Session } from '@/types';

export interface MobileHeaderProps {
  sessions: Session[];
  registeredProjects: string[];
  onSessionSelect: (session: Session) => void;
  onRefreshSessions: () => void;
  onCreateSession: (project: string) => void;
  onAddProject: () => void;
  onDeleteSession: (session: Session) => void;
  isConnected: boolean;
  isConnecting: boolean;
  className?: string;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  sessions,
  registeredProjects,
  onSessionSelect,
  onRefreshSessions,
  onCreateSession,
  onAddProject,
  onDeleteSession,
  isConnected,
  isConnecting,
  className = '',
}) => {
  const { isDark, toggleTheme } = useTheme();
  
  // TODO: Add project dropdown state and ref
  // TODO: Add session dropdown state and ref
  // TODO: Implement click-outside to close dropdowns
  
  return (
    <header className={`flex items-center px-3 py-2 border-b border-gray-200 dark:border-gray-700 ${className}`}>
      {/* TODO: Logo (small) */}
      {/* TODO: Project dropdown (compact) */}
      {/* TODO: Session dropdown (compact) */}
      {/* TODO: Refresh icon button */}
      {/* TODO: Theme toggle icon */}
      {/* TODO: Connection status dot */}
    </header>
  );
};
```

**Status:** [ ] Will be created during implementation

---

### Planned File: ui/src/components/layout/BottomTabBar.tsx

```typescript
import React from 'react';
import type { MobileTab } from './MobileLayout';

export interface BottomTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  className?: string;
}

const tabs: Array<{ id: MobileTab; label: string }> = [
  { id: 'preview', label: 'Preview' },
  { id: 'chat', label: 'Chat' },
  { id: 'terminal', label: 'Terminal' },
];

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onTabChange,
  className = '',
}) => {
  // TODO: Render fixed bottom bar with 3 tabs
  // TODO: Each tab has icon + label stacked
  // TODO: Active tab highlighted
  // TODO: Safe area padding for iOS (pb-safe)
  
  return (
    <nav className={`flex border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ${className}`}>
      {/* TODO: Map over tabs, render buttons */}
    </nav>
  );
};
```

**Status:** [ ] Will be created during implementation

---

### Planned Modification: ui/src/App.tsx

```typescript
// ADD: Import useIsMobile hook
import { useIsMobile } from '@/hooks/useIsMobile';

// ADD: Import MobileLayout
import { MobileLayout } from '@/components/layout/MobileLayout';

// MODIFY: In App component, add:
const isMobile = useIsMobile();

// MODIFY: In render, wrap layout decision:
// if (isMobile) {
//   return <MobileLayout {...props} />;
// } else {
//   return existing desktop layout;
// }
```

**Status:** [ ] Will be modified during implementation

## Task Dependency Graph

```yaml
tasks:
  - id: use-is-mobile-hook
    files: [ui/src/hooks/useIsMobile.ts]
    tests: [ui/src/hooks/useIsMobile.test.ts, ui/src/hooks/__tests__/useIsMobile.test.ts]
    description: Mobile detection hook using matchMedia
    parallel: true

  - id: bottom-tab-bar
    files: [ui/src/components/layout/BottomTabBar.tsx]
    tests: [ui/src/components/layout/BottomTabBar.test.tsx, ui/src/components/layout/__tests__/BottomTabBar.test.tsx]
    description: Bottom navigation tab bar component
    parallel: true

  - id: mobile-header
    files: [ui/src/components/layout/MobileHeader.tsx]
    tests: [ui/src/components/layout/MobileHeader.test.tsx, ui/src/components/layout/__tests__/MobileHeader.test.tsx]
    description: Compact mobile header with dropdowns
    parallel: true

  - id: mobile-layout
    files: [ui/src/components/layout/MobileLayout.tsx]
    tests: [ui/src/components/layout/MobileLayout.test.tsx, ui/src/components/layout/__tests__/MobileLayout.test.tsx]
    description: Root mobile layout container
    depends-on: [mobile-header, bottom-tab-bar]

  - id: app-mobile-integration
    files: [ui/src/App.tsx]
    tests: []
    description: Integrate mobile layout into App.tsx
    depends-on: [use-is-mobile-hook, mobile-layout]
```

## Execution Order

**Wave 1 (parallel):**
- use-is-mobile-hook
- bottom-tab-bar
- mobile-header

**Wave 2:**
- mobile-layout (depends on header + tab bar)

**Wave 3:**
- app-mobile-integration (depends on hook + layout)

## Verification

- [x] All files from Interface documented
- [x] File paths match exactly
- [x] All types defined (MobileTab, props interfaces)
- [x] All function signatures present
- [x] TODO comments match pseudocode
- [x] Dependency graph covers all files
- [x] No circular dependencies