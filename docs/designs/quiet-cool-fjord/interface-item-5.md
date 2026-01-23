# Interface: Item 5 - Add Refresh Button to UI

## [APPROVED]

## File Structure
- `ui/src/components/dashboard/Dashboard.tsx` - Add refresh button to sidebar

## Type Definitions

```typescript
// No new types needed - uses existing MCP client
```

## Function Signatures

```typescript
// ui/src/components/dashboard/Dashboard.tsx

// Add to existing component
const handleRefresh = async (): Promise<void> => {
  // Re-fetch diagrams and documents from MCP
  await Promise.all([
    fetchDiagrams(),
    fetchDocuments()
  ]);
};
```

## UI Changes

```tsx
// In sidebar header, add refresh button
<button
  onClick={handleRefresh}
  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
  title="Refresh"
>
  <RefreshIcon className="w-4 h-4" />
</button>
```

## Component Interactions
- Refresh button calls `fetchDiagrams()` and `fetchDocuments()`
- These functions use MCP client to call `list_diagrams` and `list_documents`
- UI state updates with fresh data

## Verification
- [ ] Refresh button in sidebar header
- [ ] Calls both list_diagrams and list_documents
- [ ] No page reload needed
