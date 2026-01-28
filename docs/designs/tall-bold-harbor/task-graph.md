# Task Dependency Graph

## Item 3: Remove timeout parameter from render_ui MCP tool

## YAML Task Graph

```yaml
tasks:
  - id: ui-manager-timeout-removal
    files: [src/services/ui-manager.ts]
    tests: [src/services/ui-manager.test.ts, src/services/__tests__/ui-manager.test.ts]
    description: Remove timeout and timeoutHandle from PendingUI and RenderUIRequest interfaces. Update renderUI, receiveResponse, and dismissUI methods to remove timeout logic.
    parallel: true
    depends-on: []

  - id: render-ui-timeout-removal
    files: [src/mcp/tools/render-ui.ts]
    tests: [src/mcp/tools/render-ui.test.ts, src/mcp/tools/__tests__/render-ui.test.ts]
    description: Remove validateTimeout function, MIN_TIMEOUT constant, timeout from schema, and timeout parameter from renderUI function.
    parallel: true
    depends-on: [ui-manager-timeout-removal]

  - id: setup-timeout-removal
    files: [src/mcp/setup.ts]
    tests: [src/mcp/setup.test.ts, src/mcp/__tests__/setup.test.ts]
    description: Remove timeout from destructuring and JSON body in render_ui case handler.
    parallel: true
    depends-on: [ui-manager-timeout-removal]

  - id: api-timeout-removal
    files: [src/routes/api.ts]
    tests: [src/routes/api.test.ts, src/routes/__tests__/api.test.ts]
    description: Remove timeout from destructuring, uiManager.renderUI call, and timeout error handling block.
    parallel: true
    depends-on: [ui-manager-timeout-removal]
```

## Execution Waves

**Wave 1 (no dependencies):**
- ui-manager-timeout-removal

**Wave 2 (depends on Wave 1):**
- render-ui-timeout-removal
- setup-timeout-removal
- api-timeout-removal

## File Conflict Analysis

No file conflicts detected. Each task modifies a different file:
- `src/services/ui-manager.ts` - ui-manager-timeout-removal only
- `src/mcp/tools/render-ui.ts` - render-ui-timeout-removal only
- `src/mcp/setup.ts` - setup-timeout-removal only
- `src/routes/api.ts` - api-timeout-removal only

## Summary

- Total tasks: 4
- Total waves: 2
- Max parallelism: 3 (Wave 2)

## Rationale

1. **ui-manager-timeout-removal** must be done first because it defines the core interfaces (`PendingUI`, `RenderUIRequest`) that other files depend on. Removing timeout from interfaces first ensures clean compilation.

2. **Wave 2 tasks** can all run in parallel since they each modify a separate file and all depend only on the ui-manager changes being complete.

3. The order ensures TypeScript compilation succeeds at each step - interfaces are updated before consumers.
