## Implementation Details

### UI Component Structure
```typescript
interface UIComponent {
  type: string;           // Component type name
  props: Record<string, any>;
  children?: UIComponent[];
  actions?: Array<{ id: string; label: string }>;
}
```

### Render Flow
1. Validate UI structure via `validateUIStructure()`
2. Generate unique `uiId`
3. Broadcast via WebSocket with `type: 'ui_render'`
4. If blocking, wait for `ui_response` message
5. Return action and form data

### Response Handling
```typescript
interface RenderUIResponse {
  completed: boolean;
  source: 'browser' | 'terminal';
  action?: string;
  data?: Record<string, any>;
}
```