## Implementation Examples

### Zustand with useShallow
```typescript
const { sessions, currentSession, setCurrentSession } = useSessionStore(
  useShallow((state) => ({
    sessions: state.sessions,
    currentSession: state.currentSession,
    setCurrentSession: state.setCurrentSession,
  }))
);
```

### Error Boundary Pattern
```typescript
class ErrorBoundary extends React.Component<Props, State> {
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) return <ErrorFallback />;
    return this.props.children;
  }
}
```

### Callback Memoization
```typescript
const handleContentChange = useCallback((content: string) => {
  setLocalContent(content);
}, []);
```

### Computed Values with useMemo
```typescript
const selectedItem = useMemo(() => {
  if (selectedDiagramId) {
    return diagrams.find(d => d.id === selectedDiagramId);
  }
  return null;
}, [diagrams, selectedDiagramId]);
```