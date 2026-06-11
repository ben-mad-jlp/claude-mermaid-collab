# Testing Infrastructure

The project uses Bun's built-in test runner for backend tests and Vitest for UI tests. Tests cover services, API routes, MCP tools, WebSocket handling, and React components.

## Test Commands

```bash
# Backend tests (Bun)
bun test                    # Run all tests
bun test path/to/test.ts    # Run specific test

# UI tests (Vitest)
npm run test:ci             # Non-interactive (CI)
npm run test                # Watch mode
```

## Test Categories

1. **Service Tests** - Business logic (KodexManager, UIManager, etc.)
2. **API Tests** - HTTP route handlers
3. **MCP Tests** - Tool implementations
4. **WebSocket Tests** - Real-time messaging
5. **UI Tests** - React component behavior