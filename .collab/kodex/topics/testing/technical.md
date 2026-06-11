## Backend Tests (Bun)

Uses `bun:test` with `describe`, `test`, `expect`:

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';

describe('KodexManager', () => {
  let manager: KodexManager;
  
  beforeEach(() => {
    manager = new KodexManager('/tmp/test-project');
  });
  
  test('creates topic draft', async () => {
    const draft = await manager.createTopic('test', 'Test', content);
    expect(draft.topicName).toBe('test');
  });
});
```

## UI Tests (Vitest)

Uses Vitest with React Testing Library:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('Component', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

## Test Patterns

**Mocking Services:**
```typescript
const mockManager = {
  getTopic: jest.fn().mockResolvedValue(mockTopic),
};
```

**Testing Async:**
```typescript
test('async operation', async () => {
  const result = await service.asyncMethod();
  expect(result).toBeDefined();
});
```

**Integration Tests:**
Tests that verify multiple components working together (e.g., API + Service + WebSocket).

## Coverage

Key areas with test coverage:
- Session registry operations
- UI manager blocking/response
- Kodex CRUD and draft workflow
- Terminal session management
- Status manager updates
- API routes (render-ui, status, terminal)
- MCP tool handlers
- WebSocket broadcasting