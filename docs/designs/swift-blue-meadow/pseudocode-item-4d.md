# Pseudocode: Item 4d - Collab Codex GUI Topic Browser + Detail

## useTopics Hook

```
FUNCTION useTopics(filters, sortBy, sortOrder):
  [topics, setTopics] = useState([])
  [isLoading, setIsLoading] = useState(true)
  
  FUNCTION refresh():
    setIsLoading(true)
    result = await api.listTopics({ filters, sortBy, sortOrder })
    setTopics(result.topics)
    setIsLoading(false)
  
  useEffect(() => refresh(), [filters, sortBy, sortOrder])
  RETURN { topics, isLoading, refresh }
```

## TopicBrowser Component

```
FUNCTION TopicBrowser({ onSelectTopic }):
  [filters, setFilters] = useState({})
  [sortBy, setSortBy] = useState('name')
  { topics, isLoading } = useTopics(filters, sortBy)
  
  RETURN (
    <FilterBar filters={filters} onFiltersChange={setFilters} />
    <table>
      FOR topic in topics:
        <TopicRow topic={topic} onClick={() => onSelectTopic(topic.name)} />
    </table>
  )
```

## useTopic + TopicDetail

```
FUNCTION useTopic(name):
  [topic, setTopic] = useState(null)
  refresh = async () => setTopic(await api.getTopic(name))
  verify = async () => { await api.verifyTopic(name); refresh() }
  useEffect(() => refresh(), [name])
  RETURN { topic, verify, refresh }

FUNCTION TopicDetail({ topicName }):
  { topic, verify } = useTopic(topicName)
  [activeTab, setActiveTab] = useState('conceptual')
  
  RETURN (
    <Header with topic.name, ConfidenceBadge, Verify/Edit/Delete buttons />
    IF topic.hasDraft: <DraftReviewPanel />
    <DocumentTabs activeTab onTabChange={setActiveTab} />
    <DocumentViewer content={topic.documents[activeTab]} />
  )
```
