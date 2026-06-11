# MCP Tools Patterns

Design patterns and conventions used across MCP tool implementations.

## Common Patterns

### 1. Session Parameters
Most tools require `project` (absolute path) and `session` (session name) as required parameters.

### 2. API Delegation
Tools delegate to HTTP API endpoints for persistence, then broadcast changes via WebSocket.

### 3. Error Handling
Tools return `{ error: message }` with `isError: true` flag on failure.

### 4. Result Formatting
All results are JSON stringified with `null, 2` for readability.

### 5. Input Validation
Required parameters validated at handler entry with clear error messages.

### 6. Schema Definition
Each tool defines `inputSchema` object with JSON Schema for validation.