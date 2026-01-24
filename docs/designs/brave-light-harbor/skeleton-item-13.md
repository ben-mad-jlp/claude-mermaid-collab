# Skeleton: Item 13 - Fix Mermaid Dark Mode Contrast

## File Stubs

### ui/src/hooks/useTheme.ts (NEW or MODIFY if exists)
```typescript
import { useState, useEffect } from 'react';

export function useTheme() {
  // TODO: Implement theme detection
  // - Check prefers-color-scheme media query
  // - Listen for changes
  // - Return isDarkMode and theme
  throw new Error('Not implemented');
}
```

### ui/src/components/DiagramViewer.tsx (MODIFY)
```typescript
// TODO: Update Mermaid initialization
// - Get isDarkMode from useTheme
// - Set mermaid theme based on dark mode
// - Re-render diagram when theme changes
// - Use 'dark' theme for dark mode
```

### ui/src/styles/diagram.css (NEW or MODIFY)
```css
/* TODO: Add dark mode diagram styles */
.diagram-container.dark {
  --diagram-bg: #1a1a2e;
}

.diagram-container.dark text {
  fill: #ffffff !important;
}
```

## Task Dependency Graph

```yaml
tasks:
  - id: theme-hook
    files: [ui/src/hooks/useTheme.ts]
    description: Create or update useTheme hook for dark mode detection
    parallel: true

  - id: diagram-theming
    files: [ui/src/components/DiagramViewer.tsx]
    description: Update DiagramViewer to apply Mermaid dark theme
    depends-on: [theme-hook]

  - id: diagram-styles
    files: [ui/src/styles/diagram.css]
    description: Add dark mode CSS overrides for diagrams
    parallel: true

  - id: verify-contrast
    files: []
    description: Test diagram contrast in dark mode meets WCAG AA
    depends-on: [diagram-theming, diagram-styles]
```
