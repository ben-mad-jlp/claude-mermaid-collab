# Task Dependency Graph

## YAML Task Graph

```yaml
tasks:
  - id: ring-buffer
    files: [src/terminal/RingBuffer.ts]
    tests: [src/terminal/RingBuffer.test.ts, src/terminal/__tests__/RingBuffer.test.ts]
    description: Implement circular buffer for terminal output history
    parallel: true

  - id: pty-manager
    files: [src/terminal/PTYManager.ts]
    tests: [src/terminal/PTYManager.test.ts, src/terminal/__tests__/PTYManager.test.ts]
    description: Implement PTY session manager with Bun.spawn
    depends-on: [ring-buffer]

  - id: terminal-exports
    files: [src/terminal/index.ts]
    tests: []
    description: Export barrel for terminal module
    depends-on: [pty-manager]

  - id: websocket-integration
    files: [src/routes/websocket.ts]
    tests: [src/routes/websocket.test.ts, src/routes/__tests__/websocket.test.ts]
    description: Add terminal WebSocket route handler
    depends-on: [terminal-exports]

  - id: api-integration
    files: [src/routes/api.ts]
    tests: [src/routes/api.test.ts, src/routes/__tests__/api.test.ts]
    description: Add terminal REST API routes
    depends-on: [terminal-exports]

  - id: server-integration
    files: [src/server.ts]
    tests: []
    description: Initialize PTYManager and register shutdown handler
    depends-on: [websocket-integration, api-integration]
```

## Execution Waves

**Wave 1 (no dependencies):**
- `ring-buffer` - RingBuffer class (standalone, no imports from project)

**Wave 2 (depends on Wave 1):**
- `pty-manager` - PTYManager class (imports RingBuffer)

**Wave 3 (depends on Wave 2):**
- `terminal-exports` - Barrel file (re-exports from PTYManager and RingBuffer)

**Wave 4 (depends on Wave 3, can run in parallel):**
- `websocket-integration` - WebSocket handler (imports from terminal/)
- `api-integration` - REST API routes (imports from terminal/)

**Wave 5 (depends on Wave 4):**
- `server-integration` - Server initialization (depends on routes being ready)

## File Conflict Analysis

| File | Tasks | Conflict? |
|------|-------|-----------|
| src/terminal/RingBuffer.ts | ring-buffer | No (single task) |
| src/terminal/PTYManager.ts | pty-manager | No (single task) |
| src/terminal/index.ts | terminal-exports | No (single task) |
| src/routes/websocket.ts | websocket-integration | No (single task) |
| src/routes/api.ts | api-integration | No (single task) |
| src/server.ts | server-integration | No (single task) |

**No file conflicts detected.** Each file is modified by exactly one task.

## Dependency Analysis

```
ring-buffer (Wave 1)
    └── pty-manager (Wave 2)
            └── terminal-exports (Wave 3)
                    ├── websocket-integration (Wave 4)
                    └── api-integration (Wave 4)
                            └── server-integration (Wave 5)
```

## Summary

- **Total tasks:** 6
- **Total waves:** 5
- **Max parallelism:** 2 (Wave 4: websocket + api can run together)
- **Critical path:** ring-buffer → pty-manager → terminal-exports → websocket-integration → server-integration

## Implementation Notes

1. **New files (create):** RingBuffer.ts, PTYManager.ts, index.ts
2. **Modified files (edit):** websocket.ts, api.ts, server.ts
3. **Test files:** Will be created alongside implementation tasks
