# Interface: Item 13 - Fix Mermaid Dark Mode Contrast

## File Structure
- `ui/src/components/DiagramViewer.tsx` - Apply theme to Mermaid (MODIFY)
- `ui/src/hooks/useTheme.ts` - Theme detection hook (NEW or MODIFY if exists)

## Mermaid Theme Configuration

```typescript
// When initializing Mermaid
import mermaid from 'mermaid';

const theme = isDarkMode ? 'dark' : 'default';

mermaid.initialize({
  theme: theme,
  // or for more control:
  themeVariables: isDarkMode ? {
    primaryColor: '#1e90ff',
    primaryTextColor: '#fff',
    primaryBorderColor: '#7C0000',
    lineColor: '#aaa',
    secondaryColor: '#006100',
    tertiaryColor: '#fff'
  } : undefined
});
```

## Hook Interface

```typescript
// ui/src/hooks/useTheme.ts
function useTheme(): {
  isDarkMode: boolean;
  theme: 'light' | 'dark';
}
```

## Component Changes

```typescript
// ui/src/components/DiagramViewer.tsx
function DiagramViewer({ content }: Props) {
  const { isDarkMode } = useTheme();
  
  useEffect(() => {
    mermaid.initialize({
      theme: isDarkMode ? 'dark' : 'default'
    });
    // Re-render diagram
  }, [isDarkMode, content]);
}
```

## Theme Detection Options
1. CSS media query: `prefers-color-scheme: dark`
2. App-level theme context
3. Tailwind dark mode class on html/body

## Success Criteria
- Text readable on dark backgrounds
- Diagram colors appropriate for theme
- Theme switches reactively with app preference
