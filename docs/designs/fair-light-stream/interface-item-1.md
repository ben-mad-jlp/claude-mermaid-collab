# Interface: Item 1 - Auto-select new terminal when opened

## File Structure
- `ui/src/hooks/useTerminalTabs.ts` - Modify `addTab` function

## Type Definitions
No new types needed - using existing `CreateSessionResult` from `ui/src/types/terminal.ts`.

## Function Signatures

```typescript
// ui/src/hooks/useTerminalTabs.ts

// EXISTING - no signature change, only implementation
const addTab: () => Promise<void>
```

## Implementation Notes
The `addTab` function already has correct signature. Change is internal:
1. Capture `result.id` from `api.createTerminalSession()`
2. After `refresh()`, call `setActiveTabId(result.id)`
3. Persist to localStorage via `localStorage.setItem(getStorageKey(project, session), result.id)`

## Component Interactions
- `addTab()` → `api.createTerminalSession()` → returns `CreateSessionResult.id`
- `addTab()` → `setActiveTabId()` (existing internal state setter)
- `addTab()` → `localStorage.setItem()` (existing helper pattern)
