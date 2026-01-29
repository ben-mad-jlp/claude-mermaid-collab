# Interface Definition - Item 1: Move Status to Header

## File Structure

- `ui/src/components/SessionStatusPanel.tsx` - **MODIFY** - Add variant prop support
- `ui/src/components/layout/Header.tsx` - **MODIFY** - Import and render SessionStatusPanel
- `ui/src/components/layout/Sidebar.tsx` - **MODIFY** - Remove SessionStatusPanel

## Type Definitions

```typescript
// ui/src/components/SessionStatusPanel.tsx

/** Variant for SessionStatusPanel layout */
export type SessionStatusPanelVariant = 'default' | 'inline';

export interface SessionStatusPanelProps {
  /** Layout variant - 'default' for sidebar (stacked), 'inline' for header (horizontal) */
  variant?: SessionStatusPanelVariant;
  /** Optional custom class name */
  className?: string;
}
```

## Function Signatures

### SessionStatusPanel.tsx Changes

```typescript
// Current signature (no props)
export function SessionStatusPanel(): JSX.Element | null

// New signature (with props)
export function SessionStatusPanel(props: SessionStatusPanelProps): JSX.Element | null
```

### Internal Rendering Logic

```typescript
// Conditional rendering based on variant
if (variant === 'inline') {
  // Return horizontal flex layout:
  // [Phase Badge] [Timestamp] [Item N] [Progress Bar w/ count]
  return <div className="flex items-center gap-2">...</div>
}

// Default: return existing stacked layout
return <div className="px-3 py-2 border-t ...">...</div>
```

## Component Interactions

```
Header.tsx
  └── SessionStatusPanel variant="inline"
       └── useSessionStore (collabState)
            ├── state, displayName
            ├── currentItem
            ├── lastActivity
            ├── completedTasks, pendingTasks
            └── totalItems, documentedItems

Sidebar.tsx
  └── (REMOVED: SessionStatusPanel)
```

## Header.tsx Integration

```typescript
// Import to add
import { SessionStatusPanel } from '@/components/SessionStatusPanel';

// Render after Connection Badge (around line 278)
<SessionStatusPanel variant="inline" />
```

## Sidebar.tsx Changes

```typescript
// Remove import
- import { SessionStatusPanel } from '@/components/SessionStatusPanel';

// Remove JSX (around lines 172-175)
- <div className={isDisabled ? 'opacity-50 pointer-events-none' : ''}>
-   <SessionStatusPanel />
- </div>
```

## Inline Layout Styles

```typescript
// Inline variant classes
const inlineClasses = `
  flex items-center gap-2
  text-xs
`;

// Progress bar inline (fixed width)
const progressInlineClasses = `
  w-20            // ~80px fixed width
  h-1.5
  bg-gray-200 dark:bg-gray-700
  rounded-full
  overflow-hidden
`;
```
