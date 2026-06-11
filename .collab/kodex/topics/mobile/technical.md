## Implementation Details

### MobileLayout Component
```typescript
interface MobileLayoutProps {
  sessions: Session[];
  registeredProjects: string[];
  handlers: {
    onSessionSelect: (session: Session) => void;
    onRefreshSessions: () => Promise<void>;
    onCreateSession: (project: string) => Promise<void>;
    onAddProject: () => Promise<void>;
    onDeleteSession: (session: Session) => Promise<void>;
  };
  isConnected: boolean;
  isConnecting: boolean;
}
```

### Tab State Management
```typescript
const [activeTab, setActiveTab] = useState<'preview' | 'chat' | 'terminal'>('preview');
```

### Component Exports
```typescript
export { ItemDrawer } from './ItemDrawer';
export { PreviewTab } from './PreviewTab';
export { ChatTab } from './ChatTab';
export { TerminalTab } from './TerminalTab';
```

### Touch Interactions
- Swipe gestures for drawer
- Touch-friendly button sizes
- Keyboard avoidance for inputs