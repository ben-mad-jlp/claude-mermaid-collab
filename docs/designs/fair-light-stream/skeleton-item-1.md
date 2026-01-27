# Skeleton: Item 1 - Auto-select new terminal when opened

## Planned Files
- [ ] `ui/src/hooks/useTerminalTabs.ts` - Modify existing (addTab function)

**Note:** This is a modification to an existing file, not a new file.

## File Changes

### ui/src/hooks/useTerminalTabs.ts (MODIFY)

```typescript
// Change to addTab function (lines 73-83)

const addTab = useCallback(async () => {
  try {
    const result = await api.createTerminalSession(project, session);
    // Refresh to get the updated list
    await refresh();
    // TODO: Auto-select the newly created terminal
    // - Set active tab to result.id
    // - Persist to localStorage for consistency
    setActiveTabId(result.id);
    localStorage.setItem(getStorageKey(project, session), result.id);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    setError(error);
    throw error;
  }
}, [project, session, refresh]);
```

## Task Dependency Graph

```yaml
tasks:
  - id: item-1-terminal-autoselect
    files: [ui/src/hooks/useTerminalTabs.ts]
    tests: [ui/src/hooks/useTerminalTabs.test.ts, ui/src/hooks/__tests__/useTerminalTabs.test.ts]
    description: Modify addTab to auto-select new terminal after creation
    parallel: true
```

## Execution Order

**Wave 1 (parallel-safe):**
- item-1-terminal-autoselect

## Verification
- [ ] addTab captures result.id from createTerminalSession
- [ ] setActiveTabId called after refresh
- [ ] localStorage.setItem called with correct key
