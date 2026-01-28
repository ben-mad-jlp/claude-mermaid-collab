# Interface Definition: Item 3

## Remove timeout parameter from render_ui MCP tool

### File Structure (Modifications)

- `src/mcp/tools/render-ui.ts` - Remove timeout from schema and function
- `src/mcp/setup.ts` - Remove timeout from MCP handler
- `src/routes/api.ts` - Remove timeout from HTTP API handler
- `src/services/ui-manager.ts` - Remove timeout from interfaces and logic

### Type Definitions

```typescript
// src/services/ui-manager.ts - BEFORE
interface PendingUI {
  project: string;
  session: string;
  blocking: boolean;
  timeout: number;              // REMOVE
  createdAt: number;
  resolve: (response: UIResponse) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;  // REMOVE
}

// src/services/ui-manager.ts - AFTER
interface PendingUI {
  project: string;
  session: string;
  blocking: boolean;
  createdAt: number;
  resolve: (response: UIResponse) => void;
  reject: (error: Error) => void;
}

// src/services/ui-manager.ts - BEFORE
interface RenderUIRequest {
  project: string;
  session: string;
  ui: any;
  blocking?: boolean;
  timeout?: number;  // REMOVE
  uiId?: string;
}

// src/services/ui-manager.ts - AFTER
interface RenderUIRequest {
  project: string;
  session: string;
  ui: any;
  blocking?: boolean;
  uiId?: string;
}
```

### Function Signatures

```typescript
// src/mcp/tools/render-ui.ts - REMOVE entirely
export function validateTimeout(timeout: number | undefined): number | undefined

// src/mcp/tools/render-ui.ts - BEFORE
export async function renderUI(
  project: string,
  session: string,
  ui: any,
  blocking: boolean = true,
  timeout: number | undefined = undefined,  // REMOVE
  wsHandler: WebSocketHandler
): Promise<RenderUIResponse>

// src/mcp/tools/render-ui.ts - AFTER
export async function renderUI(
  project: string,
  session: string,
  ui: any,
  blocking: boolean = true,
  wsHandler: WebSocketHandler
): Promise<RenderUIResponse>

// src/services/ui-manager.ts - renderUI method
// BEFORE: validates timeout, sets up setTimeout
// AFTER: no timeout validation, no setTimeout - waits forever
```

### Schema Changes

```typescript
// src/mcp/tools/render-ui.ts - BEFORE
export const renderUISchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: '...' },
    session: { type: 'string', description: '...' },
    ui: { type: 'object', description: '...', additionalProperties: true },
    blocking: { type: 'boolean', description: '...', default: true },
    timeout: { type: 'number', description: '...' },  // REMOVE
  },
  required: ['project', 'session', 'ui'],
};

// src/mcp/tools/render-ui.ts - AFTER
export const renderUISchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: '...' },
    session: { type: 'string', description: '...' },
    ui: { type: 'object', description: '...', additionalProperties: true },
    blocking: { type: 'boolean', description: '...', default: true },
  },
  required: ['project', 'session', 'ui'],
};
```

### Component Interactions

- `setup.ts` handler extracts args and calls HTTP API → remove timeout from body
- `api.ts` receives request and calls `uiManager.renderUI()` → remove timeout param
- `ui-manager.ts` stores pending UI and waits → remove setTimeout, wait forever

### Constants to Remove

```typescript
// src/mcp/tools/render-ui.ts
const MIN_TIMEOUT = 1000;  // REMOVE (no longer needed)
```

### Verification Checklist

- [x] All files from design are listed
- [x] All public interfaces have signatures (before/after)
- [x] Parameter types are explicit (no `any` except for `ui` which is intentional)
- [x] Return types are explicit
- [x] Component interactions are documented
