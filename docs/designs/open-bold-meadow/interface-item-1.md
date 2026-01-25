# Interface: Item 1 - Auto-start terminals

## File Structure
- `ui/src/components/EmbeddedTerminal.tsx` - Modify existing file

## Type Definitions

```typescript
// ui/src/components/EmbeddedTerminal.tsx
// Props remain unchanged
export interface EmbeddedTerminalProps {
  config: TerminalConfig;
  sessionName?: string;
  className?: string;
}
```

## Function Signatures

```typescript
// ui/src/components/EmbeddedTerminal.tsx

/**
 * EmbeddedTerminal component - renders ttyd iframe immediately
 * 
 * REMOVE:
 * - useState for isStarted
 * - startTerminal callback
 * - "Start Terminal" button
 * - Placeholder div when not started
 * 
 * SIMPLIFIED COMPONENT:
 * - Renders iframe immediately on mount
 * - No conditional rendering based on isStarted state
 */
export function EmbeddedTerminal({ 
  config, 
  sessionName, 
  className = '' 
}: EmbeddedTerminalProps): JSX.Element
```

## Component Structure (After)

```tsx
export function EmbeddedTerminal({ config, sessionName, className = '' }: EmbeddedTerminalProps) {
  // Build iframe URL
  let iframeUrl = config.wsUrl
    .replace('ws://', 'http://')
    .replace('wss://', 'https://')
    .replace('/ws', '');

  if (sessionName) {
    iframeUrl += `?arg=${encodeURIComponent(sessionName)}`;
  }

  return (
    <div className={`embedded-terminal ${className}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <iframe
        src={iframeUrl}
        style={{ flex: 1, border: 'none', background: '#1e1e1e' }}
        title="Terminal"
      />
    </div>
  );
}
```

## Component Interactions

- No state management needed
- Iframe loads immediately when component mounts
- React can remount without losing tmux session (ttyd reconnects)
