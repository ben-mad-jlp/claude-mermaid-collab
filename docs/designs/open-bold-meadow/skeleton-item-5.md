# Skeleton: Item 5 - Remove render_ui timeout

## Planned Files
- [ ] `src/mcp/tools/render-ui.ts` - Modify existing file (remove timeout constants, update validation)

**Note:** This file already exists - we're modifying it, not creating it.

## File Contents

### Modifications to: src/mcp/tools/render-ui.ts

**REMOVE these lines (around lines 19-22):**
```typescript
// REMOVE:
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MIN_TIMEOUT = 1000; // 1 second
const MAX_TIMEOUT = 300000; // 5 minutes
```

**REPLACE WITH:**
```typescript
// Minimum timeout when one is specified (prevents accidental 0ms timeouts)
const MIN_TIMEOUT = 1000; // 1 second
// No default timeout - wait forever unless caller specifies
// No max timeout - callers can use any value
```

**MODIFY validateTimeout function (around lines 99-117):**
```typescript
/**
 * Validates timeout value
 * @param timeout - Timeout in milliseconds (undefined or 0 means no timeout)
 * @returns validated timeout or undefined (no timeout)
 */
export function validateTimeout(timeout: number | undefined): number | undefined {
  // If undefined or 0, return undefined (no timeout - wait forever)
  if (timeout === undefined || timeout === 0) {
    return undefined;
  }

  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
    throw new Error('Timeout must be a finite number');
  }

  if (timeout < MIN_TIMEOUT) {
    throw new Error(`Timeout must be at least ${MIN_TIMEOUT}ms`);
  }

  // No max timeout check - allow any positive value
  return timeout;
}
```

**MODIFY renderUI function (around lines 130-210):**
```typescript
export async function renderUI(
  project: string,
  session: string,
  ui: any,
  blocking: boolean = true,
  timeout: number | undefined = undefined,  // Changed: no default
  wsHandler: WebSocketHandler
): Promise<RenderUIResponse> {
  // ... validation code unchanged ...

  // Validate timeout if blocking
  const finalTimeout = blocking ? validateTimeout(timeout) : undefined;

  // ... broadcast code unchanged ...

  // If not blocking, return immediately
  if (!blocking) {
    return {
      completed: true,
      source: 'terminal',
      action: 'render_complete',
    };
  }

  // Wait for user action - with optional timeout
  return new Promise<RenderUIResponse>((resolve, reject) => {
    let isResolved = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    // Only setup timeout if finalTimeout is defined (not undefined)
    if (finalTimeout !== undefined) {
      timeoutHandle = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          resolve({
            completed: false,
            source: 'timeout',
            error: `Timeout after ${finalTimeout}ms`,
          });
        }
      }, finalTimeout);
    }
    // If finalTimeout is undefined, no timeout - promise only resolves on user action

    const handleUIResponse = (response: UIResponse) => {
      if (!isResolved && response.componentId === uiId) {
        isResolved = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve({
          completed: true,
          source: 'browser',
          action: response.actionId,
          data: response.data,
        });
      }
    };

    (wsHandler as any).__pendingUIHandlers = (wsHandler as any).__pendingUIHandlers || {};
    (wsHandler as any).__pendingUIHandlers[uiId] = handleUIResponse;
  });
}
```

**MODIFY renderUISchema (around lines 311-339):**
```typescript
export const renderUISchema = {
  type: 'object',
  properties: {
    // ... project, session, ui unchanged ...
    blocking: {
      type: 'boolean',
      description: 'Whether to wait for user action (default: true)',
      default: true,
    },
    timeout: {
      type: 'number',
      description: 'Optional timeout in milliseconds. If omitted or 0, waits indefinitely.',
      // REMOVED: default: 30000
    },
  },
  required: ['project', 'session', 'ui'],
};
```

## Task Dependency Graph

```yaml
tasks:
  - id: render-ui-timeout
    files: [src/mcp/tools/render-ui.ts]
    tests: [src/mcp/tools/render-ui.test.ts, src/mcp/tools/__tests__/render-ui.test.ts]
    description: Remove default timeout from render_ui, make timeout optional
    parallel: true
```

## Execution Order

**Wave 1 (parallel):**
- render-ui-timeout

Single task, no dependencies.

## Verification

- [x] File path matches existing file
- [x] Changes clearly documented
- [x] No new files needed
- [x] TODO comments in pseudocode addressed
- [x] No dependencies on other items
