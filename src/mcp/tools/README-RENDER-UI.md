# MCP Tool: render-ui

## Overview

The `render-ui` MCP tool provides a powerful way to render JSON-based UI definitions to the browser and manage user interactions. It integrates with the WebSocket infrastructure to broadcast UI to connected clients and optionally block until user action is received.

## Features

- **JSON UI Validation**: Validates UI component structure against schema
- **WebSocket Broadcasting**: Sends UI definitions to all connected browser clients
- **Blocking Mode**: Optionally waits for user interaction with configurable timeout
- **Action Tracking**: Captures user actions and form data
- **Error Handling**: Comprehensive error messages for debugging
- **Timeout Protection**: Prevents indefinite blocking with configurable timeout

## API

### renderUI()

Renders a UI definition to the browser.

```typescript
async function renderUI(
  project: string,           // Project path (required)
  session: string,           // Session name (required)
  ui: UIComponent,           // UI definition (required)
  blocking?: boolean,        // Wait for user action (default: true)
  timeout?: number,          // Timeout in ms (default: 30000)
  wsHandler: WebSocketHandler // WebSocket handler instance
): Promise<RenderUIResponse>
```

#### Parameters

- **project**: Absolute path to the project root directory
- **session**: Session name (e.g., "bright-calm-river")
- **ui**: JSON UI component definition conforming to UIComponent interface
- **blocking**: If true, waits for user interaction; if false, returns immediately
- **timeout**: Maximum time to wait for user interaction (ms). Only used if blocking=true
  - Minimum: 1000ms
  - Maximum: 300000ms (5 minutes)
  - Default: 30000ms (30 seconds)
- **wsHandler**: Instance of WebSocketHandler for broadcasting

#### Returns

```typescript
interface RenderUIResponse {
  completed: boolean;           // Whether render/interaction completed successfully
  source: 'browser' | 'terminal'; // Where action originated
  action?: string;              // Action identifier (from UI action)
  data?: Record<string, any>;   // Form data captured from UI
  error?: string;               // Error message if applicable
}
```

#### Examples

**Non-blocking render (fire and forget)**:
```typescript
const ui = {
  type: 'Card',
  props: { title: 'Welcome' },
  children: [/* ... */],
};

const result = await renderUI(
  '/project/path',
  'session-name',
  ui,
  false,  // non-blocking
  undefined,
  wsHandler
);

// Returns immediately
// { completed: true, source: 'terminal', action: 'render_complete' }
```

**Blocking render (wait for user action)**:
```typescript
const ui = {
  type: 'MultipleChoice',
  props: {
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
  },
  actions: [
    { id: 'submit', label: 'Submit', primary: true },
  ],
};

const result = await renderUI(
  '/project/path',
  'session-name',
  ui,
  true,     // blocking
  5000,     // 5 second timeout
  wsHandler
);

// Waits for user interaction or timeout
// { completed: true, source: 'browser', action: 'submit', data: { selected: 'yes' } }
```

### validateUIStructure()

Validates that a UI definition conforms to the UIComponent schema.

```typescript
function validateUIStructure(ui: any): asserts ui is UIComponent
```

**Throws Error if:**
- UI is not an object
- Missing required properties (type, props)
- Type or label properties are not strings
- Props is not an object
- Children array contains invalid components
- Actions array contains invalid action objects

### validateTimeout()

Validates and returns a timeout value.

```typescript
function validateTimeout(timeout: number | undefined): number
```

**Returns:**
- Input timeout if valid
- Default timeout (30000ms) if undefined
- Throws Error if invalid

**Constraints:**
- Must be a finite number
- Minimum: 1000ms
- Maximum: 300000ms

### handleUIResponse()

Handles incoming UI response from browser (call this when WebSocket receives ui_response).

```typescript
function handleUIResponse(
  wsHandler: WebSocketHandler,
  response: UIResponse
): void
```

**Response Structure:**
```typescript
interface UIResponse {
  componentId: string;          // Matches uiId from ui_render message
  actionId: string;             // Action identifier
  data?: Record<string, any>;   // Form data
  timestamp: number;            // Response timestamp
}
```

### createUIResponse()

Helper function to create a UIResponse object for testing.

```typescript
function createUIResponse(
  uiId: string,
  actionId: string,
  data?: Record<string, any>
): UIResponse
```

## UI Component Structure

The UI definition must follow this structure:

```typescript
interface UIComponent {
  type: string;                 // Component type (e.g., 'Button', 'Card')
  props: Record<string, any>;   // Component properties
  children?: UIComponent[];     // Nested components
  actions?: UIAction[];         // Actions that can be triggered
}

interface UIAction {
  id: string;                   // Unique action identifier
  label: string;                // Display label
  primary?: boolean;            // Primary action styling
  destructive?: boolean;        // Destructive action styling
  alignment?: 'left' | 'center' | 'right'; // Button alignment
}
```

## Error Handling

Common errors and their causes:

| Error | Cause |
|-------|-------|
| "project must be a non-empty string" | Missing or invalid project path |
| "session must be a non-empty string" | Missing or invalid session name |
| "UI definition must be a non-null object" | UI is null, undefined, or not an object |
| "UI component must have a type property (string)" | Missing or non-string type |
| "UI component must have a props property (object)" | Missing or non-object props |
| "Timeout must be at least 1000ms" | Timeout below minimum |
| "Timeout must not exceed 300000ms" | Timeout above maximum |
| "UI interaction timeout after Xms" | No user action within timeout period |

## WebSocket Integration

The tool broadcasts UI via WebSocket using this message structure:

```typescript
{
  type: 'ui_render',
  uiId: string,                 // Unique identifier for this render
  project: string,              // Project path
  session: string,              // Session name
  ui: UIComponent,              // The UI definition
  blocking: boolean,            // Whether blocking
  timestamp: number             // Message timestamp
}
```

Browser should respond with:

```typescript
{
  type: 'ui_response',
  componentId: string,          // Matches uiId
  actionId: string,             // Action identifier
  data: Record<string, any>,    // Form data
  timestamp: number             // Response timestamp
}
```

## Implementation Notes

### Blocking Mode

When `blocking=true`:
1. UI is broadcast to browser via WebSocket
2. renderUI() returns a Promise
3. Promise resolves when:
   - Browser sends ui_response with matching uiId, OR
   - Timeout expires
4. Timeout is protected with setTimeout()

### Non-blocking Mode

When `blocking=false`:
1. UI is broadcast to browser via WebSocket
2. renderUI() returns immediately
3. Result: `{ completed: true, source: 'terminal', action: 'render_complete' }`

### UI ID Generation

Each render generates a unique UI ID:
```
ui_<timestamp>_<random-hex>
```

This ensures:
- No collisions between concurrent renders
- Easy tracking of responses
- Human-readable debugging

## Testing

Comprehensive test suite in `__tests__/render-ui.test.ts` covers:

- UI structure validation (valid/invalid inputs)
- Timeout validation (minimum, maximum, default)
- Broadcasting behavior (blocking/non-blocking)
- Error handling and edge cases
- Response handling and cleanup
- Integration scenarios

Run tests:
```bash
bun test src/mcp/tools/__tests__/render-ui.test.ts
```

## Best Practices

1. **Always validate UI structure** before rendering
   ```typescript
   try {
     validateUIStructure(ui);
   } catch (error) {
     console.error('Invalid UI:', error.message);
   }
   ```

2. **Set appropriate timeout** for user interaction
   - Short tasks: 5-10 seconds
   - Normal tasks: 30 seconds (default)
   - Complex tasks: 60 seconds or more

3. **Handle errors gracefully**
   ```typescript
   try {
     const result = await renderUI(project, session, ui, true, 30000, wsHandler);
     if (result.completed && result.source === 'browser') {
       console.log('User action:', result.action);
       console.log('Form data:', result.data);
     }
   } catch (error) {
     console.error('UI render failed:', error.message);
   }
   ```

4. **Clean up timeout handlers** if needed (done automatically)

5. **Use non-blocking mode** for notifications that don't need response
   ```typescript
   await renderUI(project, session, alertUI, false, undefined, wsHandler);
   // Continue immediately
   ```

## Performance Considerations

- UI broadcast is non-blocking internally (handled by WebSocket)
- Timeout overhead: minimal (single setTimeout per blocking render)
- Memory: Pending UI handlers cleaned up immediately after response
- Concurrent renders: Fully supported via unique UI IDs

## Future Enhancements

- [ ] UI versioning for tracking changes
- [ ] Progressive UI updates (streaming)
- [ ] UI templating system
- [ ] Analytics/telemetry tracking
- [ ] A/B testing support
- [ ] Caching for common UIs
