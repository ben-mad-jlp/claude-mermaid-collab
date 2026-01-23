# Pseudocode: Item 5 - Add Refresh Button to UI

## [APPROVED]

## File: ui/src/components/dashboard/Dashboard.tsx

### State and Handlers

```
FUNCTION Dashboard():
  # Existing state
  [diagrams, setDiagrams] = useState([])
  [documents, setDocuments] = useState([])
  
  # Add loading state for refresh
  [isRefreshing, setIsRefreshing] = useState(false)
  
  # Fetch functions (likely already exist)
  FUNCTION fetchDiagrams():
    result = await mcpClient.listDiagrams(project, session)
    setDiagrams(result.diagrams)
  
  FUNCTION fetchDocuments():
    result = await mcpClient.listDocuments(project, session)
    setDocuments(result.documents)
  
  # New refresh handler
  FUNCTION handleRefresh():
    setIsRefreshing(true)
    
    TRY:
      # Fetch both in parallel
      await Promise.all([
        fetchDiagrams(),
        fetchDocuments()
      ])
    CATCH error:
      console.error("Refresh failed:", error)
    FINALLY:
      setIsRefreshing(false)
```

### Render Refresh Button

```
FUNCTION renderSidebarHeader():
  RETURN (
    <div className="flex items-center justify-between p-2 border-b">
      <h3 className="font-medium">Items</h3>
      
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50"
        title="Refresh"
      >
        <RefreshIcon 
          className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
        />
      </button>
    </div>
  )
```

### RefreshIcon Component

```
# If not already available, add simple SVG icon
FUNCTION RefreshIcon({ className }):
  RETURN (
    <svg 
      className={className}
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor"
    >
      <path 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        strokeWidth={2} 
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
      />
    </svg>
  )
```

## Verification
- [ ] Refresh button visible in sidebar header
- [ ] Button shows loading state during refresh
- [ ] Both diagrams and documents fetched on click
- [ ] No page reload needed
