# Interface Definition: Item 1

## Fix render_ui timeout

### File Structure

- `src/mcp/http-transport.ts` - **MODIFY** - Add configurable timeout
- `src/mcp/setup.ts` - **MODIFY** - Pass timeout option for render_ui tool

### Type Definitions

```typescript
// src/mcp/http-transport.ts

/**
 * Options for handlePost
 */
interface HandlePostOptions {
  /** Timeout in ms. 0 or undefined = use default (60000). -1 = no timeout */
  timeout?: number;
}

/**
 * Pending response that we're building up
 */
interface PendingResponse {
  resolve: (messages: JSONRPCMessage[]) => void;
  messages: JSONRPCMessage[];
  timeout: ReturnType<typeof setTimeout> | null;  // null when no timeout
}
```

### Function Signatures

```typescript
// src/mcp/http-transport.ts
class StreamableHttpTransport implements Transport {
  /**
   * Handle incoming POST request from client.
   * @param req - The incoming request
   * @param options - Optional configuration including timeout
   */
  async handlePost(req: Request, options?: HandlePostOptions): Promise<Response>
}
```

```typescript
// src/mcp/setup.ts
// In the render_ui tool handler, pass timeout: -1 when blocking: true
case 'render_ui': {
  // ... existing code ...
  // When calling transport.handlePost, pass options.timeout = -1 for blocking
}
```

### Component Interactions

1. MCP tool handler (`setup.ts`) receives `render_ui` call with `blocking: true`
2. Handler needs to signal to transport that this call should not timeout
3. Transport's `handlePost` accepts optional `timeout` parameter
4. When `timeout === -1`, no setTimeout is created
5. Promise only resolves when `send()` receives the response

### Implementation Notes

The timeout logic at lines 93-99 of http-transport.ts:
```typescript
timeout: setTimeout(() => {
  if (this._currentResponse) {
    resolve(this._currentResponse.messages);
    this._currentResponse = null;
  }
}, 60000)  // <-- This needs to be configurable
```

Changes:
1. Accept `timeout` option in `handlePost`
2. If `timeout === -1`, set `timeout: null` instead of creating setTimeout
3. Handle null timeout in cleanup logic

### Verification Checklist

- [x] All files from design are listed (2 files)
- [x] All public interfaces have signatures (HandlePostOptions, handlePost)
- [x] Parameter types are explicit (no `any`)
- [x] Return types are explicit (Promise<Response>)
- [x] Component interactions are documented
