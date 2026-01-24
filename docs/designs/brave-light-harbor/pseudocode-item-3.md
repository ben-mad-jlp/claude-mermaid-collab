# Pseudocode: Item 3 - Document/Diagram Creation Notifications

## ArtifactLink Component

```
FUNCTION ArtifactLink({ notification, onClick }):
  icon = notification.artifactType === 'diagram' ? DiagramIcon : DocumentIcon
  actionText = notification.type === 'created' ? 'Created' : 'Updated'
  
  FUNCTION handleClick():
    onClick(notification.id, notification.artifactType)
  
  RETURN (
    <button onClick={handleClick} className="artifact-link">
      <icon />
      <span>{actionText}: {notification.name}</span>
      <span className="click-hint">(click to view)</span>
    </button>
  )
```

## Parse MCP Response for Artifact Info

```
FUNCTION parseArtifactNotification(mcpResponse):
  IF mcpResponse.success AND mcpResponse.id:
    RETURN {
      type: mcpResponse.message.includes('created') ? 'created' : 'updated',
      artifactType: mcpResponse.previewUrl.includes('diagram') ? 'diagram' : 'document',
      id: mcpResponse.id,
      name: mcpResponse.id + (artifactType === 'diagram' ? '.mmd' : '.md')
    }
  RETURN null
```

## ViewerContext Extension

```
FUNCTION ViewerContextProvider({ children }):
  [currentView, setCurrentView] = useState(null)
  
  FUNCTION navigateToArtifact(id, type):
    IF type === 'document':
      setCurrentView({ type: 'document', id })
    ELSE IF type === 'diagram':
      setCurrentView({ type: 'diagram', id })
    
    # Scroll viewer into view if needed
    viewerRef.current?.scrollIntoView()
  
  RETURN (
    <ViewerContext.Provider value={{ currentView, navigateToArtifact }}>
      {children}
    </ViewerContext.Provider>
  )
```

## Integration with MessageArea

```
FUNCTION MessageArea({ content }):
  { navigateToArtifact } = useContext(ViewerContext)
  
  # Content may include ArtifactLink components
  # They are rendered inline and trigger navigation on click
  
  RETURN (
    <div className="message-area">
      {content}
    </div>
  )
```

## WebSocket Message Handler

```
FUNCTION handleMcpResponse(response):
  notification = parseArtifactNotification(response)
  
  IF notification:
    # Include link in next render_ui content
    appendToMessage(
      <ArtifactLink 
        notification={notification}
        onClick={navigateToArtifact}
      />
    )
```
