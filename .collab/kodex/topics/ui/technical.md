## Implementation Details

### App Structure
```typescript
// Main App component handles:
// - Theme management (dark/light)
// - WebSocket connection
// - Session/item selection
// - Auto-save coordination
// - Mobile/desktop layout switching
```

### State Stores
- `uiStore`: Edit mode, zoom, panel visibility
- `sessionStore`: Sessions, diagrams, documents, selection
- `questionStore`: Claude question handling
- `chatStore`: Chat messages and UI renders

### Layout Components
- `Header`: Session dropdown, theme toggle, status
- `Sidebar`: Item list with search
- `EditorToolbar`: Undo/redo, zoom, actions
- `SplitPane`: Resizable panel layout
- `MobileLayout`: Tab-based mobile interface

### Key Hooks
- `useWebSocket`: WebSocket connection management
- `useAutoSave`: Debounced content persistence
- `useIsMobile`: Viewport detection
- `useTheme`: Dark/light mode