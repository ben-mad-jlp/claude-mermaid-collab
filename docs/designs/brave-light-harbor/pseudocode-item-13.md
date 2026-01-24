# Pseudocode: Item 13 - Fix Mermaid Dark Mode Contrast

## useTheme Hook

```
FUNCTION useTheme():
  [isDarkMode, setIsDarkMode] = useState(false)
  
  EFFECT:
    # Check CSS media query
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    setIsDarkMode(mediaQuery.matches)
    
    # Listen for changes
    FUNCTION handleChange(e):
      setIsDarkMode(e.matches)
    
    mediaQuery.addEventListener('change', handleChange)
    
    CLEANUP:
      mediaQuery.removeEventListener('change', handleChange)
  
  RETURN {
    isDarkMode,
    theme: isDarkMode ? 'dark' : 'light'
  }
```

## DiagramViewer Update

```
FUNCTION DiagramViewer({ content, diagramId }):
  { isDarkMode } = useTheme()
  containerRef = useRef<HTMLDivElement>(null)
  
  EFFECT [content, isDarkMode]:
    IF NOT content OR NOT containerRef.current:
      RETURN
    
    # Configure Mermaid with appropriate theme
    mermaid.initialize({
      startOnLoad: false,
      theme: isDarkMode ? 'dark' : 'default',
      themeVariables: isDarkMode ? {
        # Override specific variables for better contrast
        primaryColor: '#4a9eff',
        primaryTextColor: '#ffffff',
        primaryBorderColor: '#3a7bd5',
        lineColor: '#888888',
        secondaryColor: '#2d5a8c',
        tertiaryColor: '#1e3a5f',
        background: '#1a1a2e',
        mainBkg: '#1a1a2e',
        nodeBorder: '#4a9eff',
        clusterBkg: '#2d3748',
        titleColor: '#ffffff',
        edgeLabelBackground: '#2d3748'
      } : undefined
    })
    
    # Render diagram
    TRY:
      { svg } = await mermaid.render(`diagram-${diagramId}`, content)
      containerRef.current.innerHTML = svg
    CATCH error:
      containerRef.current.innerHTML = `<pre>Error: ${error.message}</pre>`
  
  RETURN (
    <div 
      ref={containerRef} 
      className={cn("diagram-container", isDarkMode && "dark")}
    />
  )
```

## CSS Styles

```css
.diagram-container {
  padding: 1rem;
  background: var(--diagram-bg);
  border-radius: 0.5rem;
}

.diagram-container.dark {
  --diagram-bg: #1a1a2e;
}

.diagram-container svg {
  max-width: 100%;
  height: auto;
}

/* Ensure text is readable */
.diagram-container.dark text {
  fill: #ffffff !important;
}

.diagram-container.dark .node rect,
.diagram-container.dark .node circle,
.diagram-container.dark .node polygon {
  stroke: #4a9eff !important;
}
```

## Alternative: Use Mermaid Built-in Dark Theme

```
# Simpler approach using Mermaid's built-in dark theme:

mermaid.initialize({
  theme: isDarkMode ? 'dark' : 'default'
})

# The 'dark' theme is pre-configured for dark backgrounds
# May need minor CSS tweaks for container background
```

## Testing

```
FUNCTION testDarkModeContrast():
  testCases = [
    'flowchart TD\n  A[Start] --> B[End]',
    'sequenceDiagram\n  Alice->>Bob: Hello',
    'classDiagram\n  Class01 <|-- Class02'
  ]
  
  FOR diagram IN testCases:
    renderInLightMode(diagram)
    renderInDarkMode(diagram)
    verifyTextContrast()  # WCAG AA minimum 4.5:1
```
