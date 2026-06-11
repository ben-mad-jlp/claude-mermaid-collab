## Error Type Checking Pattern

Universally used for safe error message extraction:
```typescript
catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
}
```

## Custom Error Classes

```typescript
// MermaidError with cause chaining
export class MermaidError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'MermaidError';
  }
}

// APIError interface
export interface APIError extends Error {
  status?: number;
  data?: any;
}
```

## Validation-First Pattern

```typescript
// Early validation with descriptive errors
if (!sessionName || !sessionName.trim()) {
  throw new Error('Session name cannot be empty');
}
if (!isAbsolute(path)) {
  throw new Error('Invalid project path: must be an absolute path');
}
```

## API Route Error Handling

```typescript
// Validation errors (400)
return Response.json({ error: 'project and session required' }, { status: 400 });

// Not found (404)
return Response.json({ error: 'Session not found' }, { status: 404 });

// Server errors (500)
return Response.json({ error: error.message }, { status: 500 });
```

## Graceful Degradation

Non-critical operations fail silently:
```typescript
catch {
  // Ignore errors during reset - best effort
}
```

## Client-Side Error Enrichment

```typescript
const apiError = new Error(`Network error: ${error.message}`) as APIError;
apiError.status = 0;
throw apiError;
```