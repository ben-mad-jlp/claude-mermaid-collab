# Pseudocode: Item 5 - Remove render_ui timeout

## validateTimeout(timeout)

```
1. If timeout is undefined or 0:
   - Return undefined (signals "no timeout")

2. If timeout is not a finite number:
   - Throw Error("Timeout must be a finite number")

3. If timeout < MIN_TIMEOUT (1000ms):
   - Throw Error("Timeout must be at least 1000ms")

4. Return timeout (validated positive number)
```

**Error Handling:**
- Invalid type: Throw descriptive error
- Too small: Throw descriptive error
- No max limit enforced

**Edge Cases:**
- `timeout = 0` → treat as "no timeout" (return undefined)
- `timeout = undefined` → no timeout (return undefined)
- `timeout = -1` → error (below minimum)
- `timeout = Infinity` → allowed (no max)

---

## renderUI(project, session, ui, blocking, timeout, wsHandler)

```
1. Validate inputs (project, session must be non-empty strings)

2. Validate UI structure (existing validateUIStructure)

3. Validate timeout:
   - finalTimeout = validateTimeout(timeout)
   - If finalTimeout is undefined, we wait forever

4. Generate unique UI ID

5. Broadcast UI to browser via WebSocket

6. If not blocking:
   - Return immediately with { completed: true, source: 'terminal' }

7. If blocking:
   - Create Promise
   - Register response handler for this uiId
   
   - If finalTimeout is defined (not undefined):
     - Set up setTimeout to reject after finalTimeout
   - Else:
     - No timeout - promise only resolves when user responds
   
   - Wait for user response via WebSocket
   - On response: resolve with { completed: true, source: 'browser', ... }
```

**Error Handling:**
- Invalid project/session: Throw before broadcasting
- Invalid UI structure: Throw before broadcasting
- Invalid timeout: Throw during validation
- No timeout error if timeout is undefined/0

**Edge Cases:**
- User never responds + no timeout → Promise never resolves (intentional)
- User responds after long delay → Works correctly
- WebSocket disconnection → Existing error handling applies

---

## Schema Update

```
1. Remove 'default: 30000' from timeout property in renderUISchema
2. Update description to clarify:
   "Optional timeout in milliseconds. If omitted or 0, waits indefinitely."
```

No logic changes, just schema documentation.
