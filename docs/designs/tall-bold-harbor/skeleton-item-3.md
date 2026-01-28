# Skeleton: Item 3 - Remove timeout parameter from render_ui

## Files to Modify

- [ ] `src/mcp/tools/render-ui.ts` - Remove timeout from schema and function
- [ ] `src/mcp/setup.ts` - Remove timeout from MCP handler
- [ ] `src/routes/api.ts` - Remove timeout from HTTP API
- [ ] `src/services/ui-manager.ts` - Remove timeout from interfaces and logic
- [ ] Test files (as discovered)

**Note:** These are modifications to existing files, not new file creation.

## Task Dependency Graph

```yaml
tasks:
  - id: ui-manager-types
    files: [src/services/ui-manager.ts]
    tests: [src/services/ui-manager.test.ts, src/services/__tests__/ui-manager.test.ts]
    description: Remove timeout from PendingUI and RenderUIRequest interfaces, remove setTimeout logic
    parallel: true

  - id: render-ui-schema
    files: [src/mcp/tools/render-ui.ts]
    tests: [src/mcp/tools/render-ui.test.ts, src/mcp/tools/__tests__/render-ui.test.ts]
    description: Remove timeout from schema, remove validateTimeout fn, update renderUI signature
    depends-on: [ui-manager-types]

  - id: api-handler
    files: [src/routes/api.ts]
    tests: [src/routes/api.test.ts, src/routes/__tests__/api.test.ts, src/__tests__/api-render-ui.test.ts]
    description: Remove timeout from request parsing and uiManager call
    depends-on: [ui-manager-types]

  - id: mcp-handler
    files: [src/mcp/setup.ts]
    tests: [src/mcp/setup.test.ts, src/mcp/__tests__/server.test.ts]
    description: Remove timeout from args extraction and body
    depends-on: [render-ui-schema, api-handler]
```

## Execution Order

**Wave 1 (parallel-safe):**
- `ui-manager-types` - Foundation: Remove timeout from core interfaces/logic

**Wave 2 (parallel):**
- `render-ui-schema` - Remove from MCP tool schema and function
- `api-handler` - Remove from HTTP API handler

**Wave 3:**
- `mcp-handler` - Remove from MCP handler (depends on schema change)

## Modifications Detail

### Task: ui-manager-types

**File:** `src/services/ui-manager.ts`

Changes:
1. Remove `timeout: number` from `PendingUI` interface
2. Remove `timeoutHandle: ReturnType<typeof setTimeout>` from `PendingUI` interface
3. Remove `timeout?: number` from `RenderUIRequest` interface
4. Remove timeout validation (lines 83-90)
5. Remove setTimeout setup in Promise (lines 123-127)
6. Remove `clearTimeout(pending.timeoutHandle)` calls

### Task: render-ui-schema

**File:** `src/mcp/tools/render-ui.ts`

Changes:
1. Remove `const MIN_TIMEOUT = 1000` constant
2. Remove entire `validateTimeout` function (lines 100-116)
3. Remove `timeout` parameter from `renderUI` function signature
4. Remove `const finalTimeout = ...` line
5. Remove timeout-related code in Promise block
6. Remove `timeout` from `renderUISchema.properties`

### Task: api-handler

**File:** `src/routes/api.ts`

Changes:
1. Remove `timeout` from destructuring (line 926)
2. Remove `timeout` from uiManager.renderUI call (line 963)
3. Remove timeout error handling (lines 968-973)

### Task: mcp-handler

**File:** `src/mcp/setup.ts`

Changes:
1. Remove `timeout` from args destructuring (line 1020)
2. Remove `timeout` from body JSON.stringify (line 1026)

## Verification Checklist

- [x] All files from Interface are documented
- [x] File paths match exactly
- [x] All changes are explicit removal operations
- [x] Dependency graph covers all files
- [x] No circular dependencies
- [x] Test patterns generated for each task
