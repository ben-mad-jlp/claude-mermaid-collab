# Skeleton: Item 1

## Fix render_ui timeout

### Task Graph

```yaml
tasks:
  - id: item1-transport-types
    file: src/mcp/http-transport.ts
    action: modify
    description: Add HandlePostOptions interface and update PendingResponse type
    depends: []
    
  - id: item1-transport-handlepost
    file: src/mcp/http-transport.ts
    action: modify
    description: Update handlePost to accept options parameter and handle timeout=-1
    depends: [item1-transport-types]
    
  - id: item1-api-route
    file: src/routes/api.ts
    action: modify
    description: Pass timeout option to handlePost for blocking render_ui calls
    depends: [item1-transport-handlepost]
```

### Stub Code

#### src/mcp/http-transport.ts

```typescript
// Add near top of file after existing interfaces

/**
 * Options for handlePost
 */
interface HandlePostOptions {
  /** Timeout in ms. 0 or undefined = use default (60000). -1 = no timeout */
  timeout?: number;
}

// Modify PendingResponse interface
interface PendingResponse {
  resolve: (messages: JSONRPCMessage[]) => void;
  messages: JSONRPCMessage[];
  timeout: ReturnType<typeof setTimeout> | null;  // Changed: allow null
}

// Modify handlePost signature
async handlePost(req: Request, options?: HandlePostOptions): Promise<Response> {
  // TODO: Extract timeout from options, default to 60000
  // TODO: If timeout === -1, don't create setTimeout
  // TODO: Update setTimeout creation logic
  // TODO: Handle null timeout in cleanup
  throw new Error('Not implemented');
}
```

#### src/routes/api.ts

```typescript
// In the MCP POST handler, detect blocking render_ui and pass timeout option

// TODO: Detect if current request is a blocking render_ui call
// TODO: Pass { timeout: -1 } to transport.handlePost for blocking calls
// TODO: Keep default timeout for other calls
```

### Verification Checklist

- [x] All files from interface listed with tasks
- [x] Task dependencies form valid DAG (no cycles)
- [x] Stubs show where modifications go
- [x] 3 tasks total - appropriate granularity
