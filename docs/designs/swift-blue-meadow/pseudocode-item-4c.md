# Pseudocode: Item 4c - Collab Codex GUI Layout + Dashboard

## Layout Component

```
FUNCTION Layout({ children }):
  RETURN (
    <div className="flex h-screen">
      <Sidebar currentPath={useLocation().pathname} />
      <main className="flex-1 overflow-auto">
        <Header />
        {children}
      </main>
    </div>
  )
```

## Sidebar Component

```
FUNCTION Sidebar({ currentPath }):
  navItems = [
    { label: 'Dashboard', path: '/', icon: HomeIcon },
    { label: 'Topics', path: '/topics', icon: BookIcon },
    { label: 'Flags', path: '/flags', icon: FlagIcon },
    { label: 'Missing', path: '/missing', icon: QuestionIcon },
  ]
  
  RETURN (
    <nav className="w-64 bg-gray-800 text-white">
      FOR item in navItems:
        <NavLink 
          to={item.path}
          active={currentPath === item.path}
        >
          {item.icon} {item.label}
        </NavLink>
    </nav>
  )
```

## useDashboard Hook

```
FUNCTION useDashboard():
  [stats, setStats] = useState(null)
  [recentFlags, setRecentFlags] = useState([])
  [staleTopics, setStaleTopics] = useState([])
  [pendingDrafts, setPendingDrafts] = useState([])
  [isLoading, setIsLoading] = useState(true)
  [error, setError] = useState(null)
  
  FUNCTION refresh():
    setIsLoading(true)
    TRY:
      # Parallel fetch all dashboard data
      [statsRes, flagsRes, staleRes, draftsRes] = await Promise.all([
        api.getDashboardStats(),
        api.getRecentFlags({ limit: 5 }),
        api.getStaleTopics({ staleDays: 30, limit: 10 }),
        api.listDrafts()
      ])
      
      setStats(statsRes)
      setRecentFlags(flagsRes)
      setStaleTopics(staleRes)
      setPendingDrafts(draftsRes)
    CATCH err:
      setError(err)
    FINALLY:
      setIsLoading(false)
  
  useEffect(() => refresh(), [])
  
  RETURN { stats, recentFlags, staleTopics, pendingDrafts, isLoading, error, refresh }
```

## Dashboard Component

```
FUNCTION Dashboard():
  { stats, recentFlags, staleTopics, pendingDrafts, isLoading, refresh } = useDashboard()
  
  IF isLoading:
    RETURN <Spinner />
  
  RETURN (
    <div className="p-6 space-y-6">
      <div className="flex justify-between">
        <h1>Dashboard</h1>
        <RefreshButton onClick={refresh} />
      </div>
      
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Pending Drafts" value={stats.pendingDraftsCount} 
                  variant={stats.pendingDraftsCount > 0 ? 'warning' : 'default'} />
        <StatCard label="Open Flags" value={stats.openFlagsCount}
                  variant={stats.openFlagsCount > 0 ? 'error' : 'default'} />
        <StatCard label="Stale Topics" value={stats.staleTopicsCount} />
        <StatCard label="Total Topics" value={stats.totalTopics} />
      </div>
      
      {/* Lists */}
      <div className="grid grid-cols-2 gap-6">
        <PendingDraftsList drafts={pendingDrafts} onSelect={navigateToTopic} />
        <OpenFlagsList flags={recentFlags} onSelect={navigateToTopic} />
      </div>
      
      <StaleTopicsList topics={staleTopics} onSelect={navigateToTopic} />
    </div>
  )
```
