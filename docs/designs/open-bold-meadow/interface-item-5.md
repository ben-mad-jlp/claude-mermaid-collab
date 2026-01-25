# Interface: Item 5 - Remove render_ui timeout

## File Structure
- `src/mcp/tools/render-ui.ts` - Modify existing file

## Type Definitions

No new types needed. Existing types remain unchanged.

## Function Signatures

```typescript
// src/mcp/tools/render-ui.ts

// REMOVE these constants:
// const DEFAULT_TIMEOUT = 30000;
// const MIN_TIMEOUT = 1000;
// const MAX_TIMEOUT = 300000;

// ADD this constant:
const MIN_TIMEOUT = 1000; // Keep minimum for validation when timeout IS specified

/**
 * Validates timeout value
 * @param timeout - Timeout in milliseconds (undefined or 0 means no timeout)
 * @returns validated timeout or undefined (no timeout)
 */
export function validateTimeout(timeout: number | undefined): number | undefined {
  // If undefined or 0, return undefined (no timeout)
  if (timeout === undefined || timeout === 0) {
    return undefined;
  }

  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
    throw new Error('Timeout must be a finite number');
  }

  if (timeout < MIN_TIMEOUT) {
    throw new Error(`Timeout must be at least ${MIN_TIMEOUT}ms`);
  }

  // No max timeout - allow any value
  return timeout;
}

/**
 * Renders UI to browser and optionally waits for user interaction
 * Changed: timeout is now optional, defaults to no timeout
 */
export async function renderUI(
  project: string,
  session: string,
  ui: any,
  blocking: boolean = true,
  timeout: number | undefined = undefined,  // Changed: no default timeout
  wsHandler: WebSocketHandler
): Promise<RenderUIResponse>
```

## Component Interactions

- `renderUI` function calls `validateTimeout` to validate optional timeout
- If `timeout` is undefined or 0, no setTimeout is created
- Promise resolves only when user responds (no automatic rejection)

## Schema Changes

```typescript
// Update renderUISchema
export const renderUISchema = {
  // ... existing properties ...
  timeout: {
    type: 'number',
    description: 'Optional timeout in milliseconds. If omitted or 0, waits indefinitely.',
    // REMOVE: default: 30000
  },
};
```
