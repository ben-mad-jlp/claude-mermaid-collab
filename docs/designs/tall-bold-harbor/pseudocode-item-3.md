# Pseudocode: Item 3 - Remove timeout parameter from render_ui

## File 1: src/mcp/tools/render-ui.ts

### Remove validateTimeout function
```
DELETE FUNCTION validateTimeout(timeout)
DELETE CONSTANT MIN_TIMEOUT
```

### Update renderUISchema
```
1. Remove 'timeout' property from schema.properties object
   - Delete lines 335-338:
     timeout: {
       type: 'number',
       description: 'Optional timeout in milliseconds...',
     }
```

### Update renderUI function signature
```
BEFORE: renderUI(project, session, ui, blocking = true, timeout = undefined, wsHandler)
AFTER:  renderUI(project, session, ui, blocking = true, wsHandler)

1. Remove timeout parameter from function signature
2. Remove line: const finalTimeout = blocking ? validateTimeout(timeout) : undefined
3. In Promise block:
   - Remove: if (finalTimeout !== undefined) { timeoutHandle = setTimeout(...) }
   - Keep: Promise resolves only when handleUIResponse is called
```

**Error Handling:**
- No timeout errors to throw anymore
- Promise rejects only on internal errors (not timeout)

**Edge Cases:**
- blocking=false: Returns immediately (no change)
- blocking=true: Waits forever until user responds

---

## File 2: src/mcp/setup.ts

### Update render_ui case handler
```
BEFORE:
  const { project, session, ui, blocking, timeout } = args
  body: JSON.stringify({ ui, blocking, timeout })

AFTER:
  const { project, session, ui, blocking } = args
  body: JSON.stringify({ ui, blocking })

1. Remove 'timeout' from destructuring (line 1020)
2. Remove 'timeout' from JSON body (line 1026)
```

**Error Handling:**
- No changes - other errors still propagate

---

## File 3: src/routes/api.ts

### Update POST /api/render-ui handler
```
BEFORE:
  const { ui, blocking, timeout } = await req.json()
  uiManager.renderUI({ ..., timeout })

AFTER:
  const { ui, blocking } = await req.json()
  uiManager.renderUI({ ..., /* no timeout */ })

1. Remove 'timeout' from destructuring (line 926)
2. Remove 'timeout' from uiManager.renderUI call (line 963)
3. Remove timeout error handling block (lines 968-973):
   - if (error.message.includes('Timeout')) { ... }
```

**Error Handling:**
- Remove timeout-specific error handling
- Other errors still return 400

---

## File 4: src/services/ui-manager.ts

### Update PendingUI interface
```
BEFORE:
  interface PendingUI {
    timeout: number;
    timeoutHandle: ReturnType<typeof setTimeout>;
    ...
  }

AFTER:
  interface PendingUI {
    // Remove timeout and timeoutHandle
    ...
  }
```

### Update RenderUIRequest interface
```
BEFORE:
  interface RenderUIRequest {
    timeout?: number;
    ...
  }

AFTER:
  interface RenderUIRequest {
    // Remove timeout
    ...
  }
```

### Update renderUI method
```
BEFORE:
  1. Extract rawTimeout from request
  2. Validate: if timeout < 1000 throw
  3. Validate: if timeout > 300000 throw
  4. Set up setTimeout with timeoutHandle
  5. On timeout: reject with error

AFTER:
  1. Remove timeout extraction and validation
  2. Remove setTimeout setup
  3. Promise waits forever until receiveResponse is called
```

### Update receiveResponse method
```
1. Remove: clearTimeout(pending.timeoutHandle)
   (No timeoutHandle to clear)
```

### Update dismissUI method
```
1. Remove: clearTimeout(pending.timeoutHandle)
   (No timeoutHandle to clear)
```

**Error Handling:**
- Remove timeout validation errors
- Remove timeout rejection

**Edge Cases:**
- If user never responds: Promise waits forever (intended)
- If WebSocket disconnects: Caller's responsibility to handle

---

## Verification Checklist

- [x] Every function from Interface has pseudocode
- [x] Error handling is explicit for each function
- [x] Edge cases are identified
- [x] External dependencies noted (none - this is removal only)
