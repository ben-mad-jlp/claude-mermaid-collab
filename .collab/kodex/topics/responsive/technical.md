## Implementation Details

### useIsMobile Hook
```typescript
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 639px)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}
```

### Layout Switching in App.tsx
```typescript
const isMobile = useIsMobile();

if (isMobile) {
  return <MobileLayout ... />;
}

// Desktop layout
return <DesktopLayout ... />;
```

### Tailwind Responsive Classes
```html
<div className="hidden sm:block">Desktop only</div>
<div className="sm:hidden">Mobile only</div>
```