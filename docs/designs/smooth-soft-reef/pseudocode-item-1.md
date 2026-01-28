# Pseudocode: Item 1

## Fix render_ui timeout

### src/mcp/http-transport.ts

#### handlePost(req: Request, options?: HandlePostOptions): Promise<Response>

```
FUNCTION handlePost(req, options):
  // Parse timeout option
  timeout_ms = options?.timeout
  IF timeout_ms is undefined:
    timeout_ms = 60000  // default
  
  // Create pending response object
  pending = {
    resolve: null,
    messages: [],
    timeout: null  // will be set below if needed
  }
  
  // Set up timeout only if not disabled
  IF timeout_ms !== -1:
    pending.timeout = setTimeout(() => {
      IF this._currentResponse exists:
        resolve with current messages
        clear this._currentResponse
    }, timeout_ms)
  // ELSE: no timeout - promise waits indefinitely until send() is called
  
  // Create promise that resolves when response is ready
  promise = new Promise(resolve => {
    pending.resolve = resolve
  })
  
  this._currentResponse = pending
  
  // Process incoming request (existing logic)
  messages = await parseRequest(req)
  FOR each message in messages:
    emit('message', message)
  
  // Wait for response
  response_messages = await promise
  
  // Clear timeout if it was set
  IF pending.timeout:
    clearTimeout(pending.timeout)
  
  RETURN new Response(JSON.stringify(response_messages))
```

### src/mcp/setup.ts

#### render_ui tool handler modification

```
CASE 'render_ui':
  // Extract blocking flag from params
  blocking = params.blocking ?? true
  
  // Render UI and wait for response
  result = await uiManager.renderUI(session, params.ui, blocking)
  
  // When returning response through transport, signal no timeout for blocking calls
  IF blocking:
    // The transport.handlePost should be called with { timeout: -1 }
    // This happens at the route level, not here
    // BUT we need to signal this somehow
    
    // Option: Set a flag on the request context that routes/api.ts reads
    ctx.noTimeout = true
  
  RETURN { content: [{ type: 'text', text: JSON.stringify(result) }] }
```

### src/routes/api.ts (if modification needed)

```
POST '/api/mcp':
  // Check if this is a blocking render_ui call
  // The MCP setup handler sets ctx.noTimeout for such calls
  
  options = {}
  IF ctx.noTimeout:
    options.timeout = -1
  
  response = await transport.handlePost(req, options)
  RETURN response
```

### Verification

- [x] All functions from interface document covered
- [x] handlePost timeout logic handles -1 (no timeout)
- [x] Timeout cleared on normal completion (prevent leaks)
- [x] Backward compatible (default 60s timeout preserved)
